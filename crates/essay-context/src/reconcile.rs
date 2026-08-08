//! Anchor reconciliation: where does a recorded selection belong in the
//! document as it stands *now*?
//!
//! The one rule that outranks every heuristic here: **never attach on
//! ambiguity**. A comment shown as unplaced is an inconvenience the author
//! can fix in a click; a comment silently attached to the wrong occurrence of
//! a repeated phrase is corrupted editorial thought. Zero matches and two
//! matches get the same answer.
//!
//! Inputs are caller-supplied on purpose. The flattened text comes from the
//! live editor buffer (`manuscriptText()`), which is ahead of disk between
//! autosaves; the section spans come from the same buffer for the same
//! reason. This function owns the decision, not the coordinates.

use crate::{Anchor, SectionRef};
use serde::{Deserialize, Serialize};

/// A section as it exists in the current text: the reference that names it,
/// plus the UTF-16 range it occupies in the flattened text (heading included,
/// running to the next heading of any depth or the end of the document).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionSpan {
    pub text: String,
    pub depth: u8,
    pub ordinal: u32,
    /// UTF-16 offset where the section begins in the flattened text.
    pub from: usize,
    /// UTF-16 offset where it ends (exclusive).
    pub to: usize,
}

/// Where an anchor lands, or the honest admission that it does not.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Placement {
    /// The document is byte-for-byte what it was when the positions were
    /// recorded — trust them outright.
    Exact { pm_from: i64, pm_to: i64 },
    /// The quote was found exactly once with matching context. Offsets are
    /// UTF-16 into the flattened text the caller supplied; the frontend maps
    /// them to ProseMirror positions with `positionAtOffset`.
    Relocated {
        offset_from: usize,
        offset_to: usize,
        confidence: f64,
    },
    /// Not found, found more than once, or the document was rewritten out
    /// from under it. Visible detachment; manual reattachment is the fix.
    Unplaced,
}

/// The quote was unique inside the section corridor the anchor recorded.
const CORRIDOR_CONFIDENCE: f64 = 0.9;

/// The corridor's sections are gone (renamed, most likely) and the quote was
/// unique in the whole document instead. Weaker: nothing ties it to the
/// argument it was made about.
const FALLBACK_CONFIDENCE: f64 = 0.6;

/// How much recorded context has to agree, in UTF-16 units. About half a
/// short sentence either side — enough to tell two occurrences of a phrase
/// apart, short enough that an unrelated edit a paragraph away does not
/// detach every comment in the section.
const CONTEXT_WINDOW: usize = 32;

/// Place `anchor` in the current document.
///
/// `text` is the flattened manuscript (UTF-16 offset semantics throughout),
/// `current_hash` the content hash of the *source* that text was flattened
/// from, `sections` the current section spans over that same text.
pub fn place_anchor(
    anchor: &Anchor,
    text: &str,
    current_hash: &str,
    sections: &[SectionSpan],
) -> Placement {
    // A detached anchor is history, not a claim about the current document.
    if anchor.detached_at.is_some() {
        return Placement::Unplaced;
    }

    if anchor.created_hash == current_hash {
        return Placement::Exact {
            pm_from: anchor.pm_from,
            pm_to: anchor.pm_to,
        };
    }

    let hay: Vec<u16> = text.encode_utf16().collect();
    let needle: Vec<u16> = anchor.selected_text.encode_utf16().collect();
    if needle.is_empty() {
        return Placement::Unplaced;
    }
    let before: Vec<u16> = anchor.context_before.encode_utf16().collect();
    let after: Vec<u16> = anchor.context_after.encode_utf16().collect();

    // Which stretch of the document is this anchor's to search? The corridor
    // runs from the start of the section the selection began in to the end of
    // the one it finished in. An anchor with no section refs was made in a
    // document without headings around it; its corridor was always the whole
    // text, and that is scope, not fallback.
    let (corridor, confidence) = match corridor_of(anchor, sections, hay.len()) {
        Corridor::Found(range) => (range, CORRIDOR_CONFIDENCE),
        Corridor::WholeDocument => (0..hay.len(), CORRIDOR_CONFIDENCE),
        // The recorded sections no longer exist — renamed, most likely. Only
        // now may the whole document be tried, and only at lower confidence.
        Corridor::Missing => (0..hay.len(), FALLBACK_CONFIDENCE),
    };

    let matches = context_matched_occurrences(&hay, &needle, &before, &after, &corridor);
    match matches.as_slice() {
        [start] => Placement::Relocated {
            offset_from: *start,
            offset_to: start + needle.len(),
            confidence,
        },
        // Zero or several: the same answer, deliberately. See module docs.
        _ => Placement::Unplaced,
    }
}

