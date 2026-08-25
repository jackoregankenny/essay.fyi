//! Document identity, comment threads, range anchors and agent transcripts —
//! the removable editorial sidecar (`.essay/context.sqlite`).
//!
//! Everything in this crate is workflow, never prose. Deleting `.essay/`
//! loses comments and identity; it must never change a manuscript byte, and
//! nothing here writes an ID into Markdown — the file stays portable and the
//! sidecar stays disposable.
//!
//! A separate database from `history.sqlite`, on purpose: that one records
//! what the document *was*, this one records what the author is *doing about
//! it*, and stretching one store to cover both would leave a name that
//! describes neither.
//!
//! Rows are never destructively deleted. Deletion is a tombstone
//! (`deleted_at`), every mutation bumps a `version` counter, and IDs are
//! opaque and stable — the shape a future sync can merge by ID/version
//! without a schema rewrite, built now because retrofitting it means
//! migrating every author's sidecar.
//!
//! **Offsets are UTF-16 code units**, the same discipline as `essay-search`:
//! the only consumer that turns an offset into a caret is ProseMirror, which
//! counts the way JavaScript strings do. A byte offset lands mid-character on
//! any em dash.

mod reconcile;
mod store;

pub use reconcile::{place_anchor, Placement, SectionSpan};
pub use store::ContextStore;

use essay_revisions::Timestamp;
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum ContextError {
    #[error("{path} is not a file with a parent directory")]
    NotAFile { path: String },
    #[error("cannot create sidecar at {path}: {source}")]
    Sidecar {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("context store: {0}")]
    Store(#[from] rusqlite::Error),
    #[error("no such comment thread: {0}")]
    NoSuchThread(String),
    #[error("no such conversation: {0}")]
    NoSuchConversation(String),
}

/// How many of a conversation's most recent entries a restore hands back.
///
/// A cap rather than the whole log, and a tail rather than a head: the thing
/// an author reopens a document to see is what the agent last did, not how the
/// conversation opened three weeks ago. Nothing is deleted to make the cap
/// work — the rows stay, and a surface that wants to page further back can ask
/// for more without a migration.
///
/// 400 because the cost being bounded is React's, not SQLite's: every restored
/// entry becomes a mounted transcript row, and a long agent turn emits
/// thousands (thoughts arrive one word per event and fold, but tool calls do
/// not).
pub const TRANSCRIPT_TAIL: usize = 400;

pub type Result<T> = std::result::Result<T, ContextError>;

/// An opaque, stable identifier.
///
/// The workspace has no `uuid` dependency and does not need one: blake3 over
/// (nanosecond clock, process id, in-process counter) collides only when the
/// same process mints two IDs in the same nanosecond at the same counter
/// value, which the counter itself rules out.
pub(crate) fn opaque_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let mut hasher = blake3::Hasher::new();
    hasher.update(&now.as_nanos().to_le_bytes());
    hasher.update(&std::process::id().to_le_bytes());
    hasher.update(&COUNTER.fetch_add(1, Ordering::Relaxed).to_le_bytes());
    hasher.finalize().to_hex()[..32].to_string()
}

/// A heading as an anchor names it: text, depth, and which occurrence of
/// that (text, depth) pair this is, counting from zero.
///
/// The ordinal is what tells two `## Methods` sections apart. Heading text
/// alone cannot — the diff engine learned the same lesson — and an anchor
/// that lands in the wrong duplicate is data corruption wearing a working
/// feature's clothes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionRef {
    pub text: String,
    /// 1–6.
    pub depth: u8,
    /// Zero-based occurrence among headings sharing this text and depth.
    pub ordinal: u32,
}

/// Who wrote a comment entry. `id` is a display name for a human, an agent
/// name for an agent — enough for a future collaborator without pretending
/// accounts exist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Actor {
    pub kind: ActorKind,
    pub id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActorKind {
    Human,
    Agent,
}

impl ActorKind {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            ActorKind::Human => "human",
            ActorKind::Agent => "agent",
        }
    }

    pub(crate) fn from_str(s: &str) -> Self {
        match s {
            "agent" => ActorKind::Agent,
            _ => ActorKind::Human,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreadState {
    Open,
    Resolved,
}

impl ThreadState {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            ThreadState::Open => "open",
            ThreadState::Resolved => "resolved",
        }
    }

    pub(crate) fn from_str(s: &str) -> Self {
        match s {
            "resolved" => ThreadState::Resolved,
            _ => ThreadState::Open,
        }
    }
}

