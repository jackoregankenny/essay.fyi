//! Comment threads and range anchors — the shell's half of `essay-context`.
//!
//! Nothing here decides where a comment belongs; that lives in the crate,
//! where it is tested. These commands open the sidecar store beside the
//! document per call (same pattern as the snapshot commands: the store is
//! cheap to open and a held-open handle would outlive a deleted `.essay/`),
//! run on blocking threads because SQLite on disk is not something to do on
//! the UI's round trip, and are never called on the typing path — the
//! frontend debounces and refreshes off saves.
//!
//! Coordinates: `text` is the flattened live buffer (`manuscriptText()`),
//! `sections` its section spans, both in UTF-16 code units; `hash` is the
//! content hash of the *source* the buffer was loaded from. The store trusts
//! stored ProseMirror positions only when that hash still matches.

use essay_context::{
    Actor, ActorKind, AnchorUpdate, CommentEntry, CommentThread, ContextStore, NewAnchor,
    PlacedThread, SectionSpan,
};
use std::path::Path;

/// Same rule as `local_author` in `lib.rs`: local-first, no account to ask,
/// so an entry is attributed to whoever the OS says is at the keyboard.
fn local_actor() -> Actor {
    let id = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .ok()
        .filter(|name| !name.trim().is_empty());
    Actor {
        kind: ActorKind::Human,
        id,
    }
}

fn store_for(path: &str) -> Result<ContextStore, String> {
    ContextStore::for_document(Path::new(path)).map_err(|err| err.to_string())
}

/// Every live comment thread for the document, each anchor placed against
/// the buffer on screen: exact on a matching hash, relocated when the quote
/// and context prove a unique new home, unplaced otherwise.
#[tauri::command]
pub async fn list_comments(
    path: String,
    text: String,
    hash: String,
    sections: Vec<SectionSpan>,
) -> Result<Vec<PlacedThread>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = store_for(&path)?;
        let document_id = store
            .resolve_document(Path::new(&path), &hash)
            .map_err(|err| err.to_string())?;
        store
            .comments(&document_id, &text, &hash, &sections)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Start a thread on a selection. The anchor describes the selection well
/// enough to survive the document changing: positions for now, quote and
/// context and section corridor for later.
#[tauri::command]
pub async fn create_comment(
    path: String,
    hash: String,
    body: String,
    anchor: NewAnchor,
) -> Result<PlacedThread, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = store_for(&path)?;
        let document_id = store
            .resolve_document(Path::new(&path), &hash)
            .map_err(|err| err.to_string())?;
        store
            .create_comment(&document_id, &hash, &body, &local_actor(), &anchor)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn reply_comment(
    path: String,
    thread_id: String,
    body: String,
) -> Result<CommentEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        store_for(&path)?
            .reply(&thread_id, &local_actor(), &body)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Resolving changes no manuscript bytes — it is a state on the thread, and
/// the record survives for history.
#[tauri::command]
pub async fn resolve_comment(path: String, thread_id: String) -> Result<CommentThread, String> {
    tauri::async_runtime::spawn_blocking(move || {
        store_for(&path)?
            .resolve(&thread_id)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn reopen_comment(path: String, thread_id: String) -> Result<CommentThread, String> {
    tauri::async_runtime::spawn_blocking(move || {
        store_for(&path)?
            .reopen(&thread_id)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Tombstone, not removal: the thread leaves every listing but the record
/// stays, which is what lets a future sync see a deletion instead of
/// resurrecting the row.
#[tauri::command]
pub async fn delete_comment(path: String, thread_id: String) -> Result<CommentThread, String> {
    tauri::async_runtime::spawn_blocking(move || {
        store_for(&path)?
            .delete(&thread_id)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

/// The author's answer to an unplaced comment: point it at a new selection.
/// The old anchor is kept, detached — "it used to point there" is part of
/// the thread's history.
#[tauri::command]
pub async fn reattach_comment(
    path: String,
    thread_id: String,
    hash: String,
    anchor: NewAnchor,
) -> Result<PlacedThread, String> {
    tauri::async_runtime::spawn_blocking(move || {
        store_for(&path)?
            .reattach(&thread_id, &hash, &anchor)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Bulk anchor refresh after a successful save, so placed anchors track the
/// state that just reached disk and "exact" stays exact. Threads that
/// vanished since the frontend computed the batch are skipped; the count
/// that comes back is how many anchors actually moved.
#[tauri::command]
pub async fn refresh_comment_anchors(
    path: String,
    hash: String,
    updates: Vec<AnchorUpdate>,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        store_for(&path)?
            .refresh_anchors(&hash, &updates)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

/// The document's scratch note.
///
/// Same store, same open-per-call rule as everything above. It lives in this
/// module rather than its own because it is the same sidecar and the same
/// `document_id`; a second file to hold two commands would only make the
/// identity harder to see.
///
/// A document with no path cannot be scratched on — the note lives beside the
/// file, so an untitled buffer has nothing to live beside. The frontend gates
/// on that before calling, exactly as it does for comments.
#[tauri::command]
pub async fn read_scratch(path: String, hash: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = store_for(&path)?;
        let document_id = store
            .resolve_document(Path::new(&path), &hash)
            .map_err(|err| err.to_string())?;
        store.scratch(&document_id).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Replace the scratch note. Debounced by the caller — this is a disk write
/// and the pane it serves is a textarea someone is typing into.
#[tauri::command]
pub async fn write_scratch(path: String, hash: String, body: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = store_for(&path)?;
        let document_id = store
            .resolve_document(Path::new(&path), &hash)
            .map_err(|err| err.to_string())?;
        store
            .set_scratch(&document_id, &body)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}
