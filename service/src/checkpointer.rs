use std::time::Duration;

use anyhow::Result;
use futures::TryStreamExt;

use crate::repository::Repository;

pub struct Checkpointer {
    repo: Repository,
}

impl Checkpointer {
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

    #[tracing::instrument(skip_all, err)]
    async fn run(&self) -> Result<()> {
        let repo = self.repo.clone();
        loop {
            let mut board_ids_stream = repo.stream_all_board_ids().await;
            while let Some(board_id) = board_ids_stream.try_next().await? {
                let current_version = repo.get_version_for_board(board_id).await?;
                let changes = repo
                    .get_changes_for_board(board_id, 1000, Some(current_version))
                    .await?;

                if changes.is_empty() {
                    continue;
                }

                let next_version = changes
                    .last()
                    .map(|(version, _, _)| version.clone())
                    .expect("Already checked that changes is not empty");

                let changes_to_apply = changes
                    .into_iter()
                    .map(|(_, _, change)| change)
                    .collect::<Vec<_>>();

                repo.apply_changes_to_board(board_id, next_version, changes_to_apply)
                    .await?;
            }
            tokio::time::sleep(Duration::from_secs(15)).await;
        }
    }
}
