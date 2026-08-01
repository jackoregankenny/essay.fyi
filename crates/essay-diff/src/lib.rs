//! Diffs between document snapshots.
//!
//! Three related forms: text diff (exact words), structural diff (sections
//! moved, headings renamed — computed between document indexes), and
//! editorial summary (deterministic where possible, optionally AI-enriched,
//! always additive over the text diff).
//!
//! The structural layer is the one that matters for review. A line diff of a
//! restructured manuscript is a wall of deletions beside a wall of insertions;
//! what a reader needs is "three of eighteen sections changed, and one moved".
//! It is also the only honest way to answer the question that decides whether
//! an agent is usable on prose at all: **did it edit the document, or did it
//! regenerate it?**

mod section;

pub use section::{section_changes, SectionChange, SectionStatus};

use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffStats {
    pub words_inserted: usize,
    pub words_removed: usize,
}

/// Word-level diff statistics between two snapshots, for the
/// "+214 / -96 words" revision timeline summaries.
pub fn word_stats(old: &str, new: &str) -> DiffStats {
    let diff = TextDiff::from_words(old, new);
    let mut stats = DiffStats::default();
    for change in diff.iter_all_changes() {
        let is_word = !change.value().trim().is_empty();
        match change.tag() {
            ChangeTag::Insert if is_word => stats.words_inserted += 1,
            ChangeTag::Delete if is_word => stats.words_removed += 1,
            _ => {}
        }
    }
    stats
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineTag {
    Context,
    Insert,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub tag: LineTag,
    /// 1-based line number in the old document, when the line exists there.
    pub old_line: Option<usize>,
    /// 1-based line number in the new document, when the line exists there.
    pub new_line: Option<usize>,
    pub text: String,
}

/// A run of changed lines with surrounding context — one block in the review
/// surface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDiff {
    pub hunks: Vec<Hunk>,
    pub sections: Vec<SectionChange>,
    pub stats: DiffStats,
    pub lines_inserted: usize,
    pub lines_removed: usize,
    /// Sections the change touches, over sections in the document.
    ///
    /// The signal that separates an edit from a rewrite. A targeted edit moves
    /// one or two sections and leaves the rest byte-identical; a regenerated
    /// document reports nearly every section as changed even when the meaning
    /// is unaltered.
    pub churn: f32,
}

impl DocumentDiff {
    pub fn is_empty(&self) -> bool {
        self.hunks.is_empty()
    }

    /// Whether this reads as a wholesale regeneration rather than an edit.
    ///
    /// A heuristic, and deliberately generous: it exists to label a change in
    /// the review surface, never to reject one.
    pub fn looks_like_a_rewrite(&self) -> bool {
        self.churn >= REWRITE_CHURN && self.sections.len() >= 3
    }
}

/// Two thirds of a document changing at once is the point where "edited" stops
/// being a fair description of what happened.
pub const REWRITE_CHURN: f32 = 0.66;

/// Lines of unchanged context kept either side of a change.
const CONTEXT: usize = 3;

