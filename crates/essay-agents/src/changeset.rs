//! Proposed edits, held for review.
//!
//! A change set is what an agent's write *becomes* instead of a write. It
//! carries the proposal, the diff against the file as it stood, and the
//! provenance that answers "who asked for this, and why" — the record that
//! makes an accepted edit accountable a week later.
//!
//! Two decisions worth stating, because both are load-bearing:
//!
//! 1. **Every write becomes a proposal, whatever the path.** Not just the open
//!    manuscript. Essay has no review surface for a file it is not showing,
//!    and a write it cannot show is exactly the silent rewrite the invariant
//!    forbids. Uniformity is also what keeps the rule explainable to an author.
//! 2. **A proposal is recorded against `base_hash`, never against editor
//!    state.** Accepting re-checks that hash, so a proposal composed against a
//!    document that has since moved is refused rather than applied blind.

use essay_diff::DocumentDiff;
use essay_revisions::{now_millis, RevisionAuthor, RevisionOrigin, Timestamp};
use essay_workspace::{hash_source, SnapshotStore, WriteOutcome};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// Where a proposal came from. Recorded at the moment the agent asks for the
/// write, because none of it is recoverable afterwards.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    /// Display name of the agent, as advertised in `initialize`.
    pub agent: String,
    /// Essay's session id, not the agent's — it is what the frontend keys on.
    pub session_id: String,
    /// The agent's own id for the tool call that produced this write, when the
    /// session reported one. The thread back to the transcript.
    pub tool_call_id: Option<String>,
    /// The instruction that started the turn, trimmed for display.
    pub prompt_excerpt: String,
    pub timestamp_millis: Timestamp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeStatus {
    Pending,
    Accepted,
    Rejected,
}

/// One reviewable proposal against one file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSet {
    pub id: String,
    /// Absolute path, as the agent addressed it.
    pub file: String,
    /// The content hash the proposal was composed against. A file that did not
    /// exist yet hashes as empty, so a created file is an ordinary change set
    /// whose diff is all insertions.
    pub base_hash: String,
    pub proposed_contents: String,
    pub diff: DocumentDiff,
    /// `DocumentDiff::looks_like_a_rewrite` decided here rather than in the
    /// WebView: the threshold is editorial policy and belongs on this side.
    pub looks_like_a_rewrite: bool,
    pub provenance: Provenance,
    pub status: ChangeStatus,
}

