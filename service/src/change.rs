use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum Change {
    Insert {
        id: Uuid,
        object: JsonMap<String, JsonValue>,
    },
    Update {
        id: Uuid,
        key: String,
        value: JsonValue,
    },
    Delete {
        id: Uuid,
    },
}
