//! Editorial revision history, distinct from ordinary undo.
//!
//! Undo answers "what did I type a few seconds ago?"; revisions answer "how
//! did this document change over the last week?". Immutable snapshots are
//! stored at meaningful boundaries (SQLite storage lands in Milestone 3).
//! Markdown is small; correctness before clever delta storage.

use serde::{Deserialize, Serialize};
use std::time::SystemTime;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RevisionId(pub String);

/// Content hash of the full Markdown snapshot this revision points at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceHash(pub String);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Revision {
    pub id: RevisionId,
    pub parent: Option<RevisionId>,
    pub source_hash: SourceHash,
    pub author: RevisionAuthor,
    /// The instruction that produced an agent patch, when there was one.
    pub instruction: Option<String>,
    pub created_at: SystemTime,
    pub origin: RevisionOrigin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RevisionAuthor {
    Human { name: String },
    Agent { name: String },
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RevisionOrigin {
    HumanSession,
    AgentPatch,
    ExternalEdit,
    Import,
    Checkpoint,
    Restore,
}
