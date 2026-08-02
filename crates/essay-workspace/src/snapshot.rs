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
    now_millis, Revision, RevisionAuthor, RevisionId, RevisionOrigin, SourceHash, Timestamp,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// A run of human typing with no long pause collapses into one revision —
/// "a focused human editing session", not one row per autosave.
const SESSION_GAP_MS: i64 = 5 * 60 * 1000;

/// Milliseconds in a day. Also the unit the thinning groups by:
/// `created_at / DAY_MS` is the UTC day a revision belongs to. UTC rather than
/// local time because the grouping only ever decides which of a day's
/// autosaves survives three months later, and a store that thinned differently
/// depending on the machine's timezone would be the harder thing to reason
/// about.
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// Ordinary typing is kept in full for this long. Past it the timeline is
/// history rather than working memory, and one revision a day is the shape
/// somebody actually reads.
const PRUNE_HORIZON_MS: i64 = 90 * DAY_MS;

/// At most one pruning attempt a day per sidecar. `for_document` is called on
/// every save, not just when a document opens, so the common path has to be a
/// single primary-key lookup that says "already done today".
const PRUNE_INTERVAL_MS: i64 = DAY_MS;

/// Below this a VACUUM costs more than it reclaims, and VACUUM rewrites the
/// whole file — exactly the stall this store must never cause on an open.
const VACUUM_ROWS: usize = 50;

