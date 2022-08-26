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
            .with_max_level(tracing::Level::ERROR)
            .pretty()
            .with_span_events(tracing_subscriber::fmt::format::FmtSpan::ENTER)
            .finish(),
    )
    .unwrap();

    let redis_user = env::var("REDIS_USER").unwrap();
    let redis_password = env::var("REDIS_PASSWORD").unwrap();
    let redis_host = env::var("REDIS_HOST").unwrap();
    let redis_url = env::var("REDIS_URL")
        .ok()
        .unwrap_or_else(|| format!("redis://{redis_user}:{redis_password}@{redis_host}"));
    let redis_client = Client::open(redis_url).expect("Could not connect to redis");
    let repo = Repository::new(redis_client)
        .await
        .expect("Could not start repository");

    let checkpointer_handle = tokio::task::spawn(Checkpointer::new(repo.clone()).start());
    let session_checker_handle = tokio::task::spawn(SessionChecker::new(repo.clone()).start());

    let app = Router::new()
        .route("/", get(index_handler))
        .route("/board/:board_id", get(board_handler))
        .layer(Extension(repo))
        .layer(
            CorsLayer::new()
                .allow_methods([Method::GET])
                .allow_origin(cors::Any),
        );

    Server::bind(&SocketAddr::from(([127, 0, 0, 1], 3001)))
        .serve(app.into_make_service())
        .await
        .expect("Failed to start server");

    checkpointer_handle.abort();
    checkpointer_handle.await.ok();
    session_checker_handle.abort();
    session_checker_handle.await.ok();
}

#[tracing::instrument]
async fn index_handler() -> impl IntoResponse {
    axum::response::Html("<html><body>Hello world</body></html>")
}

#[derive(Deserialize)]
struct BoardPath {
    board_id: Uuid,
}

#[derive(Deserialize)]
struct BoardQuery {
    session_id: Uuid,
}

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
