//! The `.essay/history.sqlite` snapshot store.
//!
//! One sidecar per directory, shared by the Markdown files in it, keyed by
//! file name. Snapshots are whole sources, content-addressed — a forty-page
//! manuscript is well under a megabyte and correctness beats clever delta
//! storage until there is evidence otherwise.
//!
//! The sidecar is disposable by construction: delete `.essay/` and you lose
//! history, never a document.

use crate::file::hash_source;
use crate::{Result, WorkspaceError};
use essay_revisions::{
    now_millis, Revision, RevisionAuthor, RevisionId, RevisionOrigin, SourceHash,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};

/// A run of human typing with no long pause collapses into one revision —
/// "a focused human editing session", not one row per autosave.
const SESSION_GAP_MS: i64 = 5 * 60 * 1000;

pub fn sidecar_dir(document: &Path) -> Option<PathBuf> {
    document.parent().map(|dir| dir.join(".essay"))
}

/// File name of the document within its sidecar's directory.
fn document_key(document: &Path) -> Option<String> {
    document
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
}

pub struct SnapshotStore {
    conn: Connection,
    doc: String,
}

impl SnapshotStore {
    /// Open (creating if needed) the sidecar store alongside `document`.
    pub fn for_document(document: &Path) -> Result<Self> {
        let not_a_file = || WorkspaceError::NotAFile {
            path: document.display().to_string(),
        };
        let dir = sidecar_dir(document).ok_or_else(not_a_file)?;
        let doc = document_key(document).ok_or_else(not_a_file)?;

        std::fs::create_dir_all(&dir).map_err(|source| WorkspaceError::Write {
            path: dir.display().to_string(),
            source,
        })?;
        // Application state, not manuscript: keep it out of the author's
        // repository by default. Deleting the file re-enables tracking.
        let ignore = dir.join(".gitignore");
        if !ignore.exists() {
            let _ = std::fs::write(&ignore, "# Essay application state — safe to delete.\n*\n");
        }

        let conn = Connection::open(dir.join("history.sqlite"))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn, doc })
    }

    /// Record `source` as the document's current state.
    ///
    /// Idempotent on content: snapshotting a source the newest revision
    /// already holds returns that revision rather than growing the timeline.
    pub fn snapshot(
        &self,
        source: &str,
        origin: RevisionOrigin,
        author: RevisionAuthor,
        instruction: Option<String>,
    ) -> Result<Revision> {
        let hash = hash_source(source);
        let latest = self.latest()?;

        if let Some(latest) = &latest {
            if latest.source_hash.0 == hash {
                return Ok(latest.clone());
            }
        }

        self.conn.execute(
            "INSERT OR IGNORE INTO blobs (hash, content) VALUES (?1, ?2)",
            params![hash, source],
        )?;

        // Does this continue the session in the newest revision, or start a
        // new one? Continuing rewrites that revision in place so the timeline
        // reads as sessions rather than as a log of autosaves.
        let continues = latest.as_ref().filter(|latest| {
            origin == RevisionOrigin::HumanSession
                && latest.origin == RevisionOrigin::HumanSession
                && latest.author == author
                && now_millis().saturating_sub(latest.created_at) < SESSION_GAP_MS
        });

        let (author_kind, author_name) = author_columns(&author);
        let created_at = now_millis();

        let revision = match continues {
            Some(latest) => {
                let parent_source = self.parent_source(&latest.id)?;
                let stats = essay_diff::word_stats(parent_source.as_deref().unwrap_or(""), source);
                self.conn.execute(
                    "UPDATE revisions
                        SET source_hash = ?1, created_at = ?2,
                            words_inserted = ?3, words_removed = ?4
                      WHERE id = ?5",
                    params![
                        hash,
                        created_at,
                        stats.words_inserted as i64,
                        stats.words_removed as i64,
                        row_id(&latest.id)
                    ],
                )?;
                self.prune_orphan_blobs()?;
                Revision {
                    source_hash: SourceHash(hash),
                    created_at,
                    words_inserted: stats.words_inserted,
                    words_removed: stats.words_removed,
                    ..latest.clone()
                }
            }
            None => {
                let parent_source = match &latest {
                    Some(latest) => self.source(&latest.source_hash.0)?,
                    None => None,
                };
                let stats = essay_diff::word_stats(parent_source.as_deref().unwrap_or(""), source);
                self.conn.execute(
                    "INSERT INTO revisions
                       (doc, parent_id, source_hash, author_kind, author_name,
                        instruction, origin, created_at, words_inserted, words_removed)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        self.doc,
                        latest.as_ref().map(|r| row_id(&r.id)),
                        hash,
                        author_kind,
                        author_name,
                        instruction,
                        origin.as_str(),
                        created_at,
                        stats.words_inserted as i64,
                        stats.words_removed as i64,
                    ],
                )?;
                Revision {
                    id: RevisionId(self.conn.last_insert_rowid().to_string()),
                    parent: latest.map(|r| r.id),
                    source_hash: SourceHash(hash),
                    author,
                    instruction,
                    created_at,
                    origin,
                    words_inserted: stats.words_inserted,
                    words_removed: stats.words_removed,
                }
            }
        };
        Ok(revision)
    }

    pub fn latest(&self) -> Result<Option<Revision>> {
        Ok(self
            .conn
            .query_row(
                &format!("{SELECT_REVISION} WHERE doc = ?1 ORDER BY id DESC LIMIT 1"),
                params![self.doc],
                read_revision,
            )
            .optional()?)
    }

    /// Newest first — the order the revision timeline reads in.
    pub fn revisions(&self, limit: usize) -> Result<Vec<Revision>> {
        let mut statement = self
            .conn
            .prepare(&format!("{SELECT_REVISION} WHERE doc = ?1 ORDER BY id DESC LIMIT ?2"))?;
        let rows = statement.query_map(params![self.doc, limit as i64], read_revision)?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    /// The full Markdown source behind a content hash, for diffing and
    /// restoring.
    pub fn source(&self, hash: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT content FROM blobs WHERE hash = ?1",
                params![hash],
                |row| row.get::<_, String>(0),
            )
            .optional()?)
    }

    fn parent_source(&self, id: &RevisionId) -> Result<Option<String>> {
        let hash: Option<String> = self
            .conn
            .query_row(
                "SELECT parent.source_hash
                   FROM revisions child
                   JOIN revisions parent ON parent.id = child.parent_id
                  WHERE child.id = ?1",
                params![row_id(id)],
                |row| row.get(0),
            )
            .optional()?;
        match hash {
            Some(hash) => self.source(&hash),
            None => Ok(None),
        }
    }

    /// Rewriting a session's revision orphans the source it used to point at.
    fn prune_orphan_blobs(&self) -> Result<()> {
        self.conn.execute(
            "DELETE FROM blobs
              WHERE hash NOT IN (SELECT source_hash FROM revisions)",
            [],
        )?;
        Ok(())
    }
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS blobs (
  hash    TEXT PRIMARY KEY,
  content TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS revisions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  doc            TEXT    NOT NULL,
  parent_id      INTEGER REFERENCES revisions(id),
  source_hash    TEXT    NOT NULL,
  author_kind    TEXT    NOT NULL,
  author_name    TEXT,
  instruction    TEXT,
  origin         TEXT    NOT NULL,
  created_at     INTEGER NOT NULL,
  words_inserted INTEGER NOT NULL DEFAULT 0,
  words_removed  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS revisions_by_doc ON revisions (doc, id);
";

const SELECT_REVISION: &str = "SELECT id, parent_id, source_hash, author_kind, author_name,
                                      instruction, origin, created_at,
                                      words_inserted, words_removed
                                 FROM revisions";

fn read_revision(row: &rusqlite::Row<'_>) -> rusqlite::Result<Revision> {
    let author_kind: String = row.get(3)?;
    let author_name: Option<String> = row.get(4)?;
    let origin: String = row.get(6)?;
    Ok(Revision {
        id: RevisionId(row.get::<_, i64>(0)?.to_string()),
        parent: row
            .get::<_, Option<i64>>(1)?
            .map(|id| RevisionId(id.to_string())),
        source_hash: SourceHash(row.get(2)?),
        author: match author_kind.as_str() {
            "human" => RevisionAuthor::Human {
                name: author_name.unwrap_or_default(),
            },
            "agent" => RevisionAuthor::Agent {
                name: author_name.unwrap_or_default(),
            },
            _ => RevisionAuthor::Unknown,
        },
        instruction: row.get(5)?,
        origin: RevisionOrigin::from_str(&origin).unwrap_or(RevisionOrigin::Checkpoint),
        created_at: row.get(7)?,
        words_inserted: row.get::<_, i64>(8)? as usize,
        words_removed: row.get::<_, i64>(9)? as usize,
    })
}

fn author_columns(author: &RevisionAuthor) -> (&'static str, Option<&str>) {
    match author {
        RevisionAuthor::Human { name } => ("human", Some(name.as_str())),
        RevisionAuthor::Agent { name } => ("agent", Some(name.as_str())),
        RevisionAuthor::Unknown => ("unknown", None),
    }
}

fn row_id(id: &RevisionId) -> i64 {
    id.0.parse().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn author() -> RevisionAuthor {
        RevisionAuthor::Human {
            name: "jack".into(),
        }
    }

    fn store() -> (tempfile::TempDir, SnapshotStore) {
        let dir = tempfile::tempdir().expect("tempdir");
        let doc = dir.path().join("essay.md");
        let store = SnapshotStore::for_document(&doc).expect("store");
        (dir, store)
    }

    #[test]
    fn snapshots_are_idempotent_on_content() {
        let (_dir, store) = store();
        let first = store
            .snapshot("# One\n", RevisionOrigin::Import, author(), None)
            .unwrap();
        let again = store
            .snapshot("# One\n", RevisionOrigin::Import, author(), None)
            .unwrap();

        assert_eq!(first.id, again.id);
        assert_eq!(store.revisions(10).unwrap().len(), 1);
    }

    #[test]
    fn a_typing_session_stays_one_revision() {
        let (_dir, store) = store();
        store
            .snapshot("# One\n", RevisionOrigin::Import, author(), None)
            .unwrap();
        for draft in ["# One\nA", "# One\nAb", "# One\nAbc"] {
            store
                .snapshot(draft, RevisionOrigin::HumanSession, author(), None)
                .unwrap();
        }

        let revisions = store.revisions(10).unwrap();
        assert_eq!(revisions.len(), 2, "import plus one session");
        assert_eq!(revisions[0].source_hash.0, hash_source("# One\nAbc"));
    }

    #[test]
    fn an_external_edit_never_folds_into_a_typing_session() {
        let (_dir, store) = store();
        store
            .snapshot("# One\n", RevisionOrigin::HumanSession, author(), None)
            .unwrap();
        store
            .snapshot(
                "# Rewritten by an agent\n",
                RevisionOrigin::ExternalEdit,
                RevisionAuthor::Unknown,
                None,
            )
            .unwrap();

        let revisions = store.revisions(10).unwrap();
        assert_eq!(revisions.len(), 2);
        assert_eq!(revisions[0].origin, RevisionOrigin::ExternalEdit);
    }

    #[test]
    fn every_snapshot_can_be_read_back_in_full() {
        let (_dir, store) = store();
        let first = store
            .snapshot("# One\n", RevisionOrigin::Import, author(), None)
            .unwrap();
        store
            .snapshot(
                "# Two\n",
                RevisionOrigin::ExternalEdit,
                RevisionAuthor::Unknown,
                None,
            )
            .unwrap();

        assert_eq!(
            store.source(&first.source_hash.0).unwrap().as_deref(),
            Some("# One\n"),
            "the superseded source must still be recoverable"
        );
    }

    #[test]
    fn word_stats_are_recorded_against_the_previous_revision() {
        let (_dir, store) = store();
        store
            .snapshot("the quick brown fox", RevisionOrigin::Import, author(), None)
            .unwrap();
        let next = store
            .snapshot(
                "the slow brown fox jumps",
                RevisionOrigin::ExternalEdit,
                RevisionAuthor::Unknown,
                None,
            )
            .unwrap();

        assert_eq!(next.words_inserted, 2);
        assert_eq!(next.words_removed, 1);
    }

    #[test]
    fn documents_in_one_directory_keep_separate_timelines() {
        let dir = tempfile::tempdir().expect("tempdir");
        let one = SnapshotStore::for_document(&dir.path().join("one.md")).unwrap();
        let two = SnapshotStore::for_document(&dir.path().join("two.md")).unwrap();

        one.snapshot("# One\n", RevisionOrigin::Import, author(), None)
            .unwrap();
        two.snapshot("# Two\n", RevisionOrigin::Import, author(), None)
            .unwrap();

        assert_eq!(one.revisions(10).unwrap().len(), 1);
        assert_eq!(two.revisions(10).unwrap().len(), 1);
        assert_eq!(
            one.latest().unwrap().unwrap().source_hash.0,
            hash_source("# One\n")
        );
    }

    #[test]
    fn the_sidecar_keeps_itself_out_of_the_authors_repository() {
        let (dir, _store) = store();
        let ignore = dir.path().join(".essay").join(".gitignore");
        assert!(ignore.exists());
        assert!(std::fs::read_to_string(ignore).unwrap().contains('*'));
    }
}
