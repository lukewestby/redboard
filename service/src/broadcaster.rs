use anyhow::Result;
use uuid::Uuid;

use crate::message::ServerMessage;
use crate::repository::Repository;
use crate::socket::SocketSender;

pub struct Broadcaster {
    board_id: Uuid,
    repo: Repository,
    current_version: String,
    socket_sender: SocketSender,
}

impl Broadcaster {
    #[tracing::instrument(skip(repo, socket_sender))]
    pub fn new(
        board_id: Uuid,
        current_version: String,
        repo: Repository,
        socket_sender: SocketSender,
    ) -> Self {
        Self {
            board_id,
            current_version,
            repo,
            socket_sender,
        }
    }

    #[tracing::instrument(skip_all)]
    pub async fn start(mut self) {
        loop {
            self.run().await.ok();
        }
    }

    #[tracing::instrument(skip_all, err)]
    async fn run(&mut self) -> Result<()> {
        let repo = self.repo.clone();

        loop {
            let changes = repo
                .get_changes_for_board(self.board_id, 100, Some(self.current_version.clone()))
                .await?;

            if changes.is_empty() {
                return Ok(());
            }

            if let Some((current_version, _, _)) = changes.last() {
                self.current_version = current_version.clone();
            }

            for (_, session_id, change) in changes {
                self.socket_sender
                    .send(ServerMessage::ChangeAccepted { change, session_id })
                    .await?;
            }
        }
    }
}
