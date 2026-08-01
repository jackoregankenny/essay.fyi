//! Structural diff: what happened to the document's sections.
//!
//! Sections are matched by heading text rather than by position, which is what
//! turns "four hundred lines deleted here, four hundred inserted there" into
//! "this section moved". Matching is greedy and in order, so a document with
//! two sections called "Notes" pairs the first with the first.
//!
//! Identity by heading text is a deliberate simplification. A heading is the
//! one handle in plain Markdown that a human wrote on purpose, which makes it
//! the most trustworthy anchor available before real block identity lands
//! (Milestone 5). Its failure mode — renaming a heading reads as a removal
//! plus an addition — is visible rather than silent.

use crate::{word_stats, DiffStats};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SectionStatus {
    Unchanged,
    /// Body text changed; the section stayed where it was.
    Edited,
    /// Same body, different position in the document.
    Moved,
    /// Different body *and* a different position.
    MovedAndEdited,
    Added,
    Removed,
}

impl SectionStatus {
    pub fn moved(self) -> bool {
        matches!(self, Self::Moved | Self::MovedAndEdited)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionChange {
    /// Heading text; `None` for content before the first heading.
    pub heading: Option<String>,
    /// 1–6, or 0 for the preamble.
    pub depth: u8,
    pub status: SectionStatus,
    /// Position among sections, 0-based. `None` when the section is gone.
    pub old_index: Option<usize>,
    pub new_index: Option<usize>,
    pub stats: DiffStats,
}

struct Section<'a> {
    heading: Option<String>,
    depth: u8,
    body: &'a str,
}

/// Split a source into flat sections: any content before the first heading,
/// then each heading with everything up to the next heading of any depth.
///
/// Flat rather than nested because this feeds a review list, where a reader
/// wants one row per heading in document order.
fn split_sections(source: &str) -> Vec<Section<'_>> {
    let headings = essay_markdown::index(source).headings;
    let mut sections = Vec::new();

    let first = headings
        .first()
        .map(|heading| heading.range.start)
        .unwrap_or(source.len());
    if !source[..first].trim().is_empty() {
        sections.push(Section {
            heading: None,
            depth: 0,
            body: &source[..first],
        });
    }

    for (position, heading) in headings.iter().enumerate() {
        let end = headings
            .get(position + 1)
            .map(|next| next.range.start)
            .unwrap_or(source.len());
        sections.push(Section {
            heading: Some(heading.text.clone()),
            depth: heading.depth,
            body: &source[heading.range.start..end],
        });
    }
    sections
}

/// Per-section summary of what changed between two versions of a document.
pub fn section_changes(old: &str, new: &str) -> Vec<SectionChange> {
    let old_sections = split_sections(old);
    let new_sections = split_sections(new);

    // Greedy in-order pairing by (depth, heading). `matched_old` keeps a
    // repeated heading from pairing twice.
    let mut matched_old = vec![false; old_sections.len()];
    let mut pairing: Vec<Option<usize>> = Vec::with_capacity(new_sections.len());

    for new_section in &new_sections {
        let found = old_sections.iter().enumerate().position(|(index, old)| {
            !matched_old[index]
                && old.depth == new_section.depth
                && old.heading == new_section.heading
        });
        if let Some(index) = found {
            matched_old[index] = true;
        }
        pairing.push(found);
    }

    let mut changes = Vec::new();

    // Removals are reported where they used to be, so a reader scanning the
    // list in order sees the gap in context.
    for (old_index, old_section) in old_sections.iter().enumerate() {
        if !matched_old[old_index] {
            changes.push(SectionChange {
                heading: old_section.heading.clone(),
                depth: old_section.depth,
                status: SectionStatus::Removed,
                old_index: Some(old_index),
                new_index: None,
                stats: word_stats(old_section.body, ""),
            });
        }
    }

    for (new_index, new_section) in new_sections.iter().enumerate() {
        let change = match pairing[new_index] {
            None => SectionChange {
                heading: new_section.heading.clone(),
                depth: new_section.depth,
                status: SectionStatus::Added,
                old_index: None,
                new_index: Some(new_index),
                stats: word_stats("", new_section.body),
            },
            Some(old_index) => {
                let old_section = &old_sections[old_index];
                let edited = old_section.body != new_section.body;
                // Compare against the position this section *would* occupy if
                // nothing had moved, so additions earlier in the document do
                // not report every later section as moved.
                let moved = shifted(&pairing, new_index, old_index);
                let status = match (edited, moved) {
                    (false, false) => SectionStatus::Unchanged,
                    (true, false) => SectionStatus::Edited,
                    (false, true) => SectionStatus::Moved,
                    (true, true) => SectionStatus::MovedAndEdited,
                };
                SectionChange {
                    heading: new_section.heading.clone(),
                    depth: new_section.depth,
                    status,
                    old_index: Some(old_index),
                    new_index: Some(new_index),
                    stats: if edited {
                        word_stats(old_section.body, new_section.body)
                    } else {
                        DiffStats::default()
                    },
                }
            }
        };
        changes.push(change);
    }

    changes.sort_by_key(|change| change.new_index.unwrap_or(usize::MAX));
    changes
}

