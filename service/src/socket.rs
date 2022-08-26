use anyhow::{Error, Result};
use axum::extract::ws::{Message, WebSocket};
use futures::{
    sink::SinkExt,
    stream::{SplitSink, SplitStream, Stream, StreamExt},
};
use std::{any::Any, error::Error as _, pin::Pin, sync::Arc};
use tokio::sync::Mutex;

use crate::message::{ClientMessage, ServerMessage};

#[derive(Clone)]
pub struct SocketSender {
    inner: Arc<Mutex<SplitSink<WebSocket, Message>>>,
    closed: Arc<Mutex<bool>>,
}

impl SocketSender {
    #[tracing::instrument(skip_all)]
    pub fn new(socket_sink: SplitSink<WebSocket, Message>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(socket_sink)),
            closed: Arc::new(Mutex::new(false)),
        }
    }

    #[tracing::instrument(skip_all)]
    pub async fn close(&self) {
        let mut closed = self.closed.lock().await;
        *closed = true;
    }

    #[tracing::instrument(skip_all, err)]
    pub async fn send(&self, message: ServerMessage) -> Result<()> {
        let closed = self.closed.lock().await;
        if *closed {
            return Ok(());
        }

        let mut sink = self.inner.lock().await;
        match sink
            .send(Message::Text(serde_json::to_string(&message)?))
            .await
            .map_err(From::from)
        {
            Ok(()) => Ok(()),
            Err(error) if is_broken_connection_error(&error) => Ok(()),
            Err(error) => Err(error),
        }
    }
}

pub enum SocketMessage {
    Data(ClientMessage),
    Ping,
    Close,
    Unknown,
}

pub struct SocketStream {
    inner: Pin<Box<dyn Stream<Item = Result<SocketMessage>> + Send>>,
}

impl SocketStream {
    #[tracing::instrument(skip_all)]
    pub fn new(socket_stream: SplitStream<WebSocket>) -> Self {
        Self {
            inner: Box::pin(socket_stream.map(|message_result| {
                let message = message_result?;
                match message {
                    Message::Close(_) => Ok(SocketMessage::Close),
                    Message::Ping(_) => Ok(SocketMessage::Ping),
                    Message::Text(text) => {
                        Ok(SocketMessage::Data(serde_json::from_str::<ClientMessage>(
                            text.as_str(),
                        )?))
                    }
                    _ => Ok(SocketMessage::Unknown),
                }
            })),
        }
    }
}

impl Stream for SocketStream {
    type Item = Result<SocketMessage>;
    fn poll_next(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        self.inner.poll_next_unpin(cx)
    }
}

pub fn is_broken_connection_error(error: &Error) -> bool {
    error
        .downcast_ref::<axum::Error>()
        .and_then(|error| error.source())
        .and_then(|error| error.downcast_ref::<tungstenite::Error>())
        .and_then(|error| error.source())
        .and_then(|error| error.downcast_ref::<std::io::Error>())
        .or_else(|| error.downcast_ref::<std::io::Error>())
        .map(|actual_error| matches!(actual_error.kind(), std::io::ErrorKind::BrokenPipe))
        .unwrap_or_default()
}
