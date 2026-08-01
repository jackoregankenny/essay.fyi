//! Crash recovery for the in-progress buffer.
//!
//! Distinct from the snapshot store on purpose. Revision history describes a
//! document and belongs beside it; the journal is transient machine state
//! about *this installation's* unsaved buffers, so it lives in the app data
//! directory and never appears in the author's folders. It also has to work
//! for a document that has no folder yet — an untitled buffer is exactly the
//! case where a crash costs the most.

use crate::file::hash_source;
use crate::Result;
use essay_revisions::{now_millis, Timestamp};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    /// Absolute path for a saved document; an opaque session id otherwise.
    pub key: String,
    pub name: String,
    pub path: Option<String>,
    pub contents: String,
    /// What was on disk when this buffer was last in sync with it.
    pub base_hash: Option<String>,
    pub updated_at: Timestamp,
}

/// One long-lived connection behind a mutex: this store is application state
/// shared across Tauri's command threads, and a `rusqlite::Connection` is
/// `Send` but not `Sync`. Writes are one small row every few hundred
/// milliseconds, so the lock is never contended.
pub struct RecoveryStore {
    conn: Mutex<Connection>,
}

impl RecoveryStore {
    pub fn open(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir).map_err(|source| crate::WorkspaceError::Write {
            path: dir.display().to_string(),
            source,
        })?;
        let conn = Connection::open(dir.join("recovery.sqlite"))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Record the current buffer. Called on a short debounce while typing —
    /// far ahead of autosave, and the only protection an untitled buffer has.
    pub fn record(
        &self,
        key: &str,
        name: &str,
        path: Option<&str>,
        contents: &str,
        base_hash: Option<&str>,
    ) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO journal (key, name, path, contents, base_hash, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(key) DO UPDATE SET
               name = excluded.name, path = excluded.path,
               contents = excluded.contents, base_hash = excluded.base_hash,
               updated_at = excluded.updated_at",
            params![key, name, path, contents, base_hash, now_millis()],
        )?;
        Ok(())
    }

    /// Drop a buffer's journal — it reached disk, or the author discarded it.
    pub fn clear(&self, key: &str) -> Result<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("DELETE FROM journal WHERE key = ?1", params![key])?;
        Ok(())
    }

    /// Buffers that hold something the document on disk does not.
    ///
    /// Entries that turn out to match their file are dropped rather than
    /// offered: after a clean shutdown this is every entry, and being asked to
    /// "recover" work that was already saved would teach the author to
    /// dismiss the prompt without reading it.
    pub fn pending(&self) -> Result<Vec<JournalEntry>> {
        let entries = {
            let conn = self.conn.lock().unwrap();
            let mut statement = conn.prepare(
                "SELECT key, name, path, contents, base_hash, updated_at
                   FROM journal ORDER BY updated_at DESC",
            )?;
            let rows = statement.query_map([], |row| {
                Ok(JournalEntry {
                    key: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    contents: row.get(3)?,
                    base_hash: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };

        let (pending, settled): (Vec<_>, Vec<_>) =
            entries.into_iter().partition(|entry| is_unsaved(entry));
        for entry in settled {
            self.clear(&entry.key)?;
        }
        Ok(pending)
    }
}

fn is_unsaved(entry: &JournalEntry) -> bool {
    let Some(path) = &entry.path else {
        // Untitled: nothing on disk to compare against, so anything with
        // content is worth offering back.
        return !entry.contents.trim().is_empty();
    };
    match std::fs::read_to_string(path) {
        Ok(disk) => hash_source(&disk) != hash_source(&entry.contents),
        // The file went away; the buffer is the only copy left.
        Err(_) => true,
    }
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS journal (
  key        TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  path       TEXT,
  contents   TEXT NOT NULL,
  base_hash  TEXT,
  updated_at INTEGER NOT NULL
);
";

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, RecoveryStore) {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = RecoveryStore::open(dir.path()).expect("store");
        (dir, store)
    }

    #[test]
    fn an_untitled_buffer_survives_a_crash() {
        let (_dir, store) = store();
        store
            .record("untitled:1", "untitled.md", None, "# Half an idea\n", None)
            .unwrap();

        let pending = store.pending().unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].contents, "# Half an idea\n");
    }

    #[test]
    fn a_buffer_that_reached_disk_is_not_offered_back() {
        let (dir, store) = store();
        let doc = dir.path().join("essay.md");
        std::fs::write(&doc, "# Saved\n").unwrap();
        let path = doc.display().to_string();

        store
            .record(&path, "essay.md", Some(&path), "# Saved\n", None)
            .unwrap();

        assert!(store.pending().unwrap().is_empty());
        // …and the settled entry is cleaned up rather than re-checked forever.
        assert!(store.pending().unwrap().is_empty());
    }

    #[test]
    fn unsaved_edits_to_a_saved_document_are_offered_back() {
        let (dir, store) = store();
        let doc = dir.path().join("essay.md");
        std::fs::write(&doc, "# Saved\n").unwrap();
        let path = doc.display().to_string();

        store
            .record(
                &path,
                "essay.md",
                Some(&path),
                "# Saved\nplus a paragraph the crash ate\n",
                Some(&hash_source("# Saved\n")),
            )
            .unwrap();

        let pending = store.pending().unwrap();
        assert_eq!(pending.len(), 1);
        assert!(pending[0].contents.contains("crash ate"));
    }

    #[test]
    fn recording_the_same_buffer_twice_keeps_one_entry() {
        let (_dir, store) = store();
        store
            .record("untitled:1", "untitled.md", None, "one", None)
            .unwrap();
        store
            .record("untitled:1", "untitled.md", None, "one two", None)
            .unwrap();

        let pending = store.pending().unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].contents, "one two");
    }

    #[test]
    fn clearing_a_buffer_forgets_it() {
        let (_dir, store) = store();
        store
            .record("untitled:1", "untitled.md", None, "one", None)
            .unwrap();
        store.clear("untitled:1").unwrap();
        assert!(store.pending().unwrap().is_empty());
    }
}