/// What thinning is allowed to touch: a human typing, with nothing recorded
/// about why.
///
/// Everything else carries provenance and is kept forever — an agent patch, an
/// edit the watcher caught from outside Essay, the import that starts a
/// timeline, a checkpoint, a restore. Those are the revisions somebody goes
/// looking for a year later ("what did the agent do to chapter three?"); a
/// Tuesday afternoon's autosaves are not. Where the author is anything but
/// plainly human, or an instruction was recorded, keep the row: an unfamiliar
/// revision is one whose value we cannot judge, and the conservative answer is
/// always to keep.
const PLAIN_TYPING: &str =
    "origin = 'human_session' AND author_kind = 'human' AND instruction IS NULL";

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
        // WAL and a relaxed fsync policy, deliberately. Both sidecar stores
        // ride the typing cadence — this one on every autosave, the recovery
        // journal 600ms after the last keystroke — and a full fsync stall on
        // the SQLite connection is a keystroke the author feels. WAL keeps
        // readers off the writer's back; NORMAL hands the decision about when
        // bytes reach the platter to the OS instead of blocking this thread on
        // it. The risk it buys is bounded and acceptable: a power cut can cost
        // the last transaction or two of *history*, and history is not the
        // document. The Markdown file is, and it is written separately through
        // a temp file plus `sync_all` (see `file.rs`).
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;

        let store = Self { conn, doc };
        // Housekeeping is opportunistic and best effort. A store that cannot
        // tidy itself must still open: refusing to hand back a timeline
        // because a maintenance query failed would trade the author's history
        // for tidiness, which is the wrong way round.
        store.tidy();
        Ok(store)
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

    /// Mark the document's current state as one the author chose to keep.
    ///
    /// Not an ordinary snapshot, because of the one case that matters:
    /// autosave has usually already recorded these exact bytes, so
    /// `snapshot` would find its own hash at the head of the timeline and
    /// return it unchanged. A state the author deliberately marked would then
    /// be indistinguishable from a pause in typing.
    ///
    /// Relabelling that revision is the honest reading of what a checkpoint
    /// is: the author is annotating a state, not creating one. Only when the
    /// bytes are genuinely new — marked before autosave caught up — does this
    /// insert.
    pub fn checkpoint(&self, source: &str, author: RevisionAuthor) -> Result<Revision> {
        let hash = hash_source(source);
        if let Some(latest) = self.latest()? {
            if latest.source_hash.0 == hash {
                self.conn.execute(
                    "UPDATE revisions SET origin = ?1 WHERE id = ?2",
                    params![RevisionOrigin::Checkpoint.as_str(), row_id(&latest.id)],
                )?;
                return Ok(Revision {
                    origin: RevisionOrigin::Checkpoint,
                    ..latest
                });
            }
        }
        self.snapshot(source, RevisionOrigin::Checkpoint, author, None)
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
    ///
    /// Blobs are content-addressed and therefore shared: two revisions that
    /// arrived at the same text point at one row. Deleting by "nothing
    /// references this" rather than by "the revision I just changed used to
    /// reference this" is what keeps a shared source alive for its other
    /// referent.
    fn prune_orphan_blobs(&self) -> Result<usize> {
        Ok(self.conn.execute(
            "DELETE FROM blobs
              WHERE hash NOT IN (SELECT source_hash FROM revisions)",
            [],
        )?)
    }

    /// Housekeeping, run when the store opens: at most once a day, silent, and
    /// unable to fail the open.
    fn tidy(&self) {
        let now = now_millis();
        match self.last_pruned() {
            Ok(Some(last)) if now.saturating_sub(last) < PRUNE_INTERVAL_MS => return,
            Ok(_) => {}
            // A store too broken to answer this is too broken to prune.
            Err(_) => return,
        }
        let _ = self.prune();
        let _ = self.note_pruned(now);
    }

    /// Thin ordinary typing older than the horizon to the last revision per
    /// document per calendar day, then drop any source no surviving revision
    /// needs. Returns how many rows went.
    ///
    /// The newest revision of a document is always the last one of its own
    /// calendar day, so it always survives — a manuscript nobody has touched
    /// in a year still opens onto the state it was left in.
    pub fn prune(&self) -> Result<usize> {
        let cutoff = now_millis() - PRUNE_HORIZON_MS;
        let doomed = self.thinnable(cutoff)?;
        if doomed.is_empty() {
            return Ok(0);
        }

        let removed = {
            let tx = self.conn.unchecked_transaction()?;
            relink_parents(&tx, &doomed)?;
            // The ids came out of this table a moment ago, so interpolating
            // them is safe; SQLite has no list parameter and binding a
            // variable number of placeholders is the same string-building with
            // more ceremony.
            let list = id_list(&doomed);
            let revisions =
                tx.execute(&format!("DELETE FROM revisions WHERE id IN ({list})"), [])?;
            // Same rule as everywhere else in this file: a source goes only
            // when nothing at all still points at it, so a text two revisions
            // arrived at independently survives for whichever one stays.
            let blobs = self.prune_orphan_blobs()?;
            tx.commit()?;
            revisions + blobs
        };

        if removed > VACUUM_ROWS {
            // Only once a long timeline actually collapses. VACUUM rewrites
            // the file, and paying that on every open is the stall the daily
            // interval and the row threshold exist to avoid.
            self.conn.execute_batch("VACUUM")?;
        }
        Ok(removed)
    }

    /// Revisions the thinning may take: plain typing past the horizon that is
    /// not the last of its document's day.
    fn thinnable(&self, cutoff: Timestamp) -> Result<Vec<i64>> {
        let sql = format!(
            "SELECT id FROM revisions
              WHERE created_at < ?1 AND {PLAIN_TYPING}
                AND id NOT IN (
                  SELECT MAX(id) FROM revisions
                   WHERE created_at < ?1 AND {PLAIN_TYPING}
                   GROUP BY doc, created_at / {DAY_MS}
                )
              ORDER BY id"
        );
        let mut statement = self.conn.prepare(&sql)?;
        let rows = statement.query_map(params![cutoff], |row| row.get::<_, i64>(0))?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    fn last_pruned(&self) -> Result<Option<Timestamp>> {
        Ok(self
            .conn
            .query_row(
                "SELECT value FROM housekeeping WHERE key = 'pruned_at'",
                [],
                |row| row.get(0),
            )
            .optional()?)
    }

    fn note_pruned(&self, at: Timestamp) -> Result<()> {
        self.conn.execute(
            "INSERT INTO housekeeping (key, value) VALUES ('pruned_at', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![at],
        )?;
        Ok(())
    }
}

/// Close the gaps the thinning is about to leave in the parent chain.
///
/// A survivor whose parent is going away inherits the nearest ancestor that
/// stays. Without this the timeline would show a revision with nothing behind
/// it purely because housekeeping ran, and `parent_source` — which is how a
/// continuing session works out its word counts — would find a dangling id.
/// It has to happen before the delete, because afterwards there is nothing
/// left to ask who the deleted row's own parent was.
fn relink_parents(conn: &Connection, doomed: &[i64]) -> Result<()> {
    let going: HashSet<i64> = doomed.iter().copied().collect();
    let parents: HashMap<i64, Option<i64>> = {
        let mut statement = conn.prepare("SELECT id, parent_id FROM revisions")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?))
        })?;
        rows.collect::<std::result::Result<HashMap<_, _>, _>>()?
    };

    for (id, parent) in &parents {
        if going.contains(id) {
            continue;
        }
        let Some(parent) = parent else { continue };
        if !going.contains(parent) {
            continue;
        }
        let mut ancestor = Some(*parent);
        while let Some(candidate) = ancestor {
            if !going.contains(&candidate) {
                break;
            }
            ancestor = parents.get(&candidate).copied().flatten();
        }
        conn.execute(
            "UPDATE revisions SET parent_id = ?1 WHERE id = ?2",
            params![ancestor, id],
        )?;
    }
    Ok(())
}