enum Corridor {
    Found(std::ops::Range<usize>),
    WholeDocument,
    Missing,
}

fn corridor_of(anchor: &Anchor, sections: &[SectionSpan], len: usize) -> Corridor {
    // Anchors are written with both refs or neither; a lone one (which the
    // store never produces) is read as a one-section corridor rather than
    // rejected, because it still names a real scope.
    let start_ref = anchor.start_section.as_ref().or(anchor.end_section.as_ref());
    let end_ref = anchor.end_section.as_ref().or(anchor.start_section.as_ref());
    let (Some(start_ref), Some(end_ref)) = (start_ref, end_ref) else {
        return Corridor::WholeDocument;
    };
    let (Some(start), Some(end)) = (find_section(sections, start_ref), find_section(sections, end_ref))
    else {
        return Corridor::Missing;
    };
    let from = start.from.min(len);
    let to = end.to.min(len);
    if from >= to {
        // Sections found but in an order the anchor never saw (the end now
        // precedes the start). Not a corridor anyone recorded — treat it as
        // missing rather than searching a range that means nothing.
        return Corridor::Missing;
    }
    Corridor::Found(from..to)
}

fn find_section<'a>(sections: &'a [SectionSpan], wanted: &SectionRef) -> Option<&'a SectionSpan> {
    sections.iter().find(|section| {
        section.text == wanted.text
            && section.depth == wanted.depth
            && section.ordinal == wanted.ordinal
    })
}

/// Every start offset in `range` where the quote appears **and** the recorded
/// context agrees. Overlapping occurrences count separately — two answers to
/// "where is this?" is ambiguity however they overlap.
fn context_matched_occurrences(
    hay: &[u16],
    needle: &[u16],
    before: &[u16],
    after: &[u16],
    range: &std::ops::Range<usize>,
) -> Vec<usize> {
    let mut found = Vec::new();
    if range.end > hay.len() || needle.len() > range.end - range.start {
        return found;
    }
    for start in range.start..=(range.end - needle.len()) {
        if &hay[start..start + needle.len()] == needle
            && context_matches(hay, start, start + needle.len(), before, after)
        {
            found.push(start);
        }
    }
    found
}

