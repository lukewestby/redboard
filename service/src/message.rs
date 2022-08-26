use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use uuid::Uuid;

use crate::change::Change;

pub type JsonObject = JsonMap<String, JsonValue>;

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    ClientReady { username: String },
    StartSnapshot,
    ApplyChange { change: Change },
    CursorChanged { x: f64, y: f64 },
    CursorLeft,
    Ping,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
pub enum ServerMessage {
    ServerReady,
    SnapshotChunk { entries: Vec<(Uuid, JsonObject)> },
    SnapshotFinished { version: Option<String> },
    ChangeAccepted { change: Change, session_id: Uuid },
    UserJoined { session_id: Uuid, username: String },
    UserLeft { session_id: Uuid },
    UserCursorChanged { session_id: Uuid, x: f64, y: f64 },
    UserCursorLeft { session_id: Uuid },
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PresenceMessage {
    pub source_session: Uuid,
    pub message: ServerMessage,
}