fn id_list(ids: &[i64]) -> String {
    ids.iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",")
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
CREATE INDEX IF NOT EXISTS revisions_by_age ON revisions (created_at);
CREATE TABLE IF NOT EXISTS housekeeping (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
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

    /// A UTC midnight long past the pruning horizon, so a test can place a
    /// revision on a chosen calendar day exactly rather than on "roughly
    /// ninety days ago", which would straddle a day boundary depending on the
    /// hour the suite happened to run.
    const LONG_AGO: Timestamp = 18_500 * DAY_MS;

    /// A revision written straight into the table at a chosen instant.
    ///
    /// The public path folds a run of typing into a single revision and stamps
    /// it `now`, which is exactly the history these tests need to reconstruct:
    /// several separate saves, months old. `parent_id` chains to the newest
    /// row for the document, the same shape `snapshot` builds.
    fn revision_at(
        store: &SnapshotStore,
        source: &str,
        at: Timestamp,
        origin: RevisionOrigin,
        author_kind: &str,
    ) -> i64 {
        let hash = hash_source(source);
        store
            .conn
            .execute(
                "INSERT OR IGNORE INTO blobs (hash, content) VALUES (?1, ?2)",
                params![hash, source],
            )
            .expect("blob");
        store
            .conn
            .execute(
                "INSERT INTO revisions
                   (doc, parent_id, source_hash, author_kind, author_name,
                    instruction, origin, created_at, words_inserted, words_removed)
                 VALUES (?1, (SELECT MAX(id) FROM revisions WHERE doc = ?1),
                         ?2, ?3, 'jack', NULL, ?4, ?5, 0, 0)",
                params![store.doc, hash, author_kind, origin.as_str(), at],
            )
            .expect("revision");
        store.conn.last_insert_rowid()
    }

    /// Ordinary typing: the only thing pruning is allowed to touch.
    fn autosave(store: &SnapshotStore, source: &str, at: Timestamp) -> i64 {
        revision_at(store, source, at, RevisionOrigin::HumanSession, "human")
    }

    fn agent_patch(store: &SnapshotStore, source: &str, at: Timestamp) -> i64 {
        revision_at(store, source, at, RevisionOrigin::AgentPatch, "agent")
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

    /// The case a plain `snapshot` call gets wrong: autosave has already
    /// recorded these bytes, so idempotence would swallow the mark entirely.
    #[test]
    fn a_checkpoint_marks_the_revision_autosave_already_wrote() {
        let (_dir, store) = store();
        let saved = store
            .snapshot("# Draft\n", RevisionOrigin::HumanSession, author(), None)
            .unwrap();

        let marked = store.checkpoint("# Draft\n", author()).unwrap();

        assert_eq!(marked.id, saved.id, "the state was already recorded");
        assert_eq!(marked.origin, RevisionOrigin::Checkpoint);
        assert_eq!(
            store.revisions(10).unwrap()[0].origin,
            RevisionOrigin::Checkpoint,
            "the mark has to survive a read, not just the return value"
        );
        assert_eq!(store.revisions(10).unwrap().len(), 1);
    }

    #[test]
    fn a_checkpoint_ahead_of_autosave_records_the_state() {
        let (_dir, store) = store();
        store
            .snapshot("# Draft\n", RevisionOrigin::HumanSession, author(), None)
            .unwrap();

        let marked = store.checkpoint("# Draft\nSent.\n", author()).unwrap();

        assert_eq!(marked.origin, RevisionOrigin::Checkpoint);
        assert_eq!(store.revisions(10).unwrap().len(), 2);
    }

    /// A checkpoint is a boundary, so the typing either side of it must not
    /// fold across it — otherwise marking a draft and carrying on would carry
    /// the mark forward onto text the author never marked.
    #[test]
    fn typing_after_a_checkpoint_starts_a_new_revision() {
        let (_dir, store) = store();
        store
            .snapshot("# Draft\n", RevisionOrigin::HumanSession, author(), None)
            .unwrap();
        store.checkpoint("# Draft\n", author()).unwrap();

        store
            .snapshot("# Draft\nMore.\n", RevisionOrigin::HumanSession, author(), None)
            .unwrap();

        let timeline = store.revisions(10).unwrap();
        assert_eq!(timeline.len(), 2);
        assert_eq!(timeline[0].origin, RevisionOrigin::HumanSession);
        assert_eq!(
            timeline[1].origin,
            RevisionOrigin::Checkpoint,
            "the marked state is still there, unchanged"
        );
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

    // ——— Pruning ———

    #[test]
    fn pruning_keeps_every_revision_that_carries_provenance() {
        let (_dir, store) = store();
        // All on one long-past day, so age and grouping would take every one
        // of them: provenance is the only thing keeping these alive.
        let carriers = [
            (RevisionOrigin::Import, "human"),
            (RevisionOrigin::AgentPatch, "agent"),
            (RevisionOrigin::ExternalEdit, "unknown"),
            (RevisionOrigin::Checkpoint, "human"),
            (RevisionOrigin::Restore, "human"),
            // A human session an agent authored is still not plain typing.
            (RevisionOrigin::HumanSession, "agent"),
        ];
        for (index, (origin, kind)) in carriers.iter().enumerate() {
            let source = format!("# Version {index}\n");
            revision_at(
                &store,
                &source,
                LONG_AGO + index as i64 * 60_000,
                *origin,
                kind,
            );
        }

        assert_eq!(store.prune().unwrap(), 0);
        assert_eq!(store.revisions(20).unwrap().len(), carriers.len());
    }

    #[test]
    fn pruning_thins_old_autosaves_to_one_a_day() {
        let (_dir, store) = store();
        for day in 0..2 {
            for save in 0..4 {
                let source = format!("day {day}, save {save}");
                autosave(&store, &source, LONG_AGO + day * DAY_MS + save * 60_000);
            }
        }
        // This week's work is not history yet and must not be touched.
        let recent = autosave(&store, "still writing", now_millis() - 60_000);

        assert_eq!(
            store.prune().unwrap(),
            12,
            "six revisions, and the six sources nothing referenced afterwards"
        );

        let left = store.revisions(20).unwrap();
        assert_eq!(left.len(), 3, "one for each old day, plus this week's");
        assert_eq!(row_id(&left[0].id), recent);
        assert_eq!(
            store.source(&left[1].source_hash.0).unwrap().as_deref(),
            Some("day 1, save 3"),
            "the last save of a day is the one worth keeping"
        );
        assert_eq!(
            store.source(&left[2].source_hash.0).unwrap().as_deref(),
            Some("day 0, save 3")
        );
    }

    #[test]
    fn pruning_never_orphans_a_source_a_surviving_revision_needs() {
        let (_dir, store) = store();
        // The same text saved twice and then patched by an agent: content
        // addressing means all three revisions point at one row in `blobs`.
        autosave(&store, "shared text", LONG_AGO);
        agent_patch(&store, "shared text", LONG_AGO + 60_000);
        autosave(&store, "the last save of the day", LONG_AGO + 120_000);

        assert_eq!(
            store.prune().unwrap(),
            1,
            "one revision, and no blob with it"
        );

        assert_eq!(
            store
                .source(&hash_source("shared text"))
                .unwrap()
                .as_deref(),
            Some("shared text"),
            "the agent's revision still needs this source"
        );
        assert_eq!(store.revisions(10).unwrap().len(), 2);
    }

    #[test]
    fn pruning_relinks_the_timeline_around_what_it_removed() {
        let (_dir, store) = store();
        let agent = agent_patch(&store, "the agent's version", LONG_AGO);
        autosave(&store, "typing one", LONG_AGO + 60_000);
        autosave(&store, "typing two", LONG_AGO + 120_000);
        let last = autosave(&store, "typing three", LONG_AGO + 180_000);

        store.prune().unwrap();

        let left = store.revisions(10).unwrap();
        assert_eq!(left.len(), 2);
        assert_eq!(row_id(&left[0].id), last);
        assert_eq!(
            left[0].parent.as_ref().map(row_id),
            Some(agent),
            "the survivor inherits the nearest ancestor that stayed, rather \
             than pointing at a row housekeeping deleted"
        );
    }

    #[test]
    fn a_fresh_store_has_nothing_to_prune() {
        let (_dir, store) = store();
        store
            .snapshot("# One\n", RevisionOrigin::Import, author(), None)
            .unwrap();
        for draft in ["# One\nA", "# One\nAb", "# One\nAbc"] {
            store
                .snapshot(draft, RevisionOrigin::HumanSession, author(), None)
                .unwrap();
        }

        assert_eq!(store.prune().unwrap(), 0);
        assert_eq!(store.revisions(10).unwrap().len(), 2);
    }

    #[test]
    fn a_store_thins_its_own_history_when_it_opens() {
        let dir = tempfile::tempdir().expect("tempdir");
        let doc = dir.path().join("essay.md");
        let store = SnapshotStore::for_document(&doc).expect("store");
        autosave(&store, "day one", LONG_AGO);
        autosave(&store, "day one, later", LONG_AGO + 60_000);
        // As though the last housekeeping pass were more than a day ago.
        store.conn.execute("DELETE FROM housekeeping", []).unwrap();
        drop(store);

        let reopened = SnapshotStore::for_document(&doc).expect("reopen");
        assert_eq!(reopened.revisions(10).unwrap().len(), 1);
    }

    #[test]
    fn opening_a_store_prunes_at_most_once_a_day() {
        let dir = tempfile::tempdir().expect("tempdir");
        let doc = dir.path().join("essay.md");
        let store = SnapshotStore::for_document(&doc).expect("store");
        autosave(&store, "day one", LONG_AGO);
        autosave(&store, "day one, later", LONG_AGO + 60_000);
        drop(store);

        // `for_document` runs on every save, not only when a document opens,
        // so the second one must cost a primary-key lookup and stop there.
        let reopened = SnapshotStore::for_document(&doc).expect("reopen");
        assert_eq!(reopened.revisions(10).unwrap().len(), 2);
        // …and asking outright still does the work.
        assert_eq!(reopened.prune().unwrap(), 2);
    }
}