/// Does the text around an occurrence agree with what the anchor recorded?
///
/// Trimmed on purpose: only the `CONTEXT_WINDOW` units nearest the quote are
/// compared, and a document boundary excuses the units it removes — a quote
/// that has become the first thing in the file still matches on whatever
/// context remains. Empty recorded context matches trivially; the quote's own
/// uniqueness is then the only evidence, which the single-match rule already
/// requires.
fn context_matches(hay: &[u16], from: usize, to: usize, before: &[u16], after: &[u16]) -> bool {
    let want_before = &before[before.len().saturating_sub(CONTEXT_WINDOW)..];
    let avail = want_before.len().min(from);
    if hay[from - avail..from] != want_before[want_before.len() - avail..] {
        return false;
    }
    let want_after = &after[..after.len().min(CONTEXT_WINDOW)];
    let avail = want_after.len().min(hay.len() - to);
    hay[to..to + avail] == want_after[..avail]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Anchor;

    /// UTF-16 offset of `needle`'s `nth` (zero-based) occurrence in `text`.
    fn offset_of(text: &str, needle: &str, nth: usize) -> usize {
        let mut from = 0;
        for _ in 0..nth {
            let at = text[from..].find(needle).expect("occurrence") + from;
            from = at + needle.len();
        }
        let at = text[from..].find(needle).expect("occurrence") + from;
        text[..at].encode_utf16().count()
    }

    /// Section spans built the way tests need them: `#` heading lines over the
    /// raw text, spans in UTF-16, ordinals counted per (text, depth).
    fn sections_of(text: &str) -> Vec<SectionSpan> {
        let mut headings: Vec<(String, u8, usize)> = Vec::new();
        let mut offset = 0;
        for line in text.split_inclusive('\n') {
            let content = line.trim_end_matches('\n');
            let hashes = content.chars().take_while(|&c| c == '#').count();
            if hashes >= 1 && hashes <= 6 && content.chars().nth(hashes) == Some(' ') {
                let title = content[hashes + 1..].trim().to_string();
                headings.push((title, hashes as u8, offset));
            }
            offset += line.encode_utf16().count();
        }
        let total = offset;
        let mut seen = std::collections::HashMap::new();
        headings
            .iter()
            .enumerate()
            .map(|(i, (text, depth, from))| {
                let ordinal = *seen
                    .entry((text.clone(), *depth))
                    .and_modify(|n| *n += 1)
                    .or_insert(0u32);
                SectionSpan {
                    text: text.clone(),
                    depth: *depth,
                    ordinal,
                    from: *from,
                    to: headings.get(i + 1).map(|h| h.2).unwrap_or(total),
                }
            })
            .collect()
    }

    /// An anchor over `quote` in `text`, with real context and section refs,
    /// as the store would hold it after creation against `hash`.
    fn anchor_over(text: &str, quote: &str, nth: usize, hash: &str) -> Anchor {
        let sections = sections_of(text);
        let units: Vec<u16> = text.encode_utf16().collect();
        let from = offset_of(text, quote, nth);
        let to = from + quote.encode_utf16().count();
        let before: String =
            String::from_utf16_lossy(&units[from.saturating_sub(CONTEXT_WINDOW)..from]);
        let after: String =
            String::from_utf16_lossy(&units[to..(to + CONTEXT_WINDOW).min(units.len())]);
        let owner = |offset: usize| {
            sections
                .iter()
                .find(|s| offset >= s.from && offset < s.to)
                .map(|s| SectionRef {
                    text: s.text.clone(),
                    depth: s.depth,
                    ordinal: s.ordinal,
                })
        };
        Anchor {
            id: "a".into(),
            document_id: "d".into(),
            created_hash: hash.into(),
            pm_from: 10,
            pm_to: 20,
            selected_text: quote.into(),
            context_before: before,
            context_after: after,
            start_section: owner(from),
            end_section: owner(to.saturating_sub(1)),
            source_from: None,
            source_to: None,
            confidence: 1.0,
            detached_at: None,
            version: 1,
        }
    }

    // The anchored quote sits more than a context window into its section on
    // purpose: a selection within 32 units of a heading records that heading
    // inside its context, and renaming the section then (correctly, and
    // conservatively) detaches it. These tests exercise the corridor logic,
    // not that edge.
    const DOC: &str = "\
# Introduction

The argument opens with a claim about distribution.

# Methods

Before anything else, we calibrated the instruments twice.
We measured the failure mode carefully. The important failure was not
accuracy but uncertainty about the reader.

# Findings

The measurements repeat the phrase: the failure mode appears here too.
";

    #[test]
    fn the_same_hash_trusts_the_stored_positions() {
        let anchor = anchor_over(DOC, "measured the failure mode", 0, "h1");
        let placed = place_anchor(&anchor, DOC, "h1", &sections_of(DOC));
        assert_eq!(placed, Placement::Exact { pm_from: 10, pm_to: 20 });
    }

    #[test]
    fn an_edit_before_the_selection_relocates_it() {
        let anchor = anchor_over(DOC, "measured the failure mode", 0, "h1");
        let edited = DOC.replace("opens with a claim", "opens — boldly — with a claim");
        let placed = place_anchor(&anchor, &edited, "h2", &sections_of(&edited));
        let expected = offset_of(&edited, "measured the failure mode", 0);
        match placed {
            Placement::Relocated { offset_from, offset_to, confidence } => {
                assert_eq!(offset_from, expected);
                assert_eq!(offset_to, expected + "measured the failure mode".encode_utf16().count());
                assert_eq!(confidence, CORRIDOR_CONFIDENCE);
            }
            other => panic!("expected relocation, got {other:?}"),
        }
    }

    #[test]
    fn an_edit_inside_the_selection_is_unplaced() {
        let anchor = anchor_over(DOC, "measured the failure mode", 0, "h1");
        let edited = DOC.replace("measured the failure", "quantified the failure");
        assert_eq!(
            place_anchor(&anchor, &edited, "h2", &sections_of(&edited)),
            Placement::Unplaced
        );
    }

    #[test]
    fn deleted_text_is_unplaced() {
        let anchor = anchor_over(DOC, "measured the failure mode", 0, "h1");
        let edited = DOC.replace("We measured the failure mode carefully. ", "");
        assert_eq!(
            place_anchor(&anchor, &edited, "h2", &sections_of(&edited)),
            Placement::Unplaced
        );
    }

    #[test]
    fn a_phrase_repeated_inside_the_corridor_is_never_guessed_at() {
        // The whole sentence duplicates — run-up, quote and follow-on — so the
        // recorded context windows match *both* occurrences and can no longer
        // tell them apart. Two answers is no answer.
        let line = "The panel reviewed the wording line by line, and the panel \
                    agreed the wording should stand, pending a final read by \
                    counsel before publication.\n";
        let original = format!("# Minutes\n\n{line}");
        let anchor = anchor_over(&original, "the wording should stand", 0, "h1");
        let edited = format!("# Minutes\n\n{line}{line}");
        assert_eq!(
            place_anchor(&anchor, &edited, "h2", &sections_of(&edited)),
            Placement::Unplaced
        );
    }

    #[test]
    fn context_separates_occurrences_the_quote_alone_cannot() {
        // "the failure mode" appears in Methods and again in Findings. The
        // corridor is Methods only, so the Findings occurrence never competes.
        let anchor = anchor_over(DOC, "the failure mode", 0, "h1");
        let edited = DOC.replace("# Introduction", "# Introduction to the argument");
        let placed = place_anchor(&anchor, &edited, "h2", &sections_of(&edited));
        assert!(
            matches!(placed, Placement::Relocated { .. }),
            "unique in its corridor: {placed:?}"
        );
    }

    const TWINS: &str = "\
# Methods

First pass: the sample was heated to the melting point.

# Methods

Second pass: the sample was heated again, past the melting point.
";

    #[test]
    fn duplicate_headings_resolve_by_ordinal() {
        // Anchored in the *second* "Methods". The quote appears in both, so
        // only the ordinal keeps the corridor honest.
        let anchor = anchor_over(TWINS, "the sample was heated", 1, "h1");
        assert_eq!(anchor.start_section.as_ref().unwrap().ordinal, 1);

        let edited = TWINS.replace("First pass", "First pass, recalibrated");
        let placed = place_anchor(&anchor, &edited, "h2", &sections_of(&edited));
        let expected = offset_of(&edited, "the sample was heated", 1);
        match placed {
            Placement::Relocated { offset_from, .. } => assert_eq!(offset_from, expected),
            other => panic!("expected relocation into the second Methods, got {other:?}"),
        }
    }

    #[test]
    fn a_renamed_section_falls_back_to_a_global_unique_match() {
        let anchor = anchor_over(DOC, "measured the failure mode", 0, "h1");
        let edited = DOC.replace("# Methods", "# How we measured");
        let placed = place_anchor(&anchor, &edited, "h2", &sections_of(&edited));
        match placed {
            Placement::Relocated { confidence, offset_from, .. } => {
                assert_eq!(confidence, FALLBACK_CONFIDENCE, "corridor gone, weaker claim");
                assert_eq!(offset_from, offset_of(&edited, "measured the failure mode", 0));
            }
            other => panic!("expected fallback relocation, got {other:?}"),
        }
    }

    #[test]
    fn a_renamed_section_with_a_repeated_quote_is_unplaced() {
        let anchor = anchor_over(TWINS, "the sample was heated", 1, "h1");
        // Both corridors renamed away, the quote repeats, and the recorded
        // context still names the old heading (the selection sat right under
        // it). Nothing provable remains, so nothing is claimed.
        let edited = TWINS.replace("# Methods", "# Procedure");
        assert_eq!(
            place_anchor(&anchor, &edited, "h2", &sections_of(&edited)),
            Placement::Unplaced
        );
    }

    #[test]
    fn a_moved_section_keeps_its_anchor() {
        let anchor = anchor_over(DOC, "measured the failure mode", 0, "h1");
        // Methods moves below Findings, bytes intact. The corridor is looked
        // up by name, not position, so it is simply found at its new offsets.
        let methods = "# Methods\n\nBefore anything else, we calibrated the instruments twice.\nWe measured the failure mode carefully. The important failure was not\naccuracy but uncertainty about the reader.\n";
        let without = DOC.replace(methods, "");
        let moved = format!("{without}\n{methods}");
        let placed = place_anchor(&anchor, &moved, "h2", &sections_of(&moved));
        let expected = offset_of(&moved, "measured the failure mode", 0);
        match placed {
            Placement::Relocated { offset_from, confidence, .. } => {
                assert_eq!(offset_from, expected);
                assert_eq!(confidence, CORRIDOR_CONFIDENCE, "a found corridor is not a fallback");
            }
            other => panic!("expected relocation with the moved section, got {other:?}"),
        }
    }

    #[test]
    fn a_wholesale_rewrite_is_unplaced() {
        let anchor = anchor_over(DOC, "measured the failure mode", 0, "h1");
        let rewritten = "\
# Introduction

Entirely new prose making the same argument in different words.

# Methods

The measurement procedure is described from scratch here.
";
        assert_eq!(
            place_anchor(&anchor, rewritten, "h2", &sections_of(rewritten)),
            Placement::Unplaced
        );
    }

    #[test]
    fn offsets_count_utf16_units_not_bytes() {
        let text = "# One\n\nAn em dash — and a note 𝄞 precede the needle here.\n";
        let mut anchor = anchor_over(text, "the needle", 0, "h1");
        anchor.created_hash = "stale".into();
        let placed = place_anchor(&anchor, text, "h2", &sections_of(text));
        match placed {
            Placement::Relocated { offset_from, .. } => {
                assert_eq!(offset_from, offset_of(text, "the needle", 0));
                // And that offset is a UTF-16 count, not a byte count.
                let bytes = text.find("the needle").unwrap();
                assert_ne!(offset_from, bytes, "𝄞 and — must widen bytes past units");
            }
            other => panic!("{other:?}"),
        }
    }

    // ————— The evaluation corpus (fixtures/anchors/) —————
    //
    // A realistic essay, hostile on purpose: two `## Objections` sections and
    // a thesis sentence repeated verbatim across sections. Edited variants
    // are derived here in code so the scenario cannot drift from the bytes.

    const ESSAY: &str = include_str!("../../../fixtures/anchors/the-instrument-argument.md");

    /// The repeated thesis paragraph in "The Shape of the Evidence".
    const THESIS: &str = "The instruments a field builds to observe its subject end up shaping\nthe subject, and no amount of statistical care inside the pipeline corrects\nfor the pipeline.\n\n";

    #[test]
    fn corpus_a_quote_repeated_across_sections_relocates_inside_its_corridor() {
        // "builds to observe its subject" appears in the introduction and in
        // "The Shape of the Evidence"; the anchor was made in the latter.
        let anchor = anchor_over(ESSAY, "builds to observe its subject", 1, "h1");
        assert_eq!(anchor.start_section.as_ref().unwrap().text, "The Shape of the Evidence");

        let edited = ESSAY.replace("We take the point", "We concede the point");
        let placed = place_anchor(&anchor, &edited, "h2", &sections_of(&edited));
        let expected = offset_of(&edited, "builds to observe its subject", 1);
        match placed {
            Placement::Relocated { offset_from, .. } => assert_eq!(offset_from, expected),
            other => panic!("expected relocation within the corridor, got {other:?}"),
        }
    }

    #[test]
    fn corpus_duplicate_objections_headings_resolve_by_ordinal() {
        let anchor = anchor_over(ESSAY, "proves too much", 0, "h1");
        assert_eq!(anchor.start_section.as_ref().unwrap().text, "Objections");
        assert_eq!(anchor.start_section.as_ref().unwrap().ordinal, 1, "the second Objections");

        let edited = ESSAY.replace(
            "Every measurement system eventually measures itself.",
            "Every measurement system, sooner or later, measures itself.",
        );
        let placed = place_anchor(&anchor, &edited, "h2", &sections_of(&edited));
        let expected = offset_of(&edited, "proves too much", 0);
        match placed {
            Placement::Relocated { offset_from, .. } => assert_eq!(offset_from, expected),
            other => panic!("expected relocation, got {other:?}"),
        }
    }

    #[test]
    fn corpus_a_rewritten_section_never_borrows_the_quote_from_another() {
        // The corridor still exists but its prose is regenerated. The same
        // quote survives in the introduction — outside the corridor — and
        // must not be borrowed: the comment was about *this* section's claim.
        let anchor = anchor_over(ESSAY, "builds to observe its subject", 1, "h1");
        let edited = ESSAY.replace(THESIS, "All the evidence arrives freshly rephrased here.\n\n");
        assert_eq!(
            place_anchor(&anchor, &edited, "h2", &sections_of(&edited)),
            Placement::Unplaced
        );
    }

    #[test]
    fn corpus_a_duplicated_paragraph_detaches_rather_than_guesses() {
        // The quote sits deep enough in the thesis sentence that a duplicated
        // paragraph reproduces its whole context window twice. Two matches in
        // one corridor is ambiguity, however plausible either looks.
        let anchor = anchor_over(ESSAY, "its subject end up shaping", 1, "h1");
        let edited = ESSAY.replace(THESIS, &format!("{THESIS}{THESIS}"));
        assert_eq!(
            place_anchor(&anchor, &edited, "h2", &sections_of(&edited)),
            Placement::Unplaced
        );
    }

    #[test]
    fn a_detached_anchor_makes_no_claim() {
        let mut anchor = anchor_over(DOC, "measured the failure mode", 0, "h1");
        anchor.detached_at = Some(1);
        assert_eq!(place_anchor(&anchor, DOC, "h1", &sections_of(DOC)), Placement::Unplaced);
    }

    #[test]
    fn an_anchor_without_sections_searches_the_whole_document() {
        let text = "No headings at all. The needle sits in plain prose.\n";
        let mut anchor = anchor_over(text, "The needle", 0, "h1");
        assert!(anchor.start_section.is_none());
        anchor.created_hash = "stale".into();
        let placed = place_anchor(&anchor, text, "h2", &[]);
        match placed {
            Placement::Relocated { confidence, .. } => {
                assert_eq!(confidence, CORRIDOR_CONFIDENCE, "whole document is its scope, not a fallback");
            }
            other => panic!("{other:?}"),
        }
    }
}
