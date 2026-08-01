//! Editorial revision history, distinct from ordinary undo.
//!
//! Undo answers "what did I type a few seconds ago?"; revisions answer "how
//! did this document change over the last week?". Immutable snapshots are
//! stored at meaningful boundaries; `essay-workspace` owns the SQLite store
//! in `.essay/history.sqlite`. Markdown is small; correctness before clever
//! delta storage.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RevisionId(pub String);

/// Content hash of the full Markdown snapshot this revision points at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceHash(pub String);

/// Milliseconds since the Unix epoch. Chosen over `SystemTime` because every
/// consumer is either SQLite or the revision timeline in the WebView, and
/// both want a plain integer.
pub type Timestamp = i64;

pub fn now_millis() -> Timestamp {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as Timestamp)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub id: RevisionId,
    pub parent: Option<RevisionId>,
    pub source_hash: SourceHash,
    pub author: RevisionAuthor,
    /// The instruction that produced an agent patch, when there was one.
    pub instruction: Option<String>,
    pub created_at: Timestamp,
    pub origin: RevisionOrigin,
    /// Word-level delta against the parent revision, for timeline summaries.
    pub words_inserted: usize,
    pub words_removed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RevisionAuthor {
    Human { name: String },
    Agent { name: String },
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RevisionOrigin {
    HumanSession,
    AgentPatch,
    ExternalEdit,
    Import,
    Checkpoint,
    Restore,
}

impl RevisionOrigin {
    /// Stable string for the SQLite column — never derive this from `Debug`,
    /// which is free to change.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::HumanSession => "human_session",
            Self::AgentPatch => "agent_patch",
            Self::ExternalEdit => "external_edit",
            Self::Import => "import",
            Self::Checkpoint => "checkpoint",
            Self::Restore => "restore",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        Some(match value {
            "human_session" => Self::HumanSession,
            "agent_patch" => Self::AgentPatch,
            "external_edit" => Self::ExternalEdit,
            "import" => Self::Import,
            "checkpoint" => Self::Checkpoint,
            "restore" => Self::Restore,
            _ => return None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_strings_round_trip() {
        for origin in [
            RevisionOrigin::HumanSession,
            RevisionOrigin::AgentPatch,
            RevisionOrigin::ExternalEdit,
            RevisionOrigin::Import,
            RevisionOrigin::Checkpoint,
            RevisionOrigin::Restore,
        ] {
            assert_eq!(RevisionOrigin::from_str(origin.as_str()), Some(origin));
        }
    }
}
