mod board_handler;
mod broadcaster;
mod change;
mod checkpointer;
mod message;
mod presence;
mod repository;
mod session_checker;
mod socket;

use axum::{
    extract::{
        ws::{WebSocket, WebSocketUpgrade},
        Extension, Path, Query,
    },
    http::Method,
    response::IntoResponse,
    routing::get,
    Router, Server,
};
use axum_extra::routing::SpaRouter;
use futures::stream::StreamExt;
use redis::Client;
use serde::Deserialize;
use std::env;
use std::net::SocketAddr;
use tower_http::cors::{self, CorsLayer};
use uuid::Uuid;

use crate::board_handler::BoardHandler;
use crate::checkpointer::Checkpointer;
use crate::repository::Repository;
use crate::session_checker::SessionChecker;
use crate::socket::{SocketSender, SocketStream};

#[tokio::main]
#[tracing::instrument]
async fn main() {
    dotenv::dotenv().ok();
    tracing::subscriber::set_global_default(
        tracing_subscriber::fmt()
            .with_span_events(tracing_subscriber::fmt::format::FmtSpan::ENTER)
            .finish(),
    )
    .unwrap();

    tracing::info!("Serving on port 8080");

    let redis_url = env::var("REDIS_URL").expect("REDIS_URL is required");
    let redis_client = Client::open(redis_url).expect("Could not connect to redis");

    // The repo encapsulates all interactions with Redis
    let repo = Repository::new(redis_client)
        .await
        .expect("Could not start repository");

    // Run one instance of the checkpointer in the background for the lifetime of the application
    let checkpointer_handle = tokio::task::spawn(Checkpointer::new(repo.clone()).start());

    // Run one instance of the session checker in the background for the lifetime of the application
    let session_checker_handle = tokio::task::spawn(SessionChecker::new(repo.clone()).start());

    // Build the application router
    let app = Router::new()
        // Serve the client
        .merge(SpaRouter::new("/assets", "static/assets").index_file("../index.html"))
        // Handle websocket connections for boards
        .route("/api/board/:board_id", get(board_handler))
        // Provide the repo to any listeners
        .layer(Extension(repo))
        // Allow CORS connections to make development easier
        .layer(
            CorsLayer::new()
                .allow_methods([Method::GET])
                .allow_origin(cors::Any),
        );

    // Start the server
    Server::bind(&SocketAddr::from(([0, 0, 0, 0], 8080)))
        .serve(app.into_make_service())
        .await
        .expect("Failed to start server");

    // If the server shuts down, also shut down background tasks
    checkpointer_handle.abort();
    checkpointer_handle.await.ok();
    session_checker_handle.abort();
    session_checker_handle.await.ok();
}

#[derive(Deserialize)]
struct BoardPath {
    board_id: Uuid,
}

#[derive(Deserialize)]
struct BoardQuery {
    session_id: Uuid,
}

/// Accept incoming websocket connections and start a BoardHandler task to drive them
#[tracing::instrument(skip_all, fields(path.board_id = %path.board_id, query.session_id = %query.session_id))]
async fn board_handler(
    Extension(redis_pool): Extension<Repository>,
    Path(path): Path<BoardPath>,
    Query(query): Query<BoardQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket: WebSocket| async move {
        let (socket_sink, socket_stream) = socket.split();

        BoardHandler::new(
            path.board_id,
            query.session_id,
            redis_pool,
            SocketSender::new(socket_sink),
            SocketStream::new(socket_stream),
        )
        .start()
        .await;
    })
}