/// The result of accepting a proposal. Shaped like
/// [`essay_workspace::WriteOutcome`] because the frontend already knows how to
/// read that: a conflict is an outcome, not an error.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AcceptOutcome {
    Written {
        id: String,
        hash: String,
    },
    /// The file moved under the proposal. The change set stays `Pending` —
    /// the author may still want it once they have seen what arrived.
    Conflict {
        id: String,
        disk_hash: String,
        disk_contents: String,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum ChangeSetError {
    #[error("no change set {0}")]
    Unknown(String),
    #[error("change set {id} is already {status:?}")]
    Settled { id: String, status: ChangeStatus },
    #[error(transparent)]
    Workspace(#[from] essay_workspace::WorkspaceError),
}

/// The review queue.
///
/// In memory by design: a pending proposal is a conversation in progress, not
/// document history. What survives a restart is the document and its snapshots
/// — `.essay/` stays deletable, and a proposal nobody accepted leaves nothing
/// behind.
#[derive(Default)]
pub struct ChangeSetStore {
    /// Insertion order is review order, so a Vec rather than a map.
    entries: Mutex<Vec<ChangeSet>>,
    next_id: AtomicU64,
}

impl ChangeSetStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Turn a proposed content into a pending change set.
    ///
    /// Returns `None` when the proposal is byte-identical to what the file
    /// already holds. An agent that rewrote a file back to itself has proposed
    /// nothing, and putting an empty diff in the author's queue would train
    /// them to dismiss the queue.
    pub fn propose(
        &self,
        file: &Path,
        current_contents: &str,
        proposed_contents: String,
        provenance: Provenance,
    ) -> Option<ChangeSet> {
        if current_contents == proposed_contents {
            return None;
        }

        let diff = essay_diff::diff_documents(current_contents, &proposed_contents);
        let change = ChangeSet {
            id: format!("change-{}", self.next_id.fetch_add(1, Ordering::Relaxed) + 1),
            file: file.display().to_string(),
            base_hash: hash_source(current_contents),
            proposed_contents,
            looks_like_a_rewrite: diff.looks_like_a_rewrite(),
            diff,
            provenance,
            status: ChangeStatus::Pending,
        };
        self.entries.lock().unwrap().push(change.clone());
        Some(change)
    }

    /// Every change set, oldest first.
    pub fn list(&self) -> Vec<ChangeSet> {
        self.entries.lock().unwrap().clone()
    }

    pub fn get(&self, id: &str) -> Option<ChangeSet> {
        self.entries
            .lock()
            .unwrap()
            .iter()
            .find(|change| change.id == id)
            .cloned()
    }

    /// What the agent believes `file` now contains.
    ///
    /// Having told the agent its write succeeded, Essay must keep that story
    /// straight: a subsequent `fs/read_text_file` that returned the untouched
    /// file would read to the agent as its edit being reverted, and agents
    /// respond to that by writing again — the retry loop this whole design
    /// exists to avoid. The newest pending proposal is the agent's view; disk
    /// remains the author's.
    pub fn pending_contents(&self, file: &Path) -> Option<String> {
        self.entries
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|change| {
                change.status == ChangeStatus::Pending && same_file(Path::new(&change.file), file)
            })
            .map(|change| change.proposed_contents.clone())
    }

    /// Apply a proposal to disk under its recorded guard.
    ///
    /// `before_write` is handed the hash about to land — the caller uses it to
    /// tell the document watcher what is coming, so Essay does not report its
    /// own write back to the author as somebody else's edit. It runs before the
    /// write for the same reason the editor's save path does: the watcher can
    /// see the file the instant the rename completes.
    pub fn accept(
        &self,
        id: &str,
        agent_name: &str,
        before_write: impl FnOnce(&str),
    ) -> Result<AcceptOutcome, ChangeSetError> {
        let change = self.pending(id)?;
        let path = PathBuf::from(&change.file);

        before_write(&hash_source(&change.proposed_contents));

        let outcome = essay_workspace::write_document(
            &path,
            &change.proposed_contents,
            Some(&change.base_hash),
        )?;

        match outcome {
            WriteOutcome::Written { hash } => {
                self.settle(id, ChangeStatus::Accepted);
                snapshot_agent_patch(&path, &change, agent_name);
                Ok(AcceptOutcome::Written {
                    id: id.to_string(),
                    hash,
                })
            }
            WriteOutcome::Conflict {
                disk_hash,
                disk_contents,
            } => Ok(AcceptOutcome::Conflict {
                id: id.to_string(),
                disk_hash,
                disk_contents,
            }),
        }
    }

    pub fn reject(&self, id: &str) -> Result<ChangeSet, ChangeSetError> {
        self.pending(id)?;
        self.settle(id, ChangeStatus::Rejected);
        self.get(id).ok_or_else(|| unknown(id))
    }

    fn pending(&self, id: &str) -> Result<ChangeSet, ChangeSetError> {
        let change = self.get(id).ok_or_else(|| unknown(id))?;
        if change.status != ChangeStatus::Pending {
            return Err(ChangeSetError::Settled {
                id: id.to_string(),
                status: change.status,
            });
        }
        Ok(change)
    }

    fn settle(&self, id: &str, status: ChangeStatus) {
        if let Some(change) = self
            .entries
            .lock()
            .unwrap()
            .iter_mut()
            .find(|change| change.id == id)
        {
            change.status = status;
        }
    }
}

