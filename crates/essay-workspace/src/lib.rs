//! Project workspace: durable file IO, the `.essay` sidecar, revision
//! capture and external-edit watching.
//!
//! The Markdown and assets are portable; the `.essay` directory holds
//! application state (history.sqlite, metadata, caches, change sets) that can
//! be regenerated or discarded without corrupting the document. Two rules
//! shape everything here:
//!
//! 1. **The file on disk is canonical.** Every write is guarded by the hash
//!    the editor last saw. If the file moved underneath us — an agent, a
//!    `git checkout`, another editor — the write is refused and the caller
//!    gets both sides to reconcile. Nothing is ever silently overwritten.
//! 2. **No edit is lost, whoever made it.** Content is snapshotted into the
//!    sidecar before it can be replaced, and the in-progress buffer is
//!    journalled outside the document tree so a crash costs nothing.

mod file;
mod journal;
mod roots;
mod snapshot;
mod watcher;

pub use file::{hash_source, read_document, write_document, DocumentPayload, WriteOutcome};
pub use journal::{JournalEntry, RecoveryStore};
pub use roots::{markdown_tree, RootChange, RootWatcher};
pub use snapshot::{sidecar_dir, SnapshotStore};
pub use watcher::{DocumentWatcher, ExternalChange};

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error("cannot read {path}: {source}")]
    Read {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("cannot write {path}: {source}")]
    Write {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("{path} is not a file with a parent directory")]
    NotAFile { path: String },
    #[error("sidecar store: {0}")]
    Store(#[from] rusqlite::Error),
    #[error("file watcher: {0}")]
    Watch(#[from] notify::Error),
}

pub type Result<T> = std::result::Result<T, WorkspaceError>;
