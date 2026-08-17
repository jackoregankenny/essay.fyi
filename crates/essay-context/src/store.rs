//! The `.essay/context.sqlite` store: document identity, comment threads and
//! their anchors.
//!
//! Same sidecar discipline as `SnapshotStore`: one database per directory,
//! shared by the Markdown files in it, created on first use, self-ignored
//! from git, and disposable — delete `.essay/` and you lose comments, never
//! a manuscript.
//!
//! Identity is the part worth reading twice. A path cannot own comments,
//! because Save As, rename and move are ordinary writing operations; a
//! content hash cannot either, because editing changes it on every keystroke.
//! So a document's identity is an opaque row, and paths and hashes are
//! *aliases* pointing at it. Resolution prefers the path it has seen before,
//! adopts by unique content hash when the path is new (that is rename/move
//! survival), and mints a fresh identity when the evidence is ambiguous —
//! two documents with identical bytes is exactly the case where guessing
//! attaches one author's comments to the other's file.

use crate::reconcile::{place_anchor, SectionSpan};
use crate::{
    opaque_id, Actor, ActorKind, Anchor, AnchorUpdate, CommentEntry, CommentThread, ContextError,
    NewAnchor, PlacedThread, Result, SectionRef, ThreadState,
};
use essay_revisions::now_millis;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

pub struct ContextStore {
    conn: Connection,
}