fn unknown(id: &str) -> ChangeSetError {
    ChangeSetError::Unknown(id.to_string())
}

/// Record the accepted content in the document's timeline, attributed.
///
/// The sidecar is a convenience, never a precondition — a document on a
/// read-only volume still takes agent edits, it just has no history of them.
fn snapshot_agent_patch(path: &Path, change: &ChangeSet, agent_name: &str) {
    let store = match SnapshotStore::for_document(path) {
        Ok(store) => store,
        Err(err) => {
            log::warn!("no sidecar for {}: {err}", path.display());
            return;
        }
    };
    let instruction = Some(change.provenance.prompt_excerpt.clone())
        .filter(|excerpt| !excerpt.trim().is_empty());
    if let Err(err) = store.snapshot(
        &change.proposed_contents,
        RevisionOrigin::AgentPatch,
        RevisionAuthor::Agent {
            name: agent_name.to_string(),
        },
        instruction,
    ) {
        log::warn!("cannot record agent revision: {err}");
    }
}

/// Whether two paths name the same file.
///
/// Agents send absolute paths they built themselves; on Windows those differ
/// from ours in case and separator often enough that a string compare is not
/// good enough. Canonicalising resolves both, and falls back to the literal
/// compare when a path does not exist yet (a created file).
pub(crate) fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// The instruction that produced a change, trimmed to something a review card
/// can carry without becoming the review card.
pub fn excerpt(prompt: &str) -> String {
    const LIMIT: usize = 240;
    let trimmed = prompt.trim();
    if trimmed.chars().count() <= LIMIT {
        return trimmed.to_string();
    }
    let head: String = trimmed.chars().take(LIMIT).collect();
    format!("{}…", head.trim_end())
}