pub fn diff_documents(old: &str, new: &str) -> DocumentDiff {
    let text = TextDiff::from_lines(old, new);
    let mut hunks = Vec::new();
    let mut lines_inserted = 0;
    let mut lines_removed = 0;

    for group in text.grouped_ops(CONTEXT) {
        let (Some(first), Some(last)) = (group.first(), group.last()) else {
            continue;
        };
        let mut lines = Vec::new();
        for op in &group {
            for change in text.iter_changes(op) {
                let tag = match change.tag() {
                    ChangeTag::Equal => LineTag::Context,
                    ChangeTag::Insert => {
                        lines_inserted += 1;
                        LineTag::Insert
                    }
                    ChangeTag::Delete => {
                        lines_removed += 1;
                        LineTag::Delete
                    }
                };
                lines.push(DiffLine {
                    tag,
                    old_line: change.old_index().map(|i| i + 1),
                    new_line: change.new_index().map(|i| i + 1),
                    text: change.value().trim_end_matches('\n').to_string(),
                });
            }
        }
        hunks.push(Hunk {
            old_start: first.old_range().start + 1,
            old_lines: last.old_range().end - first.old_range().start,
            new_start: first.new_range().start + 1,
            new_lines: last.new_range().end - first.new_range().start,
            lines,
        });
    }

    let sections = section_changes(old, new);
    let touched = sections
        .iter()
        .filter(|section| section.status != SectionStatus::Unchanged)
        .count();
    let churn = if sections.is_empty() {
        if hunks.is_empty() {
            0.0
        } else {
            1.0
        }
    } else {
        touched as f32 / sections.len() as f32
    };

    DocumentDiff {
        hunks,
        sections,
        stats: word_stats(old, new),
        lines_inserted,
        lines_removed,
        churn,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_inserted_and_removed_words() {
        let old = "The quick brown fox";
        let new = "The slow brown fox jumps";
        let stats = word_stats(old, new);
        assert_eq!(stats.words_inserted, 2); // "slow", "jumps"
        assert_eq!(stats.words_removed, 1); // "quick"
    }

    #[test]
    fn identical_snapshots_have_empty_stats() {
        assert_eq!(word_stats("same text", "same text"), DiffStats::default());
    }

    #[test]
    fn identical_documents_produce_no_hunks() {
        let source = "# Title\n\nA paragraph.\n";
        let diff = diff_documents(source, source);
        assert!(diff.is_empty());
        assert_eq!(diff.churn, 0.0);
        assert!(!diff.looks_like_a_rewrite());
    }

    #[test]
    fn hunks_carry_line_numbers_from_both_sides() {
        let old = "one\ntwo\nthree\n";
        let new = "one\ntwo changed\nthree\n";
        let diff = diff_documents(old, new);

        assert_eq!(diff.hunks.len(), 1);
        assert_eq!(diff.lines_inserted, 1);
        assert_eq!(diff.lines_removed, 1);

        let deleted = diff.hunks[0]
            .lines
            .iter()
            .find(|line| line.tag == LineTag::Delete)
            .expect("a deleted line");
        assert_eq!(deleted.text, "two");
        assert_eq!(deleted.old_line, Some(2));
        assert_eq!(deleted.new_line, None);
    }

    #[test]
    fn distant_changes_become_separate_hunks() {
        let mut old = String::from("# Title\n\n");
        for n in 0..40 {
            old.push_str(&format!("line {n}\n"));
        }
        let new = old
            .replace("line 1\n", "line one\n")
            .replace("line 38\n", "line thirty-eight\n");

        let diff = diff_documents(&old, &new);
        assert_eq!(diff.hunks.len(), 2, "changes 30 lines apart are two hunks");
    }

    #[test]
    fn a_targeted_edit_has_low_churn() {
        let old = "# Doc\n\n## One\n\nAlpha.\n\n## Two\n\nBeta.\n\n## Three\n\nGamma.\n";
        let new = "# Doc\n\n## One\n\nAlpha.\n\n## Two\n\nBeta, tightened.\n\n## Three\n\nGamma.\n";

        let diff = diff_documents(old, new);
        assert!(diff.churn < 0.5, "churn was {}", diff.churn);
        assert!(!diff.looks_like_a_rewrite());
    }

    #[test]
    fn a_wholesale_rewrite_is_recognised_as_one() {
        let old = "# Doc\n\n## One\n\nAlpha.\n\n## Two\n\nBeta.\n\n## Three\n\nGamma.\n";
        let new =
            "# Doc\n\n## One\n\nAlpha, reworded.\n\n## Two\n\nBeta, reworded.\n\n## Three\n\nGamma, reworded.\n";

        let diff = diff_documents(old, new);
        assert!(diff.looks_like_a_rewrite(), "churn was {}", diff.churn);
    }
}
