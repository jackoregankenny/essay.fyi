//! The diff engine against the fixture corpus.
//!
//! These are the cases the review surface exists to make obvious, checked
//! against real prose rather than constructed strings.

use essay_diff::{diff_documents, section_changes, SectionStatus};
use std::path::PathBuf;

fn fixture(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/diffs")
        .join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("cannot read {}: {err}", path.display()))
}

/// The headline claim: a scoped edit and a wholesale rewrite can express the
/// *same* editorial improvement and must not look alike in review.
#[test]
fn a_scoped_edit_and_a_rewrite_are_told_apart() {
    let before = fixture("agent-edit.before.md");
    let scoped = diff_documents(&before, &fixture("agent-edit.scoped.md"));
    let rewritten = diff_documents(&before, &fixture("agent-edit.rewritten.md"));

    assert!(
        !scoped.looks_like_a_rewrite(),
        "the scoped edit was flagged as a rewrite (churn {})",
        scoped.churn
    );
    assert!(
        rewritten.looks_like_a_rewrite(),
        "the rewrite was not flagged (churn {})",
        rewritten.churn
    );
    assert!(
        rewritten.churn > scoped.churn * 2.0,
        "scoped {} vs rewritten {}",
        scoped.churn,
        rewritten.churn
    );
}

#[test]
fn the_scoped_edit_touches_exactly_one_section() {
    let changes = section_changes(
        &fixture("agent-edit.before.md"),
        &fixture("agent-edit.scoped.md"),
    );

    let touched: Vec<_> = changes
        .iter()
        .filter(|change| change.status != SectionStatus::Unchanged)
        .collect();

    assert_eq!(touched.len(), 1, "touched: {touched:#?}");
    assert_eq!(touched[0].heading.as_deref(), Some("The practice"));
    assert_eq!(touched[0].status, SectionStatus::Edited);
}

#[test]
fn the_rewrite_leaves_almost_nothing_untouched() {
    let changes = section_changes(
        &fixture("agent-edit.before.md"),
        &fixture("agent-edit.rewritten.md"),
    );

    let unchanged = changes
        .iter()
        .filter(|change| change.status == SectionStatus::Unchanged)
        .count();

    // Two of its three headings were reworded too, so they read as
    // added/removed rather than edited — which is itself the point: renaming
    // every heading is not a light-touch edit.
    assert!(
        unchanged <= 1,
        "a regenerated document should leave at most the title alone, {unchanged} were untouched"
    );
}

/// A line diff calls this four hundred deleted lines and four hundred
/// inserted ones. The structural layer has to call it a move.
#[test]
fn a_moved_section_is_reported_as_a_move() {
    let changes = section_changes(
        &fixture("section-move.before.md"),
        &fixture("section-move.after.md"),
    );

    let risks = changes
        .iter()
        .find(|change| change.heading.as_deref() == Some("Risks"))
        .expect("Risks section");

    assert!(
        risks.status.moved(),
        "Risks moved two positions but reported {:?}",
        risks.status
    );
    assert_eq!(
        risks.stats,
        Default::default(),
        "a move must not be reported as words written or deleted"
    );

    assert!(
        changes
            .iter()
            .filter(|change| change.status != SectionStatus::Unchanged)
            .all(|change| change.status.moved()),
        "nothing but the move should be reported: {changes:#?}"
    );
}

/// Front matter, tables, footnotes and fences all pass through the section
/// splitter; a document diffed against itself must be silent.
#[test]
fn the_manuscript_corpus_diffs_clean_against_itself() {
    for name in [
        "the-shape-of-an-argument.md",
        "executive-memo.md",
        "technical-rfc.md",
        "awkward-syntax.md",
    ] {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/manuscripts")
            .join(name);
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|err| panic!("cannot read {}: {err}", path.display()));

        let diff = diff_documents(&source, &source);
        assert!(diff.is_empty(), "{name} diffed against itself");
        assert_eq!(diff.churn, 0.0, "{name}");
        assert!(
            diff.sections.iter().all(|s| s.status == SectionStatus::Unchanged),
            "{name}"
        );
    }
}