pub fn provenance(
    agent: &str,
    session_id: &str,
    tool_call_id: Option<String>,
    prompt: &str,
) -> Provenance {
    Provenance {
        agent: agent.to_string(),
        session_id: session_id.to_string(),
        tool_call_id,
        prompt_excerpt: excerpt(prompt),
        timestamp_millis: now_millis(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_doc(contents: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("essay.md");
        fs::write(&path, contents).expect("seed");
        (dir, path)
    }

    fn prov() -> Provenance {
        provenance("opencode", "session-1", Some("call_1".into()), "tighten section two")
    }

    #[test]
    fn a_write_becomes_a_pending_change_set_not_a_write() {
        let (_dir, path) = temp_doc("# One\n\nAlpha.\n");
        let store = ChangeSetStore::new();

        let change = store
            .propose(&path, "# One\n\nAlpha.\n", "# One\n\nAlpha, tightened.\n".into(), prov())
            .expect("a proposal");

        assert_eq!(change.status, ChangeStatus::Pending);
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "# One\n\nAlpha.\n",
            "proposing must not touch the file"
        );
        assert!(!change.diff.is_empty(), "the proposal carries its diff");
    }

    #[test]
    fn a_proposal_records_who_asked_for_it() {
        let (_dir, path) = temp_doc("# One\n");
        let store = ChangeSetStore::new();
        let change = store
            .propose(&path, "# One\n", "# Two\n".into(), prov())
            .expect("a proposal");

        assert_eq!(change.provenance.agent, "opencode");
        assert_eq!(change.provenance.session_id, "session-1");
        assert_eq!(change.provenance.tool_call_id.as_deref(), Some("call_1"));
        assert_eq!(change.provenance.prompt_excerpt, "tighten section two");
        assert!(change.provenance.timestamp_millis > 0);
    }

    #[test]
    fn a_write_that_changes_nothing_is_not_a_proposal() {
        let (_dir, path) = temp_doc("# One\n");
        let store = ChangeSetStore::new();

        assert!(store
            .propose(&path, "# One\n", "# One\n".into(), prov())
            .is_none());
        assert!(store.list().is_empty());
    }

    #[test]
    fn accepting_writes_the_proposal_to_disk() {
        let (_dir, path) = temp_doc("# One\n");
        let store = ChangeSetStore::new();
        let change = store
            .propose(&path, "# One\n", "# Two\n".into(), prov())
            .expect("a proposal");

        let outcome = store.accept(&change.id, "opencode", |_| {}).expect("accept");

        assert!(matches!(outcome, AcceptOutcome::Written { .. }));
        assert_eq!(fs::read_to_string(&path).unwrap(), "# Two\n");
        assert_eq!(store.get(&change.id).unwrap().status, ChangeStatus::Accepted);
    }

    #[test]
    fn accepting_announces_the_write_before_making_it() {
        let (_dir, path) = temp_doc("# One\n");
        let store = ChangeSetStore::new();
        let change = store
            .propose(&path, "# One\n", "# Two\n".into(), prov())
            .expect("a proposal");

        let mut announced = None;
        store
            .accept(&change.id, "opencode", |hash| announced = Some(hash.to_string()))
            .expect("accept");

        assert_eq!(
            announced.as_deref(),
            Some(hash_source("# Two\n").as_str()),
            "the watcher must be told our own write is coming"
        );
    }

    #[test]
    fn accepting_refuses_to_clobber_an_edit_that_arrived_underneath() {
        let (_dir, path) = temp_doc("# One\n");
        let store = ChangeSetStore::new();
        let change = store
            .propose(&path, "# One\n", "# Agent version\n".into(), prov())
            .expect("a proposal");

        fs::write(&path, "# The author kept typing\n").expect("human edit");
        let outcome = store.accept(&change.id, "opencode", |_| {}).expect("accept");

        match outcome {
            AcceptOutcome::Conflict { disk_contents, .. } => {
                assert_eq!(disk_contents, "# The author kept typing\n");
            }
            AcceptOutcome::Written { .. } => panic!("clobbered the author's edit"),
        }
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "# The author kept typing\n"
        );
        assert_eq!(
            store.get(&change.id).unwrap().status,
            ChangeStatus::Pending,
            "a conflicted proposal is still reviewable"
        );
    }

    #[test]
    fn an_accepted_change_is_recorded_in_the_documents_timeline() {
        let (_dir, path) = temp_doc("# One\n");
        let store = ChangeSetStore::new();
        let change = store
            .propose(&path, "# One\n", "# Two\n".into(), prov())
            .expect("a proposal");
        store.accept(&change.id, "opencode", |_| {}).expect("accept");

        let history = SnapshotStore::for_document(&path).expect("store");
        let latest = history.latest().expect("read").expect("a revision");
        assert_eq!(latest.origin, RevisionOrigin::AgentPatch);
        assert_eq!(
            latest.author,
            RevisionAuthor::Agent {
                name: "opencode".into()
            }
        );
        assert_eq!(latest.instruction.as_deref(), Some("tighten section two"));
    }

    #[test]
    fn rejecting_leaves_the_file_alone() {
        let (_dir, path) = temp_doc("# One\n");
        let store = ChangeSetStore::new();
        let change = store
            .propose(&path, "# One\n", "# Two\n".into(), prov())
            .expect("a proposal");

        store.reject(&change.id).expect("reject");

        assert_eq!(fs::read_to_string(&path).unwrap(), "# One\n");
        assert_eq!(store.get(&change.id).unwrap().status, ChangeStatus::Rejected);
    }

    #[test]
    fn a_settled_change_cannot_be_settled_twice() {
        let (_dir, path) = temp_doc("# One\n");
        let store = ChangeSetStore::new();
        let change = store
            .propose(&path, "# One\n", "# Two\n".into(), prov())
            .expect("a proposal");
        store.reject(&change.id).expect("reject");

        assert!(matches!(
            store.accept(&change.id, "opencode", |_| {}),
            Err(ChangeSetError::Settled { .. })
        ));
    }

    #[test]
    fn the_agent_reads_back_what_it_believes_it_wrote() {
        let (_dir, path) = temp_doc("# One\n");
        let store = ChangeSetStore::new();
        store
            .propose(&path, "# One\n", "# Two\n".into(), prov())
            .expect("a proposal");

        assert_eq!(store.pending_contents(&path).as_deref(), Some("# Two\n"));
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "# One\n",
            "the author's file is untouched"
        );
    }

    #[test]
    fn a_rejected_proposal_stops_shadowing_the_file() {
        let (_dir, path) = temp_doc("# One\n");
        let store = ChangeSetStore::new();
        let change = store
            .propose(&path, "# One\n", "# Two\n".into(), prov())
            .expect("a proposal");
        store.reject(&change.id).expect("reject");

        assert_eq!(store.pending_contents(&path), None);
    }

    #[test]
    fn a_created_file_is_an_ordinary_change_set() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("new.md");
        let store = ChangeSetStore::new();

        let change = store
            .propose(&path, "", "# Fresh\n".into(), prov())
            .expect("a proposal");
        assert_eq!(change.base_hash, hash_source(""));

        let outcome = store.accept(&change.id, "opencode", |_| {}).expect("accept");
        assert!(matches!(outcome, AcceptOutcome::Written { .. }));
        assert_eq!(fs::read_to_string(&path).unwrap(), "# Fresh\n");
    }

    #[test]
    fn a_wholesale_rewrite_is_labelled_on_the_change_set() {
        let (_dir, path) = temp_doc("");
        let store = ChangeSetStore::new();
        let old = "# Doc\n\n## One\n\nAlpha.\n\n## Two\n\nBeta.\n\n## Three\n\nGamma.\n";
        let new = "# Doc\n\n## One\n\nAlpha, reworded.\n\n## Two\n\nBeta, reworded.\n\n## Three\n\nGamma, reworded.\n";

        let change = store
            .propose(&path, old, new.into(), prov())
            .expect("a proposal");
        assert!(change.looks_like_a_rewrite);
    }

    /// The WebView reads these keys by hand; nothing else type-checks the
    /// boundary, so pin the shape here.
    #[test]
    fn a_change_set_crosses_to_the_webview_in_camel_case() {
        let (_dir, path) = temp_doc("# One\n");
        let store = ChangeSetStore::new();
        let change = store
            .propose(&path, "# One\n", "# Two\n".into(), prov())
            .expect("a proposal");

        let json = serde_json::to_value(&change).unwrap();
        for key in [
            "id",
            "file",
            "baseHash",
            "proposedContents",
            "diff",
            "looksLikeARewrite",
            "provenance",
            "status",
        ] {
            assert!(json.get(key).is_some(), "missing {key} in {json}");
        }
        assert_eq!(json["status"], "pending");
        assert_eq!(json["provenance"]["sessionId"], "session-1");
        assert_eq!(json["provenance"]["toolCallId"], "call_1");
        assert_eq!(json["provenance"]["promptExcerpt"], "tighten section two");
        assert!(json["provenance"]["timestampMillis"].is_i64());
    }

    #[test]
    fn the_accept_outcome_matches_the_shape_the_save_path_already_uses() {
        let conflict = AcceptOutcome::Conflict {
            id: "change-1".into(),
            disk_hash: "abc".into(),
            disk_contents: "# On disk\n".into(),
        };
        assert_eq!(
            serde_json::to_value(&conflict).unwrap(),
            serde_json::json!({
                "status": "conflict",
                "id": "change-1",
                "diskHash": "abc",
                "diskContents": "# On disk\n",
            })
        );
    }

    #[test]
    fn a_long_instruction_is_trimmed_for_the_review_card() {
        let prompt = "word ".repeat(200);
        let excerpt = excerpt(&prompt);
        assert!(excerpt.chars().count() <= 241, "{}", excerpt.chars().count());
        assert!(excerpt.ends_with('…'));
    }
}
