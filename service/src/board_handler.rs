use anyhow::Result;
use futures::stream::TryStreamExt;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::message::{ClientMessage, ServerMessage};
use crate::presence::Presence;
use crate::repository::Repository;
use crate::socket::{is_broken_connection_error, SocketMessage, SocketSender, SocketStream};
use crate::{broadcaster::Broadcaster, change::Change};

pub struct BoardHandler {
    board_id: Uuid,
    session_id: Uuid,
    repo: Repository,
    socket_sender: SocketSender,
    socket_stream: SocketStream,
    is_closed: bool,
    broadcaster_handle: Option<JoinHandle<()>>,
    presence_handle: Option<JoinHandle<()>>,
}

impl BoardHandler {
    #[tracing::instrument(skip(repo, socket_sender, socket_stream))]
    pub fn new(
        board_id: Uuid,
        session_id: Uuid,
        repo: Repository,
        socket_sender: SocketSender,
        socket_stream: SocketStream,
    ) -> Self {
        Self {
            board_id,
            session_id,
            repo,
            socket_sender,
            socket_stream,
            is_closed: false,
            broadcaster_handle: None,
            presence_handle: None,
        }
    }

    #[tracing::instrument(skip_all)]
    pub async fn start(mut self) {
        self.presence_handle = Some(tokio::task::spawn(
            Presence::new(
                self.board_id,
                self.session_id,
                self.repo.clone(),
                self.socket_sender.clone(),
            )
            .start(),
        ));

        loop {
            if self.is_closed {
                break;
            }

            self.run().await.ok();
        }

        self.shutdown().await;
    }

    #[tracing::instrument(skip_all)]
    async fn shutdown(&mut self) {
        if let Some(presence_handle) = self.presence_handle.take() {
            presence_handle.abort();
            presence_handle.await.ok();
        }
        if let Some(broadcaster_handle) = self.broadcaster_handle.take() {
            broadcaster_handle.abort();
            broadcaster_handle.await.ok();
        }
    }

    #[tracing::instrument(skip_all, err)]
    async fn run(&mut self) -> Result<()> {
        loop {
            if self.is_closed {
                return Ok(());
            }

            match self.socket_stream.try_next().await {
                Ok(Some(SocketMessage::Close)) | Ok(None) => {
                    self.on_close().await?;
                    break;
                }
                Err(error) if is_broken_connection_error(&error) => {
                    self.on_close().await?;
                    break;
                }
                Ok(Some(SocketMessage::Data(ClientMessage::ClientReady { username }))) => {
                    self.on_client_ready(username).await?;
                }
                Ok(Some(SocketMessage::Data(ClientMessage::CursorChanged { x, y }))) => {
                    self.on_cursor_changed(x, y).await?;
                }
                Ok(Some(SocketMessage::Data(ClientMessage::CursorLeft))) => {
                    self.on_cursor_left().await?;
                }
                Ok(Some(SocketMessage::Data(ClientMessage::StartSnapshot))) => {
                    self.on_start_snapshot().await?;
                }
                Ok(Some(SocketMessage::Data(ClientMessage::ApplyChange { change }))) => {
                    self.on_apply_change(change).await?;
                }
                Ok(_) => {}
                Err(error) => return Err(error),
            }

            self.touch_session().await?;
        }

        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn on_close(&mut self) -> Result<()> {
        self.is_closed = true;
        self.socket_sender.close().await;
        self.shutdown().await;
        self.repo
            .delete_session_for_board(self.board_id, self.session_id)
            .await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn touch_session(&mut self) -> Result<()> {
        self.repo.touch_session(self.session_id).await?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn on_client_ready(&mut self, username: String) -> Result<()> {
        self.repo
            .create_session_for_board(self.board_id, self.session_id, username)
            .await?;

        let sessions = self.repo.get_sessions_for_board(self.board_id).await?;

        for (session_id, username) in sessions {
            if session_id == self.session_id {
                continue;
            }
            self.socket_sender
                .send(ServerMessage::UserJoined {
                    session_id,
                    username,
                })
                .await?;
        }

        self.socket_sender.send(ServerMessage::ServerReady).await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn on_cursor_changed(&mut self, x: f64, y: f64) -> Result<()> {
        self.repo
            .update_session_cursor_for_board(self.board_id, self.session_id, x, y)
            .await?;

        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn on_cursor_left(&mut self) -> Result<()> {
        self.repo
            .delete_session_cursor_for_board(self.board_id, self.session_id)
            .await?;

        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn on_start_snapshot(&mut self) -> Result<()> {
        if let Some(handle) = self.broadcaster_handle.take() {
            handle.abort();
            handle.await.ok();
        }

        let version = self.repo.get_version_for_board(self.board_id).await?;
        let mut chunks_stream = self
            .repo
            .stream_object_chunks_for_board(self.board_id)
            .await;
        while let Some(entries) = chunks_stream.try_next().await? {
            self.socket_sender
                .send(ServerMessage::SnapshotChunk { entries })
                .await?;
        }

        self.socket_sender
            .send(ServerMessage::SnapshotFinished {
                version: Some(version.clone()),
            })
            .await?;

        self.broadcaster_handle = Some(tokio::task::spawn(
            Broadcaster::new(
                self.board_id,
                version,
                self.repo.clone(),
                self.socket_sender.clone(),
            )
            .start(),
        ));

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn on_apply_change(&mut self, change: Change) -> Result<()> {
        self.repo
            .publish_change_for_board(self.board_id, self.session_id, change)
            .await?;
        Ok(())
    }
}
