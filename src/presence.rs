use anyhow::Result;
use futures::TryStreamExt;
use uuid::Uuid;

use crate::repository::Repository;
use crate::socket::SocketSender;

pub struct Presence {
    board_id: Uuid,
    session_id: Uuid,
    repo: Repository,
    socket_sender: SocketSender,
}

impl Presence {
    #[tracing::instrument(skip(repo, socket_sender))]
    pub fn new(
        board_id: Uuid,
        session_id: Uuid,
        repo: Repository,
        socket_sender: SocketSender,
    ) -> Self {
        Self {
            board_id,
            session_id,
            repo,
            socket_sender,
        }
    }

    #[tracing::instrument(skip_all)]
    pub async fn start(self) {
        loop {
            self.run().await.ok();
        }
    }

    #[tracing::instrument(skip_all, err)]
    async fn run(&self) -> Result<()> {
        let mut message_stream = self
            .repo
            .stream_presence_messages_for_board(self.board_id)
            .await;
        while let Some(message) = message_stream.try_next().await? {
            if message.source_session != self.session_id {
                self.socket_sender.send(message.message).await?;
            }
        }
        Ok(())
    }
}