/// Everything recorded about where a comment belongs.
///
/// Three layers of evidence, weakest to strongest at survival: exact
/// ProseMirror positions (valid only against `created_hash`), the quote plus
/// ~a line of context either side, and the section corridor the selection
/// started and ended in. Reconciliation (`place_anchor`) works down that
/// list and refuses to guess.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    pub id: String,
    pub document_id: String,
    /// The content hash the stored positions are valid against. Updated when
    /// the frontend refreshes anchors after a save, so "exact" stays exact.
    pub created_hash: String,
    pub pm_from: i64,
    pub pm_to: i64,
    pub selected_text: String,
    pub context_before: String,
    pub context_after: String,
    pub start_section: Option<SectionRef>,
    pub end_section: Option<SectionRef>,
    /// Byte range into the Markdown source, when a later source-index phase
    /// records one. Nullable now; the column exists so that phase is a
    /// migration-free addition.
    pub source_from: Option<i64>,
    pub source_to: Option<i64>,
    pub confidence: f64,
    /// Set when this anchor was superseded by a manual reattachment. The
    /// thread points at the replacement; this row stays as history.
    pub detached_at: Option<Timestamp>,
    pub version: i64,
}

/// What the frontend supplies when a comment is created or reattached: the
/// live selection, described well enough to survive the document changing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAnchor {
    pub pm_from: i64,
    pub pm_to: i64,
    pub selected_text: String,
    pub context_before: String,
    pub context_after: String,
    pub start_section: Option<SectionRef>,
    pub end_section: Option<SectionRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentThread {
    pub id: String,
    pub document_id: String,
    pub anchor_id: String,
    pub state: ThreadState,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub resolved_at: Option<Timestamp>,
    pub deleted_at: Option<Timestamp>,
    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentEntry {
    pub id: String,
    pub thread_id: String,
    pub actor_kind: ActorKind,
    pub actor_id: Option<String>,
    pub body: String,
    pub created_at: Timestamp,
    pub edited_at: Option<Timestamp>,
    pub deleted_at: Option<Timestamp>,
    pub version: i64,
}

/// One thread with everything a review surface needs: its entries, its
/// current anchor, and where that anchor lands in the document on screen.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacedThread {
    pub thread: CommentThread,
    pub entries: Vec<CommentEntry>,
    pub anchor: Anchor,
    pub placement: Placement,
}

/// One anchor's post-save correction, applied in bulk by
/// `ContextStore::refresh_anchors` after the frontend saves successfully.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchorUpdate {
    pub thread_id: String,
    #[serde(flatten)]
    pub anchor: NewAnchor,
}

// ————— Agent transcripts —————

/// One run of talking to one agent about one document.
///
/// A conversation is the author's unit, not the protocol's. An ACP session
/// ends when its subprocess does — a crash, a restart, "End session", the
/// adapter's own timeout — and none of those mean the author has finished the
/// subject. So sessions come and go inside a conversation, and the only thing
/// that closes one is the author saying so.
///
/// `ended_at` is that saying-so, and it is the whole reason this row exists:
/// restoring reads the newest conversation with `ended_at IS NULL`, so
/// "start a new conversation" is a line drawn rather than a delete. What was
/// said stays on disk; it simply stops being what the panel opens with.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub document_id: String,
    /// The agent that was talking, as it last identified itself. Nullable
    /// because the first entries can be recorded before an agent is
    /// connected — the author's own prompt is a transcript entry too.
    pub agent_name: Option<String>,
    pub started_at: Timestamp,
    pub updated_at: Timestamp,
    /// Set when the author started a new conversation. Never a deletion.
    pub ended_at: Option<Timestamp>,
}

/// One line of the transcript, as the panel drew it.
///
/// `payload` is opaque here on purpose — see the note above
/// `ContextStore::record_transcript`. `kind` is lifted out of it into a column
/// so a reader can tell a prompt from a thought without parsing, which is the
/// one question this crate might plausibly be asked and the only one worth
/// paying a column for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptEntry {
    /// Position in the conversation. Assigned by the panel, monotonic, and
    /// the primary key beside the conversation id — which is what makes
    /// recording a streaming entry an upsert rather than a duplicate.
    pub seq: i64,
    pub kind: String,
    pub payload: String,
    pub created_at: Timestamp,
}

/// An entry on its way in: no timestamp, because the store dates it, and an
/// entry re-recorded as its chunks arrive keeps the time it first appeared.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTranscriptEntry {
    pub seq: i64,
    pub kind: String,
    pub payload: String,
}

/// What a restore hands back: the open conversation and its tail.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTranscript {
    pub conversation: Conversation,
    pub entries: Vec<TranscriptEntry>,
}
