use anyhow::{anyhow, Result};
use async_stream::{stream, try_stream};
use bb8_redis::{bb8::Pool, RedisConnectionManager};
use futures::{stream::Stream, Future, StreamExt};
use itertools::Itertools;
use lazy_static::lazy_static;
use redis::{
    aio::Connection,
    streams::{StreamReadOptions, StreamReadReply},
    AsyncCommands, Client, FromRedisValue, RedisError,
};
use regex::Regex;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::{
    sync::broadcast::{self, error::RecvError, Sender as BroadcastSender},
    task::JoinHandle,
};
use uuid::Uuid;

use crate::change::Change;
use crate::message::{JsonObject, PresenceMessage, ServerMessage};

#[derive(Clone)]
pub struct Repository {
    pool: Pool<RedisConnectionManager>,
    presence_sender: BroadcastSender<(Uuid, PresenceMessage)>,
    _presence_handle: Arc<JoinHandle<()>>,
}

impl Repository {
    #[tracing::instrument(skip_all, err)]
    pub async fn new(client: Client) -> Result<Self> {
        let manager = RedisConnectionManager::new(client.get_connection_info().clone())?;
        let pool = Pool::builder().max_size(5).build(manager).await?;
        let (presence_sender, _) = broadcast::channel(1000);
        let presence_handle =
            tokio::task::spawn(Self::start_presence(pool.clone(), presence_sender.clone()));
        Ok(Self {
            pool,
            presence_sender,
            _presence_handle: Arc::new(presence_handle),
        })
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn create_session_for_board(
        &self,
        board_id: Uuid,
        session_id: Uuid,
        username: String,
    ) -> Result<()> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;
            let sessions_key = Self::board_sessions_key(board_id);

            connection
                .hset::<_, _, _, ()>(&sessions_key, session_id.to_string(), username.clone())
                .await?;

            self.touch_session(session_id).await?;

            Self::publish_presence_message_for_board(
                &mut connection,
                board_id,
                PresenceMessage {
                    source_session: session_id,
                    message: ServerMessage::UserJoined {
                        session_id,
                        username: username.clone(),
                    },
                },
            )
            .await?;

            Ok(())
        })
        .await
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn get_sessions_for_board(&self, board_id: Uuid) -> Result<Vec<(Uuid, String)>> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;
            let sessions_key = Self::board_sessions_key(board_id);
            let sessions = connection
                .hgetall::<_, HashMap<String, String>>(&sessions_key)
                .await?
                .into_iter()
                .filter_map(|(session_id_string, username)| {
                    session_id_string
                        .parse::<Uuid>()
                        .ok()
                        .map(|session_id| (session_id, username))
                })
                .collect::<Vec<_>>();

            Ok(sessions)
        })
        .await
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn delete_session_for_board(&self, board_id: Uuid, session_id: Uuid) -> Result<()> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;

            connection
                .hdel::<String, String, ()>(
                    Self::board_sessions_key(board_id),
                    session_id.to_string(),
                )
                .await?;

            connection
                .del::<_, ()>(Self::session_checkin_key(session_id))
                .await?;

            Self::publish_presence_message_for_board(
                &mut *connection,
                board_id,
                PresenceMessage {
                    source_session: session_id,
                    message: ServerMessage::UserLeft { session_id },
                },
            )
            .await?;

            Ok(())
        })
        .await
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn touch_session(&self, session_id: Uuid) -> Result<()> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;
            connection
                .set_ex(Self::session_checkin_key(session_id), 1, 30)
                .await?;
            Ok(())
        })
        .await
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn get_session_exists(&self, session_id: Uuid) -> Result<bool> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;
            let exists = connection
                .exists::<_, bool>(Self::session_checkin_key(session_id))
                .await?;
            Ok(exists)
        })
        .await
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn update_session_cursor_for_board(
        &self,
        board_id: Uuid,
        session_id: Uuid,
        x: f64,
        y: f64,
    ) -> Result<()> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;
            Self::publish_presence_message_for_board(
                &mut *connection,
                board_id,
                PresenceMessage {
                    source_session: session_id,
                    message: ServerMessage::UserCursorChanged { session_id, x, y },
                },
            )
            .await?;
            Ok(())
        })
        .await
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn delete_session_cursor_for_board(
        &self,
        board_id: Uuid,
        session_id: Uuid,
    ) -> Result<()> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;
            Self::publish_presence_message_for_board(
                &mut connection,
                board_id,
                PresenceMessage {
                    source_session: session_id,
                    message: ServerMessage::UserCursorLeft { session_id },
                },
            )
            .await?;
            Ok(())
        })
        .await
    }

    #[tracing::instrument(skip(self))]
    pub async fn stream_all_board_ids(&self) -> impl Stream<Item = Result<Uuid>> + Unpin {
        let pool = self.pool.clone();
        Box::pin(try_stream! {
            let mut connection = pool.get().await?;
            let mut stream_keys =  connection
                .scan_match::<_, String>("board/*/changes")
                .await?;
            while let Some(stream_key) = stream_keys.next().await {
                if let Ok(board_id) = Self::parse_board_id_from_key(stream_key.as_str()) {
                    yield board_id;
                }
            }
        })
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn get_changes_for_board(
        &self,
        board_id: Uuid,
        count: usize,
        version: Option<String>,
    ) -> Result<Vec<(String, Uuid, Change)>> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;
            let stream_key = format!("board/{board_id}/changes");
            let actual_version = version.clone().unwrap_or_else(|| "0".to_string());

            let read_reply = connection
                .xread_options::<_, _, StreamReadReply>(
                    &[stream_key],
                    &[actual_version],
                    &StreamReadOptions::default().block(1000).count(count),
                )
                .await?;

            let changes = read_reply
                .keys
                .into_iter()
                .next()
                .into_iter()
                .flat_map(|key| key.ids)
                .filter_map(|id| {
                    Some((
                        id.id,
                        id.map
                            .get("session_id")
                            .and_then(|value| String::from_redis_value(value).ok())
                            .and_then(|string| string.parse::<Uuid>().ok())?,
                        id.map
                            .get("change")
                            .and_then(|value| String::from_redis_value(value).ok())
                            .and_then(|string| serde_json::from_str::<Change>(&string).ok())?,
                    ))
                })
                .collect::<Vec<_>>();

            Ok(changes)
        })
        .await
    }

    #[tracing::instrument(skip(self, changes), err)]
    pub async fn apply_changes_to_board(
        &self,
        board_id: Uuid,
        version: String,
        changes: Vec<Change>,
    ) -> Result<()> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;

            let board_changes_key = format!("board/{board_id}/changes");
            let board_objects_key = format!("board/{board_id}/objects");
            let board_version_key = format!("board/{board_id}/version");

            let mut pipeline = redis::pipe();
            pipeline.atomic();

            pipeline
                .cmd("JSON.SET")
                .arg(&board_objects_key)
                .arg(".")
                .arg("{}")
                .arg("NX");

            for change in changes.clone() {
                match change {
                    Change::Delete { id } => {
                        pipeline
                            .cmd("JSON.DEL")
                            .arg(&board_objects_key)
                            .arg(format!("$.{id}"))
                            .ignore();
                    }
                    Change::Insert { id, object } => {
                        pipeline
                            .cmd("JSON.SET")
                            .arg(&board_objects_key)
                            .arg(format!("$.{id}"))
                            .arg(serde_json::to_string(&object).unwrap())
                            .ignore();
                    }
                    Change::Update { id, key, value } => {
                        pipeline
                            .cmd("JSON.SET")
                            .arg(&board_objects_key)
                            .arg(format!("$.{id}.{key}"))
                            .arg(serde_json::to_string(&value).unwrap())
                            .ignore();
                    }
                }
            }

            pipeline
                .set(&board_version_key, &version)
                .cmd("XTRIM")
                .arg(board_changes_key)
                .arg("MINID")
                .arg(version.clone());

            pipeline.query_async::<_, ()>(&mut *connection).await?;

            Ok(())
        })
        .await
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn publish_change_for_board(
        &self,
        board_id: Uuid,
        session_id: Uuid,
        change: Change,
    ) -> Result<String> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;
            Ok(connection
                .xadd::<_, _, _, _, String>(
                    Self::board_changes_key(board_id),
                    "*".to_string(),
                    &[
                        ("change", serde_json::to_string(&change.clone())?),
                        ("session_id", session_id.to_string()),
                    ],
                )
                .await?)
        })
        .await
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn get_version_for_board(&self, board_id: Uuid) -> Result<String> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;

            let board_version_key = Self::board_version_key(board_id);
            let version = connection
                .get::<_, Option<String>>(board_version_key.as_str())
                .await?
                .unwrap_or_else(|| "0".to_string());

            Ok(version)
        })
        .await
    }

    #[tracing::instrument(skip(self))]
    pub async fn stream_object_chunks_for_board(
        &self,
        board_id: Uuid,
    ) -> impl Stream<Item = Result<Vec<(Uuid, JsonObject)>>> + Unpin {
        let pool = self.pool.clone();
        Box::pin(try_stream! {
            let board_objects_key = Self::board_objects_key(board_id);

            let object_key_chunks = Self::with_redis_retry(|| async {
                let mut connection = pool.get().await?;

                let object_key_chunks = redis::cmd("JSON.OBJKEYS")
                    .arg(board_objects_key.as_str())
                    .arg(".")
                    .query_async::<_, Option<Vec<String>>>(&mut *connection)
                    .await?
                    .unwrap_or_default()
                    .into_iter()
                    .map(|key| format!("$.{key}"))
                    .chunks(100);

                let object_key_chunks = object_key_chunks
                    .into_iter()
                    .map(|chunk| chunk.collect::<Vec<_>>())
                    .collect::<Vec<_>>();

                Ok(object_key_chunks)
            }).await?;

            for keys in object_key_chunks {
                let keys_length = keys.len();

                if keys_length == 0 {
                    continue;
                }

                let entries = Self::with_redis_retry(|| async {
                    let mut connection = pool.get().await?;

                    let entries_string = redis::cmd("JSON.GET")
                        .arg(board_objects_key.clone())
                        .arg(&keys)
                        .query_async::<_, Option<String>>(&mut *connection)
                        .await?;

                    if keys_length == 1 {
                        Ok(entries_string
                            .and_then(|string| serde_json::from_str::<Vec<JsonObject>>(&string).ok())
                            .and_then(|mut values| {
                                Some(vec![(
                                    keys[0].trim_start_matches("$.").parse::<Uuid>().ok()?,
                                    values.pop()?,
                                )])
                            })
                            .unwrap_or_default())
                    } else {
                        Ok(entries_string
                            .and_then(|string| {
                                serde_json::from_str::<HashMap<String, Vec<JsonObject>>>(&string).ok()
                            })
                            .unwrap_or_default()
                            .into_iter()
                            .filter_map(|(key, mut values)| {
                                Some((
                                    key.trim_start_matches("$.").parse::<Uuid>().ok()?,
                                    values.pop()?,
                                ))
                            })
                            .collect::<Vec<_>>())
                    }
                }).await?;

                yield entries;
            }
        })
    }

    #[tracing::instrument(skip(self))]
    pub async fn stream_presence_messages_for_board(
        &self,
        board_id: Uuid,
    ) -> impl Stream<Item = PresenceMessage> + Unpin {
        let sender = self.presence_sender.clone();
        Box::pin(stream! {
            let mut receiver = sender.subscribe();
            loop {
                let (next_board_id, next_message) = match receiver.recv().await {
                    Err(RecvError::Closed) => break,
                    Err(RecvError::Lagged(_)) => continue,
                    Ok(message) => message,
                };
                if next_board_id == board_id {
                    yield next_message;
                }
            }
        })
    }

    // ----

    #[tracing::instrument(skip(connection), err)]
    async fn publish_presence_message_for_board(
        connection: &mut Connection,
        board_id: Uuid,
        message: PresenceMessage,
    ) -> Result<()> {
        connection
            .publish::<String, String, ()>(
                Self::board_presence_key(board_id),
                serde_json::to_string(&message)?,
            )
            .await?;

        Ok(())
    }

    #[tracing::instrument(err)]
    fn parse_board_id_from_key(stream_key: &str) -> Result<Uuid> {
        lazy_static! {
            static ref BOARD_ID_REGEX: Regex = Regex::new(r"^board/([^/]+)/.*$").unwrap();
        }

        Ok(BOARD_ID_REGEX
            .captures(stream_key)
            .ok_or_else(|| anyhow!("No UUID found in stream key"))?
            .get(1)
            .ok_or_else(|| anyhow!("No UUID found in stream key"))?
            .as_str()
            .parse::<Uuid>()?)
    }

    fn board_objects_key(board_id: Uuid) -> String {
        format!("board/{board_id}/objects")
    }

    fn board_version_key(board_id: Uuid) -> String {
        format!("board/{board_id}/version")
    }

    fn board_presence_key(board_id: Uuid) -> String {
        format!("board/{board_id}/presence")
    }

    fn board_changes_key(board_id: Uuid) -> String {
        format!("board/{board_id}/changes")
    }

    fn board_sessions_key(board_id: Uuid) -> String {
        format!("board/{board_id}/sessions")
    }

    fn session_checkin_key(session_id: Uuid) -> String {
        format!("session/{session_id}/checkin")
    }

    async fn with_redis_retry<F, T, O>(mut action: F) -> Result<T>
    where
        F: FnMut() -> O,
        O: Future<Output = Result<T>>,
    {
        let mut retries = 5;
        loop {
            match action().await {
                Ok(ret) => return Ok(ret),
                Err(error) => {
                    match error.downcast_ref::<RedisError>() {
                        None => return Err(error),
                        Some(redis_error) => match redis_error.kind() {
                            redis::ErrorKind::TypeError => {}
                            redis::ErrorKind::TryAgain => {}
                            redis::ErrorKind::ResponseError => {}
                            _ if redis_error.is_timeout()
                                || redis_error.is_connection_dropped() => {}
                            _ => return Err(error),
                        },
                    }
                    retries -= 1;
                    if retries == 0 {
                        return Err(error);
                    }
                }
            }
        }
    }

    #[tracing::instrument(skip_all)]
    async fn start_presence(
        pool: Pool<RedisConnectionManager>,
        sender: BroadcastSender<(Uuid, PresenceMessage)>,
    ) {
        loop {
            let _ = Self::run_presence(pool.clone(), sender.clone()).await;
        }
    }

    #[tracing::instrument(skip_all, err)]
    async fn run_presence(
        pool: Pool<RedisConnectionManager>,
        sender: BroadcastSender<(Uuid, PresenceMessage)>,
    ) -> Result<()> {
        let dedicated_connection = pool.dedicated_connection().await?;
        let mut pubsub = dedicated_connection.into_pubsub();
        pubsub.psubscribe("board/*/presence").await?;
        let mut stream = pubsub.into_on_message();
        while let Some(msg) = stream.next().await {
            let channel_name = msg.get_channel::<String>()?;
            let board_id = Self::parse_board_id_from_key(channel_name.as_str())?;
            let message = serde_json::from_slice::<PresenceMessage>(msg.get_payload_bytes())?;
            let _ = sender.send((board_id, message));
        }
        Ok(())
    }
}