/// Did this section change its order relative to the other matched sections?
///
/// Reordering is what makes a move; insertions and deletions elsewhere shift
/// every index and must not count.
fn shifted(pairing: &[Option<usize>], new_index: usize, old_index: usize) -> bool {
    pairing
        .iter()
        .enumerate()
        .filter_map(|(index, matched)| matched.map(|old| (index, old)))
        .any(|(other_new, other_old)| {
            let before_now = other_new < new_index;
            let before_then = other_old < old_index;
            before_now != before_then
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = "# Title\n\n## One\n\nAlpha.\n\n## Two\n\nBeta.\n\n## Three\n\nGamma.\n";

    fn find<'a>(changes: &'a [SectionChange], heading: &str) -> &'a SectionChange {
        changes
            .iter()
            .find(|change| change.heading.as_deref() == Some(heading))
            .unwrap_or_else(|| panic!("no section {heading}"))
    }

    #[test]
    fn an_unchanged_document_has_no_changed_sections() {
        let changes = section_changes(DOC, DOC);
        assert_eq!(changes.len(), 4, "title plus three sections");
        assert!(changes
            .iter()
            .all(|change| change.status == SectionStatus::Unchanged));
    }

    #[test]
    fn only_the_edited_section_is_reported_as_edited() {
        let new = DOC.replace("Beta.", "Beta, tightened considerably.");
        let changes = section_changes(DOC, &new);

        assert_eq!(find(&changes, "Two").status, SectionStatus::Edited);
        assert_eq!(find(&changes, "One").status, SectionStatus::Unchanged);
        assert_eq!(find(&changes, "Three").status, SectionStatus::Unchanged);
    }

    #[test]
    fn a_reordered_section_reads_as_a_move_not_a_rewrite() {
        let new = "# Title\n\n## One\n\nAlpha.\n\n## Three\n\nGamma.\n\n## Two\n\nBeta.\n";
        let changes = section_changes(DOC, new);

        assert!(find(&changes, "Two").status.moved());
        assert!(find(&changes, "Three").status.moved());
        assert_eq!(find(&changes, "One").status, SectionStatus::Unchanged);
        // A move is not an edit: no words were written or deleted.
        assert_eq!(find(&changes, "Two").stats, DiffStats::default());
    }

    #[test]
    fn inserting_a_section_does_not_move_the_ones_after_it() {
        let new = DOC.replace("## Two", "## One And A Half\n\nInserted.\n\n## Two");
        let changes = section_changes(DOC, &new);

        assert_eq!(find(&changes, "One And A Half").status, SectionStatus::Added);
        assert_eq!(
            find(&changes, "Three").status,
            SectionStatus::Unchanged,
            "an insertion above must not report later sections as moved"
        );
    }

    #[test]
    fn a_deleted_section_is_reported_where_it_was() {
        let new = "# Title\n\n## One\n\nAlpha.\n\n## Three\n\nGamma.\n";
        let changes = section_changes(DOC, new);

        let removed = find(&changes, "Two");
        assert_eq!(removed.status, SectionStatus::Removed);
        assert_eq!(removed.new_index, None);
        assert!(removed.stats.words_removed > 0);
    }

    #[test]
    fn content_before_the_first_heading_is_its_own_section() {
        let old = "A preamble.\n\n# Title\n\nBody.\n";
        let new = "A different preamble.\n\n# Title\n\nBody.\n";
        let changes = section_changes(old, new);

        let preamble = changes
            .iter()
            .find(|change| change.heading.is_none())
            .expect("preamble section");
        assert_eq!(preamble.depth, 0);
        assert_eq!(preamble.status, SectionStatus::Edited);
    }

    #[test]
    fn repeated_headings_pair_in_order() {
        let old = "## Notes\n\nFirst.\n\n## Notes\n\nSecond.\n";
        let new = "## Notes\n\nFirst.\n\n## Notes\n\nSecond, revised.\n";
        let changes = section_changes(old, new);

        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].status, SectionStatus::Unchanged);
        assert_eq!(changes[1].status, SectionStatus::Edited);
    }
}
