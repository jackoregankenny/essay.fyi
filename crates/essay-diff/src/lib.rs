//! Diffs between document snapshots.
//!
//! Three related forms: text diff (exact words), structural diff (sections
//! moved, headings renamed — computed between document indexes), and
//! editorial summary (deterministic where possible, optionally AI-enriched,
//! always additive over the text diff). Moves should eventually be shown as
//! moves, not unrelated deletion and insertion.

use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
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
}