impl ContextStore {
    /// Open (creating if needed) the context store beside `document`.
    pub fn for_document(document: &Path) -> Result<Self> {
        let dir = essay_workspace::sidecar_dir(document).ok_or_else(|| ContextError::NotAFile {
            path: document.display().to_string(),
        })?;
        std::fs::create_dir_all(&dir).map_err(|source| ContextError::Sidecar {
            path: dir.display().to_string(),
            source,
        })?;
        // Application state, not manuscript — same rule as history.sqlite,
        // repeated here because either store can be the one that creates the
        // directory.
        let ignore = dir.join(".gitignore");
        if !ignore.exists() {
            let _ = std::fs::write(&ignore, "# Essay application state — safe to delete.\n*\n");
        }

        let conn = Connection::open(dir.join("context.sqlite"))?;
        // WAL + NORMAL for the same reason as the snapshot store: these
        // writes ride user actions, and a full-fsync stall is a pause the
        // author feels. A power cut can cost the last comment written, and a
        // comment is not the document.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    // ————— Identity —————

    /// The stable identity behind (path, current content hash), minting one
    /// if nothing resolves.
    ///
    /// Also records what it learned: every resolution refreshes the alias
    /// table, which is what lets the *next* resolution survive a rename.
    pub fn resolve_document(&self, path: &Path, content_hash: &str) -> Result<String> {
        let path = path.display().to_string();
        let tx = self.conn.unchecked_transaction()?;

        // A path this store has seen keeps its identity, whatever the bytes
        // say — the author editing a file does not make it a new document.
        let by_path: Option<String> = tx
            .query_row(
                "SELECT document_id FROM document_aliases
                  WHERE path = ?1 ORDER BY seen_at DESC LIMIT 1",
                params![path],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(id) = by_path {
            record_alias(&tx, &id, &path, content_hash)?;
            tx.commit()?;
            return Ok(id);
        }

        // New path. If exactly one known identity has held these bytes, this
        // is that document renamed or moved — adopt it. Two candidates means
        // two documents with identical content, and guessing between them
        // would hand one author's comments to the other's file: mint fresh.
        let mut candidates = tx.prepare(
            "SELECT DISTINCT document_id FROM document_aliases WHERE content_hash = ?1",
        )?;
        let ids: Vec<String> = candidates
            .query_map(params![content_hash], |row| row.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        drop(candidates);

        let id = match ids.as_slice() {
            [only] => only.clone(),
            _ => {
                let id = opaque_id();
                tx.execute(
                    "INSERT INTO documents (id, created_at) VALUES (?1, ?2)",
                    params![id, now_millis()],
                )?;
                id
            }
        };
        record_alias(&tx, &id, &path, content_hash)?;
        tx.commit()?;
        Ok(id)
    }

    // ————— Comments —————

    /// Start a thread: anchor, thread and first entry, in one transaction.
    pub fn create_comment(
        &self,
        document_id: &str,
        content_hash: &str,
        body: &str,
        actor: &Actor,
        anchor: &NewAnchor,
    ) -> Result<PlacedThread> {
        let now = now_millis();
        let tx = self.conn.unchecked_transaction()?;
        let anchor_id = insert_anchor(&tx, document_id, content_hash, anchor)?;
        let thread_id = opaque_id();
        tx.execute(
            "INSERT INTO comment_threads
               (id, document_id, anchor_id, state, created_at, updated_at, version)
             VALUES (?1, ?2, ?3, 'open', ?4, ?4, 1)",
            params![thread_id, document_id, anchor_id, now],
        )?;
        insert_entry(&tx, &thread_id, actor, body, now)?;
        tx.commit()?;
        self.thread_detail(&thread_id)
    }

    /// Every live (non-tombstoned) thread for a document, resolved comments
    /// included — hiding those is the surface's choice, not storage's — with
    /// each anchor placed against the document as it stands.
    pub fn comments(
        &self,
        document_id: &str,
        text: &str,
        content_hash: &str,
        sections: &[SectionSpan],
    ) -> Result<Vec<PlacedThread>> {
        let mut statement = self.conn.prepare(&format!(
            "{SELECT_THREAD} WHERE document_id = ?1 AND deleted_at IS NULL
              ORDER BY created_at, rowid"
        ))?;
        let threads: Vec<CommentThread> = statement
            .query_map(params![document_id], read_thread)?
            .collect::<std::result::Result<_, _>>()?;
        threads
            .into_iter()
            .map(|thread| {
                let entries = self.entries(&thread.id)?;
                let anchor = self.anchor(&thread.anchor_id)?;
                let placement = place_anchor(&anchor, text, content_hash, sections);
                Ok(PlacedThread { thread, entries, anchor, placement })
            })
            .collect()
    }

    /// Add an entry to a thread. The thread's `updated_at`/`version` move
    /// with it, so a sync can see the thread changed without diffing entries.
    pub fn reply(&self, thread_id: &str, actor: &Actor, body: &str) -> Result<CommentEntry> {
        let now = now_millis();
        let tx = self.conn.unchecked_transaction()?;
        self.require_live_thread(thread_id)?;
        let entry_id = insert_entry(&tx, thread_id, actor, body, now)?;
        touch_thread(&tx, thread_id, now)?;
        tx.commit()?;
        self.entry(&entry_id)
    }

    /// The document's scratch note: the half of the task pane that is *not*
    /// in the manuscript.
    ///
    /// One row per document, overwritten in place. No history, no versions,
    /// no tombstone — deliberately unlike everything else in this store.
    /// Comments and anchors are claims about the manuscript and have to
    /// survive being wrong; a scratch note is thinking-out-loud that happens
    /// to persist, and versioning it would be filing someone's shopping list.
    ///
    /// Absent is empty, not an error. A document that has never been scratched
    /// on and one that has been scratched on and cleared are the same document.
    pub fn scratch(&self, document_id: &str) -> Result<String> {
        Ok(self
            .conn
            .query_row(
                "SELECT body FROM scratch WHERE document_id = ?1",
                params![document_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_default())
    }

    /// Replace the scratch note. Writing an empty body removes the row rather
    /// than storing a blank one, so `.essay/` carries nothing for a document
    /// whose note has been cleared.
    pub fn set_scratch(&self, document_id: &str, body: &str) -> Result<()> {
        if body.is_empty() {
            self.conn.execute(
                "DELETE FROM scratch WHERE document_id = ?1",
                params![document_id],
            )?;
            return Ok(());
        }
        self.conn.execute(
            "INSERT INTO scratch (document_id, body, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(document_id) DO UPDATE SET body = ?2, updated_at = ?3",
            params![document_id, body, now_millis()],
        )?;
        Ok(())
    }

    pub fn resolve(&self, thread_id: &str) -> Result<CommentThread> {
        self.set_state(thread_id, ThreadState::Resolved)
    }

    pub fn reopen(&self, thread_id: &str) -> Result<CommentThread> {
        self.set_state(thread_id, ThreadState::Open)
    }

    fn set_state(&self, thread_id: &str, state: ThreadState) -> Result<CommentThread> {
        let now = now_millis();
        self.require_live_thread(thread_id)?;
        let resolved_at = match state {
            ThreadState::Resolved => Some(now),
            ThreadState::Open => None,
        };
        self.conn.execute(
            "UPDATE comment_threads
                SET state = ?1, resolved_at = ?2, updated_at = ?3, version = version + 1
              WHERE id = ?4",
            params![state.as_str(), resolved_at, now, thread_id],
        )?;
        self.thread(thread_id)
    }

    /// Tombstone a thread. The row, its entries and its anchors all stay —
    /// deletion is a state, not an absence, or a future sync would resurrect
    /// what one machine deleted because another still had it.
    pub fn delete(&self, thread_id: &str) -> Result<CommentThread> {
        let now = now_millis();
        self.require_live_thread(thread_id)?;
        self.conn.execute(
            "UPDATE comment_threads
                SET deleted_at = ?1, updated_at = ?1, version = version + 1
              WHERE id = ?2",
            params![now, thread_id],
        )?;
        self.thread(thread_id)
    }

    /// Manual reattachment: a new anchor for the thread, the old one kept
    /// but marked detached. New row rather than update because this is an
    /// author decision worth being able to see — "it used to point there."
    pub fn reattach(
        &self,
        thread_id: &str,
        content_hash: &str,
        anchor: &NewAnchor,
    ) -> Result<PlacedThread> {
        let now = now_millis();
        let tx = self.conn.unchecked_transaction()?;
        let old = self.require_live_thread(thread_id)?;
        tx.execute(
            "UPDATE anchors SET detached_at = ?1, version = version + 1 WHERE id = ?2",
            params![now, old.anchor_id],
        )?;
        let document_id: String = tx.query_row(
            "SELECT document_id FROM comment_threads WHERE id = ?1",
            params![thread_id],
            |row| row.get(0),
        )?;
        let anchor_id = insert_anchor(&tx, &document_id, content_hash, anchor)?;
        tx.execute(
            "UPDATE comment_threads
                SET anchor_id = ?1, updated_at = ?2, version = version + 1
              WHERE id = ?3",
            params![anchor_id, now, thread_id],
        )?;
        tx.commit()?;
        self.thread_detail(thread_id)
    }

    /// Bulk anchor refresh after a successful save: placed anchors adopt the
    /// new hash and positions so "exact" stays exact. In-place updates, not
    /// new rows — this is tracking, not an editorial event. Returns how many
    /// anchors moved; threads that vanished meanwhile are skipped, not an
    /// error, because the frontend computed the batch against a moment ago.
    pub fn refresh_anchors(&self, content_hash: &str, updates: &[AnchorUpdate]) -> Result<usize> {
        let tx = self.conn.unchecked_transaction()?;
        let mut refreshed = 0;
        for update in updates {
            let anchor_id: Option<String> = tx
                .query_row(
                    "SELECT anchor_id FROM comment_threads
                      WHERE id = ?1 AND deleted_at IS NULL",
                    params![update.thread_id],
                    |row| row.get(0),
                )
                .optional()?;
            let Some(anchor_id) = anchor_id else { continue };
            let a = &update.anchor;
            let (start, end) = (section_columns(&a.start_section), section_columns(&a.end_section));
            refreshed += tx.execute(
                "UPDATE anchors SET
                    created_hash = ?1, pm_from = ?2, pm_to = ?3, selected_text = ?4,
                    context_before = ?5, context_after = ?6,
                    start_section_text = ?7, start_section_depth = ?8, start_section_ordinal = ?9,
                    end_section_text = ?10, end_section_depth = ?11, end_section_ordinal = ?12,
                    confidence = 1.0, version = version + 1
                  WHERE id = ?13 AND detached_at IS NULL",
                params![
                    content_hash,
                    a.pm_from,
                    a.pm_to,
                    a.selected_text,
                    a.context_before,
                    a.context_after,
                    start.0, start.1, start.2,
                    end.0, end.1, end.2,
                    anchor_id
                ],
            )?;
        }
        tx.commit()?;
        Ok(refreshed)
    }

    // ————— Reads —————

    pub fn thread(&self, thread_id: &str) -> Result<CommentThread> {
        self.conn
            .query_row(
                &format!("{SELECT_THREAD} WHERE id = ?1"),
                params![thread_id],
                read_thread,
            )
            .optional()?
            .ok_or_else(|| ContextError::NoSuchThread(thread_id.to_string()))
    }

    /// One thread with entries and current anchor — no placement, because the
    /// callers that want one already know the answer (a fresh anchor is exact
    /// by construction).
    pub fn thread_detail(&self, thread_id: &str) -> Result<PlacedThread> {
        let thread = self.thread(thread_id)?;
        let entries = self.entries(thread_id)?;
        let anchor = self.anchor(&thread.anchor_id)?;
        let placement = crate::Placement::Exact {
            pm_from: anchor.pm_from,
            pm_to: anchor.pm_to,
        };
        Ok(PlacedThread { thread, entries, anchor, placement })
    }

    fn entries(&self, thread_id: &str) -> Result<Vec<CommentEntry>> {
        let mut statement = self.conn.prepare(&format!(
            "{SELECT_ENTRY} WHERE thread_id = ?1 AND deleted_at IS NULL
              ORDER BY created_at, rowid"
        ))?;
        let entries = statement
            .query_map(params![thread_id], read_entry)?
            .collect::<std::result::Result<_, _>>()?;
        Ok(entries)
    }

    fn entry(&self, entry_id: &str) -> Result<CommentEntry> {
        Ok(self.conn.query_row(
            &format!("{SELECT_ENTRY} WHERE id = ?1"),
            params![entry_id],
            read_entry,
        )?)
    }

    fn anchor(&self, anchor_id: &str) -> Result<Anchor> {
        Ok(self.conn.query_row(
            &format!("{SELECT_ANCHOR} WHERE id = ?1"),
            params![anchor_id],
            read_anchor,
        )?)
    }

    /// The thread, if it exists and is not tombstoned. Mutating a deleted
    /// thread is refused rather than quietly resurrecting it.
    fn require_live_thread(&self, thread_id: &str) -> Result<CommentThread> {
        let thread = self.thread(thread_id)?;
        if thread.deleted_at.is_some() {
            return Err(ContextError::NoSuchThread(thread_id.to_string()));
        }
        Ok(thread)
    }
}

fn record_alias(conn: &Connection, document_id: &str, path: &str, hash: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO document_aliases (document_id, path, content_hash, seen_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (document_id, path, content_hash)
         DO UPDATE SET seen_at = excluded.seen_at",
        params![document_id, path, hash, now_millis()],
    )?;
    Ok(())
}

fn insert_anchor(
    conn: &Connection,
    document_id: &str,
    content_hash: &str,
    anchor: &NewAnchor,
) -> Result<String> {
    let id = opaque_id();
    let (start, end) = (
        section_columns(&anchor.start_section),
        section_columns(&anchor.end_section),
    );
    conn.execute(
        "INSERT INTO anchors
           (id, document_id, created_hash, pm_from, pm_to, selected_text,
            context_before, context_after,
            start_section_text, start_section_depth, start_section_ordinal,
            end_section_text, end_section_depth, end_section_ordinal,
            source_from, source_to, confidence, version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                 NULL, NULL, 1.0, 1)",
        params![
            id,
            document_id,
            content_hash,
            anchor.pm_from,
            anchor.pm_to,
            anchor.selected_text,
            anchor.context_before,
            anchor.context_after,
            start.0, start.1, start.2,
            end.0, end.1, end.2,
        ],
    )?;
    Ok(id)
}

fn insert_entry(
    conn: &Connection,
    thread_id: &str,
    actor: &Actor,
    body: &str,
    now: i64,
) -> Result<String> {
    let id = opaque_id();
    conn.execute(
        "INSERT INTO comment_entries
           (id, thread_id, actor_kind, actor_id, body, created_at, version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
        params![id, thread_id, actor.kind.as_str(), actor.id, body, now],
    )?;
    Ok(id)
}

fn touch_thread(conn: &Connection, thread_id: &str, now: i64) -> Result<()> {
    conn.execute(
        "UPDATE comment_threads SET updated_at = ?1, version = version + 1 WHERE id = ?2",
        params![now, thread_id],
    )?;
    Ok(())
}

type SectionColumns = (Option<String>, Option<i64>, Option<i64>);

fn section_columns(section: &Option<SectionRef>) -> SectionColumns {
    match section {
        Some(s) => (Some(s.text.clone()), Some(s.depth as i64), Some(s.ordinal as i64)),
        None => (None, None, None),
    }
}

fn read_section(
    text: Option<String>,
    depth: Option<i64>,
    ordinal: Option<i64>,
) -> Option<SectionRef> {
    Some(SectionRef {
        text: text?,
        depth: depth? as u8,
        ordinal: ordinal? as u32,
    })
}

const SELECT_THREAD: &str = "SELECT id, document_id, anchor_id, state, created_at, updated_at,
                                    resolved_at, deleted_at, version
                               FROM comment_threads";

fn read_thread(row: &rusqlite::Row<'_>) -> rusqlite::Result<CommentThread> {
    let state: String = row.get(3)?;
    Ok(CommentThread {
        id: row.get(0)?,
        document_id: row.get(1)?,
        anchor_id: row.get(2)?,
        state: ThreadState::from_str(&state),
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        resolved_at: row.get(6)?,
        deleted_at: row.get(7)?,
        version: row.get(8)?,
    })
}

const SELECT_ENTRY: &str = "SELECT id, thread_id, actor_kind, actor_id, body, created_at,
                                   edited_at, deleted_at, version
                              FROM comment_entries";

fn read_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<CommentEntry> {
    let kind: String = row.get(2)?;
    Ok(CommentEntry {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        actor_kind: ActorKind::from_str(&kind),
        actor_id: row.get(3)?,
        body: row.get(4)?,
        created_at: row.get(5)?,
        edited_at: row.get(6)?,
        deleted_at: row.get(7)?,
        version: row.get(8)?,
    })
}

const SELECT_ANCHOR: &str = "SELECT id, document_id, created_hash, pm_from, pm_to, selected_text,
                                    context_before, context_after,
                                    start_section_text, start_section_depth, start_section_ordinal,
                                    end_section_text, end_section_depth, end_section_ordinal,
                                    source_from, source_to, confidence, detached_at, version
                               FROM anchors";

fn read_anchor(row: &rusqlite::Row<'_>) -> rusqlite::Result<Anchor> {
    Ok(Anchor {
        id: row.get(0)?,
        document_id: row.get(1)?,
        created_hash: row.get(2)?,
        pm_from: row.get(3)?,
        pm_to: row.get(4)?,
        selected_text: row.get(5)?,
        context_before: row.get(6)?,
        context_after: row.get(7)?,
        start_section: read_section(row.get(8)?, row.get(9)?, row.get(10)?),
        end_section: read_section(row.get(11)?, row.get(12)?, row.get(13)?),
        source_from: row.get(14)?,
        source_to: row.get(15)?,
        confidence: row.get(16)?,
        detached_at: row.get(17)?,
        version: row.get(18)?,
    })
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS document_aliases (
  document_id  TEXT NOT NULL REFERENCES documents(id),
  path         TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  seen_at      INTEGER NOT NULL,
  UNIQUE (document_id, path, content_hash)
);
CREATE INDEX IF NOT EXISTS aliases_by_path ON document_aliases (path, seen_at);
CREATE INDEX IF NOT EXISTS aliases_by_hash ON document_aliases (content_hash);
CREATE TABLE IF NOT EXISTS anchors (
  id                    TEXT PRIMARY KEY,
  document_id           TEXT NOT NULL,
  created_hash          TEXT NOT NULL,
  pm_from               INTEGER NOT NULL,
  pm_to                 INTEGER NOT NULL,
  selected_text         TEXT NOT NULL,
  context_before        TEXT NOT NULL,
  context_after         TEXT NOT NULL,
  start_section_text    TEXT,
  start_section_depth   INTEGER,
  start_section_ordinal INTEGER,
  end_section_text      TEXT,
  end_section_depth     INTEGER,
  end_section_ordinal   INTEGER,
  source_from           INTEGER,
  source_to             INTEGER,
  confidence            REAL NOT NULL DEFAULT 1.0,
  detached_at           INTEGER,
  version               INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS anchors_by_document ON anchors (document_id);
CREATE TABLE IF NOT EXISTS comment_threads (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  anchor_id   TEXT NOT NULL REFERENCES anchors(id),
  state       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  deleted_at  INTEGER,
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS threads_by_document ON comment_threads (document_id, created_at);
CREATE TABLE IF NOT EXISTS comment_entries (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES comment_threads(id),
  actor_kind TEXT NOT NULL,
  actor_id   TEXT,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  edited_at  INTEGER,
  deleted_at INTEGER,
  version    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS entries_by_thread ON comment_entries (thread_id, created_at);
CREATE TABLE IF NOT EXISTS scratch (
  document_id TEXT PRIMARY KEY,
  body        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Placement;

    fn human() -> Actor {
        Actor {
            kind: ActorKind::Human,
            id: Some("jack".into()),
        }
    }

    fn store() -> (tempfile::TempDir, ContextStore, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let doc = dir.path().join("essay.md");
        let store = ContextStore::for_document(&doc).expect("store");
        (dir, store, doc)
    }

    fn plain_anchor(quote: &str) -> NewAnchor {
        NewAnchor {
            pm_from: 12,
            pm_to: 40,
            selected_text: quote.into(),
            context_before: "context before ".into(),
            context_after: " context after".into(),
            start_section: Some(SectionRef { text: "Methods".into(), depth: 2, ordinal: 0 }),
            end_section: Some(SectionRef { text: "Methods".into(), depth: 2, ordinal: 0 }),
        }
    }

    #[test]
    fn a_comment_lives_a_full_life() {
        let (_dir, store, doc) = store();
        let id = store.resolve_document(&doc, "h1").unwrap();

        let created = store
            .create_comment(&id, "h1", "we say X here", &human(), &plain_anchor("the quote"))
            .unwrap();
        assert_eq!(created.thread.state, ThreadState::Open);
        assert_eq!(created.entries.len(), 1);
        assert_eq!(created.entries[0].body, "we say X here");
        assert_eq!(created.anchor.created_hash, "h1");
        assert_eq!(created.thread.version, 1);

        let reply = store.reply(&created.thread.id, &human(), "still true?").unwrap();
        assert_eq!(reply.thread_id, created.thread.id);
        let after_reply = store.thread(&created.thread.id).unwrap();
        assert!(after_reply.version > created.thread.version, "a reply moves the thread");

        let resolved = store.resolve(&created.thread.id).unwrap();
        assert_eq!(resolved.state, ThreadState::Resolved);
        assert!(resolved.resolved_at.is_some());
        assert!(resolved.version > after_reply.version);

        let reopened = store.reopen(&created.thread.id).unwrap();
        assert_eq!(reopened.state, ThreadState::Open);
        assert_eq!(reopened.resolved_at, None);
        assert!(reopened.version > resolved.version);
    }

    #[test]
    fn deletion_is_a_tombstone_not_an_absence() {
        let (_dir, store, doc) = store();
        let id = store.resolve_document(&doc, "h1").unwrap();
        let created = store
            .create_comment(&id, "h1", "delete me", &human(), &plain_anchor("q"))
            .unwrap();

        let deleted = store.delete(&created.thread.id).unwrap();
        assert!(deleted.deleted_at.is_some());
        assert!(deleted.version > created.thread.version);

        // Gone from the listing…
        assert!(store.comments(&id, "text", "h1", &[]).unwrap().is_empty());
        // …but the row survives, and cannot be mutated back to life quietly.
        assert!(store.thread(&created.thread.id).is_ok());
        assert!(matches!(
            store.reply(&created.thread.id, &human(), "zombie"),
            Err(ContextError::NoSuchThread(_))
        ));
        assert!(store.delete(&created.thread.id).is_err());
    }

    #[test]
    fn listing_places_each_anchor_against_the_current_text() {
        let (_dir, store, doc) = store();
        let id = store.resolve_document(&doc, "h1").unwrap();
        let anchor = NewAnchor {
            pm_from: 5,
            pm_to: 15,
            selected_text: "the needle".into(),
            context_before: "text around ".into(),
            context_after: " sits here".into(),
            start_section: None,
            end_section: None,
        };
        store.create_comment(&id, "h1", "note", &human(), &anchor).unwrap();

        // Same hash: stored positions are trusted.
        let placed = store
            .comments(&id, "text around the needle sits here", "h1", &[])
            .unwrap();
        assert_eq!(placed[0].placement, Placement::Exact { pm_from: 5, pm_to: 15 });

        // Changed hash: the quote is found where it now is.
        let placed = store
            .comments(&id, "prefix! text around the needle sits here", "h2", &[])
            .unwrap();
        match placed[0].placement {
            Placement::Relocated { offset_from, .. } => assert_eq!(offset_from, 20),
            ref other => panic!("expected relocation, got {other:?}"),
        }
    }

    #[test]
    fn reattaching_keeps_the_old_anchor_as_history() {
        let (_dir, store, doc) = store();
        let id = store.resolve_document(&doc, "h1").unwrap();
        let created = store
            .create_comment(&id, "h1", "note", &human(), &plain_anchor("old quote"))
            .unwrap();

        let reattached = store
            .reattach(&created.thread.id, "h2", &plain_anchor("new quote"))
            .unwrap();
        assert_ne!(reattached.anchor.id, created.anchor.id, "a new anchor row");
        assert_eq!(reattached.anchor.selected_text, "new quote");
        assert_eq!(reattached.anchor.created_hash, "h2");
        assert!(reattached.thread.version > created.thread.version);

        // The superseded anchor is detached, not gone.
        let old = store.anchor(&created.anchor.id).unwrap();
        assert!(old.detached_at.is_some());
    }

    #[test]
    fn refreshing_anchors_tracks_the_latest_save() {
        let (_dir, store, doc) = store();
        let id = store.resolve_document(&doc, "h1").unwrap();
        let created = store
            .create_comment(&id, "h1", "note", &human(), &plain_anchor("the quote"))
            .unwrap();

        let mut anchor = plain_anchor("the quote");
        anchor.pm_from = 99;
        anchor.pm_to = 120;
        let refreshed = store
            .refresh_anchors(
                "h2",
                &[
                    AnchorUpdate { thread_id: created.thread.id.clone(), anchor },
                    // A thread that never existed is skipped, not an error.
                    AnchorUpdate { thread_id: "missing".into(), anchor: plain_anchor("x") },
                ],
            )
            .unwrap();
        assert_eq!(refreshed, 1);

        let detail = store.thread_detail(&created.thread.id).unwrap();
        assert_eq!(detail.anchor.id, created.anchor.id, "in place, not a new row");
        assert_eq!(detail.anchor.created_hash, "h2");
        assert_eq!(detail.anchor.pm_from, 99);
        assert!(detail.anchor.version > created.anchor.version);
    }

    #[test]
    fn deleting_the_sidecar_loses_comments_and_nothing_else() {
        let dir = tempfile::tempdir().expect("tempdir");
        let doc = dir.path().join("essay.md");
        std::fs::write(&doc, "# The Manuscript\n").unwrap();

        let store = ContextStore::for_document(&doc).unwrap();
        let id = store.resolve_document(&doc, "h1").unwrap();
        store
            .create_comment(&id, "h1", "gone with the sidecar", &human(), &plain_anchor("q"))
            .unwrap();
        drop(store);

        std::fs::remove_dir_all(dir.path().join(".essay")).unwrap();

        let store = ContextStore::for_document(&doc).unwrap();
        let id = store.resolve_document(&doc, "h1").unwrap();
        assert!(store.comments(&id, "text", "h1", &[]).unwrap().is_empty());
        assert_eq!(
            std::fs::read_to_string(&doc).unwrap(),
            "# The Manuscript\n",
            "the manuscript is not the sidecar's to lose"
        );
    }

    #[test]
    fn scratch_round_trips_and_clearing_removes_the_row() {
        let (_dir, store, _doc) = store();
        let id = store.resolve_document(Path::new("scratch.md"), "h1").unwrap();

        assert_eq!(store.scratch(&id).unwrap(), "", "never scratched on is empty");

        store.set_scratch(&id, "- ring the printer\n- cut §3").unwrap();
        assert_eq!(store.scratch(&id).unwrap(), "- ring the printer\n- cut §3");

        store.set_scratch(&id, "replaced").unwrap();
        assert_eq!(store.scratch(&id).unwrap(), "replaced", "overwritten in place");

        // Cleared and never-written must be indistinguishable, or `.essay/`
        // accumulates a blank row per document anyone ever opened this pane on.
        store.set_scratch(&id, "").unwrap();
        assert_eq!(store.scratch(&id).unwrap(), "");
        let rows: i64 = store
            .conn
            .query_row("SELECT count(*) FROM scratch", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 0, "clearing removes the row rather than blanking it");
    }

    #[test]
    fn scratch_is_per_document_not_per_sidecar() {
        let (_dir, store, _doc) = store();
        let one = store.resolve_document(Path::new("one.md"), "h1").unwrap();
        let two = store.resolve_document(Path::new("two.md"), "h2").unwrap();

        store.set_scratch(&one, "one's notes").unwrap();
        assert_eq!(store.scratch(&two).unwrap(), "", "a folder-mate sees nothing");
        assert_eq!(store.scratch(&one).unwrap(), "one's notes");
    }

    #[test]
    fn the_sidecar_keeps_itself_out_of_the_authors_repository() {
        let (dir, _store, _doc) = store();
        let ignore = dir.path().join(".essay").join(".gitignore");
        assert!(ignore.exists());
        assert!(std::fs::read_to_string(ignore).unwrap().contains('*'));
    }

    // ————— Identity —————

    #[test]
    fn the_same_path_resolves_the_same_identity() {
        let (_dir, store, doc) = store();
        let first = store.resolve_document(&doc, "h1").unwrap();
        let edited = store.resolve_document(&doc, "h2").unwrap();
        assert_eq!(first, edited, "editing does not mint a new document");
    }

    #[test]
    fn a_rename_is_survived_by_its_content_hash() {
        let dir = tempfile::tempdir().expect("tempdir");
        let old = dir.path().join("draft.md");
        let new = dir.path().join("final.md");
        let store = ContextStore::for_document(&old).unwrap();

        let before = store.resolve_document(&old, "same-bytes").unwrap();
        // The file was renamed between sessions: new path, familiar bytes.
        let after = store.resolve_document(&new, "same-bytes").unwrap();
        assert_eq!(before, after, "the rename kept the comments");

        // And the new path now owns the identity outright, bytes or no bytes.
        let edited = store.resolve_document(&new, "edited-bytes").unwrap();
        assert_eq!(after, edited);
    }

    #[test]
    fn an_ambiguous_hash_mints_a_new_identity() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = ContextStore::for_document(&dir.path().join("a.md")).unwrap();

        // Two distinct documents that later converge on identical bytes —
        // the same template filled in the same way twice.
        let a = store.resolve_document(&dir.path().join("a.md"), "same").unwrap();
        let b = store.resolve_document(&dir.path().join("b.md"), "started-different").unwrap();
        assert_ne!(a, b);
        let b_again = store.resolve_document(&dir.path().join("b.md"), "same").unwrap();
        assert_eq!(b, b_again, "the path keeps its identity as the bytes move");

        // A third path holding those bytes could be either document renamed.
        // Two candidates is ambiguity, and ambiguity mints fresh — attaching
        // one author's comments to the other's file is the failure this rule
        // exists to prevent.
        let c = store.resolve_document(&dir.path().join("c.md"), "same").unwrap();
        assert_ne!(c, a);
        assert_ne!(c, b);
    }

    #[test]
    fn comments_stay_with_their_document_across_a_rename() {
        let dir = tempfile::tempdir().expect("tempdir");
        let old = dir.path().join("draft.md");
        let new = dir.path().join("final.md");
        let store = ContextStore::for_document(&old).unwrap();

        let id = store.resolve_document(&old, "bytes-v1").unwrap();
        store
            .create_comment(&id, "bytes-v1", "survives the rename", &human(), &plain_anchor("q"))
            .unwrap();

        let same = store.resolve_document(&new, "bytes-v1").unwrap();
        let comments = store.comments(&same, "text", "bytes-v1", &[]).unwrap();
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].entries[0].body, "survives the rename");
    }
}
