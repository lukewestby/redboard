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

    /// Given a session ID and username from the client, add that session to a board and broadcast
    /// a notification about the new session
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

            // Add the session ID and username as a key-value pair to the hash at
            // board/{board_id}/sessions
            connection
                .hset::<_, _, _, ()>(&sessions_key, session_id.to_string(), username.clone())
                .await?;

            // Start keeping the session alive by bumping the expiration at
            // sessions/{session_id}/checkin
            self.touch_session(session_id).await?;

            // Broadcast UserJoined notification
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

    /// Retrieve all of the session ID - username pairs currently active on a board
    #[tracing::instrument(skip(self), err)]
    pub async fn get_sessions_for_board(&self, board_id: Uuid) -> Result<Vec<(Uuid, String)>> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;
            let sessions_key = Self::board_sessions_key(board_id);

            // Read all of the session ID - username pairs from the hash at
            // board/{board_id}/sessions
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

    /// Remove a session from a board, clean up its checkin state, and broadcast a message
    /// notifying of session removal
    #[tracing::instrument(skip(self), err)]
    pub async fn delete_session_for_board(&self, board_id: Uuid, session_id: Uuid) -> Result<()> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;

            // Delete the session ID from the hash at board/{board_id}/sessions
            connection
                .hdel::<String, String, ()>(
                    Self::board_sessions_key(board_id),
                    session_id.to_string(),
                )
                .await?;

            // Delete the checkin state at sessions/{session_id}/checkin
            connection
                .del::<_, ()>(Self::session_checkin_key(session_id))
                .await?;

            // Broadcast UserLeft notification
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

    /// Determine if a session still exists
    #[tracing::instrument(skip(self), err)]
    pub async fn get_session_exists(&self, session_id: Uuid) -> Result<bool> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;

            // Simply check EXISTS at sessions/{session_id}/checkin and let the expiration handle
            let exists = connection
                .exists::<_, bool>(Self::session_checkin_key(session_id))
                .await?;

            Ok(exists)
        })
        .await
    }

    /// Send notification about a change to a user's cursor position for a particular session in a
    /// particular board. The x and y coordinates are in the pixel space of the board, top-left
    /// origin
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

    /// Send a notification that a user's cursor has left the area of a board
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

    /// Get a stream of every board ID that exists in the system
    #[tracing::instrument(skip(self))]
    pub async fn stream_all_board_ids(&self) -> impl Stream<Item = Result<Uuid>> + Unpin {
        let pool = self.pool.clone();
        Box::pin(try_stream! {
            let mut connection = pool.get().await?;

            // SCAN over keys that match board/*/changes - the /changes key is for the change stream
            // and is the ultimate source of truth about whether a board actually exists
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

    /// Poll the latest `count` changes for a board, optionally starting at a given stream ID. If
    /// no stream ID is provided, start from the beginning.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_changes_for_board(
        &self,
        board_id: Uuid,
        count: usize,
        version: Option<String>,
    ) -> Result<Vec<(String, Uuid, Change)>> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;
            let actual_version = version.clone().unwrap_or_else(|| "0".to_string());

            // XREAD the next `count` items, blocking for 1 second. This means that no messages may
            // be returned even though some may be added immediately after calling this method and
            // therefore it is up to the caller to poll in an appropriate loop.
            let read_reply = connection
                .xread_options::<_, _, StreamReadReply>(
                    &[Self::board_changes_key(board_id)],
                    &[actual_version],
                    &StreamReadOptions::default().block(1000).count(count),
                )
                .await?;

            let changes = read_reply
                .keys
                .into_iter()
                // next() gets the very next item in the iterator and returns Some if there is one
                // or None if the iterator is empty. We only expect one set of stream entries to be
                // returned because we only requested one key.
                .next()
                .into_iter()
                .flat_map(|key| key.ids)
                // Parse the contents of each entry into a session ID and a change
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

    // Bulk-apply a set of changes to the materialized objects of a board, and persist the stream ID
    // of the latest change to help future readers know where to pick up the stream after reading
    // the objects.
    #[tracing::instrument(skip(self, changes), err)]
    pub async fn apply_changes_to_board(
        &self,
        board_id: Uuid,
        version: String,
        changes: Vec<Change>,
    ) -> Result<()> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;

            let board_changes_key = Self::board_changes_key(board_id);
            let board_objects_key = Self::board_objects_key(board_id);
            let board_version_key = Self::board_version_key(board_id);

            // Start a pipeline of commands. Calling `atomic` instructs the client to wrap those
            // commands in a MULTI/EXEC.
            let mut pipeline = redis::pipe();
            pipeline.atomic();

            // First ensure that there is at least an empty JSON object at board/{board_id}/objects
            // to update. NX prevents it from being overwritten if it already exists.
            pipeline
                .cmd("JSON.SET")
                .arg(&board_objects_key)
                .arg(".")
                .arg("{}")
                .arg("NX");

            // Translate each change in to a JSON operation. Deletes are translated into a JSON.DEL
            // for the given object ID. Inserts are translated into a JSON.SET for the entire object
            // ID, passing the new object as the value. Updates are translated into a JSON.SET for
            // the key nested under the object ID.
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

            // Finally, drop all of the changes from the change stream prior to the entry ID given
            // as the version associated with these changes. All of these operations are applied
            // atomically we know that if they succeed then we have no need for the changes in the
            // stream anymore. Future reads will start with the new version of
            // board/{board_id}/objects and then start streaming changes that have been added since
            // this operation was performed and everything remains fast and consistent.
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

    /// Add a change to the board from the given session
    #[tracing::instrument(skip(self), err)]
    pub async fn publish_change_for_board(
        &self,
        board_id: Uuid,
        session_id: Uuid,
        change: Change,
    ) -> Result<String> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;

            // XADD the change and session_id to the stream. Passing `*` as the entry ID is perhaps
            // the most important detail of this design, as it allows Redis to fully determine the
            // global ordering of changes to a board. Clients are responsible for rearranging any
            // optimistic updates to match the order that the Redis stream decides.
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

    /// Get the latest change stream entry ID for a board so that streaming can begin from a point
    /// that maintains consistency with respect to the contents of the board's materialized object
    /// snapshot
    #[tracing::instrument(skip(self), err)]
    pub async fn get_version_for_board(&self, board_id: Uuid) -> Result<String> {
        Self::with_redis_retry(|| async {
            let mut connection = self.pool.get().await?;

            let board_version_key = Self::board_version_key(board_id);

            // Simple GET, with a default value of 0 if it does not exist
            let version = connection
                .get::<_, Option<String>>(board_version_key.as_str())
                .await?
                .unwrap_or_else(|| "0".to_string());

            Ok(version)
        })
        .await
    }

    /// Get a stream of chunks of objects in a board's materialized object snapshot. Splitting up
    /// into chunks allows the caller to provide a high level of perceived performance even when a
    /// board has a ton of objects.
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

                // First get all of the object IDs in the board and split them into groups of 100
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

                    // Retrieve the values of each object ID at once by passing them as variadic
                    // args to JSON.GET. JSON.GET returns a different JSON data structure depending
                    // on whether there is a single key or many keys the returned. A single key will
                    // come back as a single object inside of an array. Multiple keys will come back
                    // as a JSON object that maps keys onto a similar one-value array.
                    let entries_string = redis::cmd("JSON.GET")
                        .arg(board_objects_key.clone())
                        .arg(&keys)
                        .query_async::<_, Option<String>>(&mut *connection)
                        .await?;

                    if keys_length == 1 {
                        Ok(entries_string
                            // Single-key input case: the return value is just whatever JSON data is
                            // at that key, but inside of an array. It will look like
                            // [ { "property1": "hello", "property2": "world" } ]
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
                            // Multiple-key input case: the return value is a mapping of input keys
                            // to values inside arrays
                            // {
                            //   "$.<UUID>": [ { "property1": "hello", "property2": "world" } ],
                            //   "$.<UUID>": [ { "propety1": "foo", "property2": "bar" } ]
                            // }
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

    /// Get a stream of all of the messages published to describe user activity for a particular
    /// board
    #[tracing::instrument(skip(self))]
    pub async fn stream_presence_messages_for_board(
        &self,
        board_id: Uuid,
    ) -> impl Stream<Item = PresenceMessage> + Unpin {
        let sender = self.presence_sender.clone();
        Box::pin(stream! {
            let mut receiver = sender.subscribe();
            loop {
                // recv() fails if either the corresponding sender has been dropped, meaning the
                // channel is closed, or if the current receiver is too far behind. If the channel
                // is closed then so is the stream and we can break and exit. If the receiver is
                // laggy we can simply coninue, and then next recv() will return the oldest value on
                // the channel. Some lossiness in presence messages is fine so this behavior is
                // acceptable.
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

    // ---- Private helpers

    /// Publish a presence message for a board using Pub/Sub
    #[tracing::instrument(skip(connection), err)]
    async fn publish_presence_message_for_board(
        connection: &mut Connection,
        board_id: Uuid,
        message: PresenceMessage,
    ) -> Result<()> {
        // Convert the message to a JSON string and publish it to board/{board_id}/presence
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

    /// The redis-rs client doesn't handle retries particularly well. Wrapping a Redis call with
    /// this method enables retries in cases where I observed errors that seemed to be transient.
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
                            // For some reason, sometimes a slow connection or the database getting
                            // overloaded with too many connections would result in Redis returning
                            // the wrong type for a key that should have correct data. Rust's types
                            // help to prevent incorrect formats from being stored so my best
                            // conclusion is sometimes Redis is unable to send the correct data, or
                            // the client is unable to deal with that data correctly. When that
                            // happened a retry would resolve the issue. If we ever had to start
                            // being more flexible about stored formats this might be untenable but
                            // for now it works.
                            redis::ErrorKind::TypeError => {}

                            // Sometimes Redis or the client just tells us directly to try again.
                            redis::ErrorKind::TryAgain => {}

                            // Timeouts and dropped connections are typically transient
                            redis::ErrorKind::ResponseError => {}
                            _ if redis_error.is_timeout()
                                || redis_error.is_connection_dropped() => {}

                            // Otherwise, the error is real and should be propagated
                            _ => return Err(error),
                        },
                    }

                    // Try 5 times and then give up
                    retries -= 1;
                    if retries == 0 {
                        return Err(error);
                    }
                }
            }
        }
    }

    /// Start the presence subscription loop. The presence Pub/Sub subscription runs in a background
    /// task and forwards messages to an in-memory channel that can be more efficiently streamed by
    /// each connected session.
    #[tracing::instrument(skip_all)]
    async fn start_presence(
        pool: Pool<RedisConnectionManager>,
        sender: BroadcastSender<(Uuid, PresenceMessage)>,
    ) {
        loop {
            let _ = Self::run_presence(pool.clone(), sender.clone()).await;
        }
    }

    /// Listen to messages on all presence channels and forward them into a tokio broadcast channel.
    /// This approach allows each instance of the server to use only one dedicated connection for
    /// subscribing to presence, reducing the number of connections used overall. The alternatives
    /// are either much more complicated than is warranted for a hackathon, or else to open a new
    /// subscription for every sesssion - potentially overloading the database with connections.
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
