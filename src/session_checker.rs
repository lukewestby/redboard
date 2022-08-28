use std::time::Duration;

use futures::TryStreamExt;

use anyhow::Result;

use crate::repository::Repository;

pub struct SessionChecker {
    repo: Repository,
}

impl SessionChecker {
    #[tracing::instrument(skip_all)]
    pub fn new(repo: Repository) -> Self {
        Self { repo }
    }

    #[tracing::instrument(skip_all)]
    pub async fn start(self) {
        loop {
            self.run().await.ok();
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn run(&self) -> Result<()> {
        loop {
            let mut board_id_stream = self.repo.stream_all_board_ids().await;
            while let Some(board_id) = board_id_stream.try_next().await? {
                let session_ids = self.repo.get_sessions_for_board(board_id).await?;
                for (session_id, _) in session_ids {
                    let exists = self.repo.get_session_exists(session_id).await?;
                    if !exists {
                        self.repo
                            .delete_session_for_board(board_id, session_id)
                            .await?;
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(10)).await;
        }
    }
}
