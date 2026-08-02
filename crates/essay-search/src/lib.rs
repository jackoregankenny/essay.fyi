//! Project and document search (Milestone 1: basic search).
//!
//! Search must feel immediate; a forty-page document is routine, not large.
//! That sizing is the design. This is a straight scan with no index — nothing
//! to build at launch, nothing to invalidate when an agent rewrites a file
//! behind Essay's back, and nothing left in `.essay/` that would be wrong if
//! deleted. An index would buy a writer no time they could perceive and would
//! add a thing that can be stale.
//!
//! There is no regex engine either. A writer looks for words and phrases; the
//! two knobs that earn their place are case sensitivity and whole words, and
//! both are a few lines here rather than a dependency and a syntax to learn.
//!
//! **Every offset this crate reports is in UTF-16 code units.** The consumer
//! that turns an offset back into a caret position is the editor, and
//! ProseMirror counts in UTF-16 like the JavaScript strings underneath it. A
//! byte offset would land mid-character in any document with an em dash in it,
//! and the caret would arrive somewhere the author was not looking.

mod project;

pub use project::{search_file, search_project, DocumentMatches, ProjectSearch};

use serde::{Deserialize, Serialize};

/// What the author asked for beyond the words themselves.
///
/// Case-insensitive and part-word by default, because that is what finds the
/// thing you half-remember writing. Both switches exist for the case where the
/// default finds too much — `Mark` the name inside `market`, say.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    /// Matches kept per document. The count is still reported in full, so
    /// "12 of 340" stays honest while the list stays readable.
    pub max_matches_per_document: usize,
    /// Documents kept in a project search.
    pub max_documents: usize,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            case_sensitive: false,
            whole_word: false,
            max_matches_per_document: 20,
            max_documents: 100,
        }
    }
}

/// One occurrence, with enough around it to be worth reading before clicking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    /// 1-based line in the text that was searched.
    pub line: usize,
    /// UTF-16 offset of the match within its line.
    pub column: usize,
    /// UTF-16 offset of the match from the start of the text. What the editor
    /// maps to a ProseMirror position.
    pub offset: usize,
    /// UTF-16 length of the matched text.
    pub length: usize,
    /// The sentence the match sits in, not the line it sits on.
    ///
    /// A markdown paragraph is usually a single very long line, so a line is
    /// not an excerpt — it is the whole paragraph. A sentence is the unit a
    /// writer reads to decide whether this is the occurrence they meant.
    pub excerpt: String,
    /// UTF-16 offset of the match within `excerpt`, for highlighting it.
    pub excerpt_start: usize,
}

/// Every match in one text, and how many there were before the cap.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMatches {
    pub matches: Vec<Match>,
    /// Occurrences found, which is not `matches.len()` once the cap bites.
    pub total: usize,
}

impl TextMatches {
    pub fn is_empty(&self) -> bool {
        self.total == 0
    }
}

/// How much of a sentence is worth showing before it stops being an excerpt.
const MAX_EXCERPT: usize = 200;

/// Characters of run-up kept before the match when a sentence has to be cut.
const LEAD: usize = 60;

/// Find `query` in `text`.
///
/// Matches never span a line break, and that is deliberate rather than a
/// limitation of the scan: a match that straddles two lines has no line number
/// and no excerpt worth reading. The editor hands over one line per block, so
/// nothing an author sees as a single sentence is split by the rule.
pub fn search_text(text: &str, query: &str, options: &SearchOptions) -> TextMatches {
    let needle: Vec<char> = query.chars().collect();
    let mut found = TextMatches::default();
    // An empty query matches at every position, which is the same as matching
    // nothing and considerably more work.
    if needle.is_empty() {
        return found;
    }

    let mut offset = 0;
    // `split_inclusive` keeps each line's terminator, so a CRLF file advances
    // the running offset by two and not by one. Splitting on '\n' and adding a
    // constant would drift by a character per line on any file written by a
    // Windows tool, and every caret would land one word further off.
    for (index, raw) in text.split_inclusive('\n').enumerate() {
        let content = raw.trim_end_matches('\n').trim_end_matches('\r');
        let chars: Vec<char> = content.chars().collect();
        for start in match_positions(&chars, &needle, options) {
            found.total += 1;
            if found.matches.len() >= options.max_matches_per_document {
                continue;
            }
            let column = utf16_len(&chars[..start]);
            let (excerpt, excerpt_start) = excerpt_around(&chars, start, needle.len());
            found.matches.push(Match {
                line: index + 1,
                column,
                offset: offset + column,
                length: utf16_len(&chars[start..start + needle.len()]),
                excerpt,
                excerpt_start,
            });
        }
        offset += raw.chars().map(char::len_utf16).sum::<usize>();
    }
    found
}

/// The document's own title — its first heading — for grouping results under
/// the name the author gave the thing rather than the name the filesystem did.
pub fn first_heading(text: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let rest = line.trim_start().strip_prefix('#')?;
        let title = rest.trim_start_matches('#').trim();
        (!title.is_empty()).then(|| title.to_string())
    })
}

/// Start index of every non-overlapping match in one line.
fn match_positions(line: &[char], needle: &[char], options: &SearchOptions) -> Vec<usize> {
    let mut starts = Vec::new();
    if needle.len() > line.len() {
        return starts;
    }
    let mut at = 0;
    while at + needle.len() <= line.len() {
        if matches_at(line, at, needle, options) {
            starts.push(at);
            // Occurrences are reported once: searching "aa" in "aaa" is one
            // match to a reader, not two.
            at += needle.len();
        } else {
            at += 1;
        }
    }
    starts
}

fn matches_at(line: &[char], at: usize, needle: &[char], options: &SearchOptions) -> bool {
    let same = needle
        .iter()
        .enumerate()
        .all(|(i, &wanted)| same_char(line[at + i], wanted, options.case_sensitive));
    if !same {
        return false;
    }
    if !options.whole_word {
        return true;
    }
    let before = at.checked_sub(1).map(|i| line[i]);
    let after = line.get(at + needle.len()).copied();
    !before.is_some_and(is_word_char) && !after.is_some_and(is_word_char)
}

fn same_char(a: char, b: char, case_sensitive: bool) -> bool {
    if case_sensitive {
        a == b
    } else {
        fold(a) == fold(b)
    }
}

/// Case folding, one character to one character.
///
/// Deliberately not `str::to_lowercase`: the folds that change length (`ß` to
/// `ss`, `İ` to `i` plus a combining dot) would put every offset after them
/// out by one, and an offset that does not land where the reader is looking is
/// a worse failure than missing a match nobody was searching for.
fn fold(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

/// A word character for the purpose of whole-word search.
///
/// The apostrophe counts as inside a word, not between two of them: whole-word
/// `can` must not match within `can't`, which in prose is a different word.
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '\'' || c == '\u{2019}'
}

fn utf16_len(chars: &[char]) -> usize {
    chars.iter().map(|c| c.len_utf16()).sum()
}

fn is_terminator(c: char) -> bool {
    matches!(c, '.' | '!' | '?' | '…')
}

/// The sentence containing the match, and where the match sits inside it.
fn excerpt_around(line: &[char], start: usize, len: usize) -> (String, usize) {
    let mut begin = sentence_start(line, start);
    // A heading's hashes and a bullet's dash are syntax, not prose, and an
    // excerpt that opens with them reads as a file listing rather than as a
    // sentence.
    if begin == 0 {
        begin = strip_markers(line, start);
    }
    let mut end = sentence_end(line, start + len);
    while end > start + len && line[end - 1].is_whitespace() {
        end -= 1;
    }

    let mut lead_cut = false;
    let mut tail_cut = false;
    if end - begin > MAX_EXCERPT {
        let clamped_begin = begin.max(start.saturating_sub(LEAD));
        let clamped_end = end.min((clamped_begin + MAX_EXCERPT).max(start + len));
        lead_cut = clamped_begin > begin;
        tail_cut = clamped_end < end;
        begin = clamped_begin;
        end = clamped_end;
    }

    let mut excerpt = String::new();
    if lead_cut {
        excerpt.push('…');
    }
    excerpt.extend(&line[begin..end]);
    if tail_cut {
        excerpt.push('…');
    }
    let lead = if lead_cut { 1 } else { 0 };
    (excerpt, lead + utf16_len(&line[begin..start]))
}

/// Where the sentence containing `from` begins.
///
/// An abbreviation ("Dr. Aoife") reads as a sentence break here and costs the
/// excerpt a few words of run-up. That is the whole downside, so the rule stays
/// the simple one rather than growing a list of abbreviations to know about.
fn sentence_start(line: &[char], from: usize) -> usize {
    let mut begin = 0;
    for i in 0..from.saturating_sub(1) {
        if is_terminator(line[i]) && line[i + 1].is_whitespace() {
            begin = i + 1;
        }
    }
    while begin < from && line[begin].is_whitespace() {
        begin += 1;
    }
    begin
}

fn sentence_end(line: &[char], from: usize) -> usize {
    for i in from..line.len() {
        if is_terminator(line[i]) && line.get(i + 1).is_none_or(|c| c.is_whitespace()) {
            return i + 1;
        }
    }
    line.len()
}

/// Skip the block markers a line opens with, never past `limit`.
fn strip_markers(line: &[char], limit: usize) -> usize {
    let mut at = 0;
    loop {
        let width = marker_width(&line[at..]);
        if width == 0 || at + width > limit {
            return at;
        }
        at += width;
    }
}

/// Width of one leading markdown block marker, or 0 where there is none.
///
/// Matched narrowly — marker *plus its space* — because `**bold**` opening a
/// paragraph is not a bullet, and trimming two asterisks off it would leave the
/// reader an excerpt that closes an emphasis it never opened.
fn marker_width(line: &[char]) -> usize {
    let hashes = line.iter().take_while(|&&c| c == '#').count();
    if hashes > 0 {
        return if hashes <= 6 && line.get(hashes) == Some(&' ') {
            hashes + 1
        } else {
            0
        };
    }
    if line.first() == Some(&'>') {
        return if line.get(1) == Some(&' ') { 2 } else { 1 };
    }
    if matches!(line.first(), Some('-' | '*' | '+')) && line.get(1) == Some(&' ') {
        return 2;
    }
    if line.first() == Some(&'[') && line.get(2) == Some(&']') && line.get(3) == Some(&' ') {
        return 4;
    }
    let digits = line.iter().take_while(|c| c.is_ascii_digit()).count();
    if digits > 0
        && matches!(line.get(digits), Some('.' | ')'))
        && line.get(digits + 1) == Some(&' ')
    {
        return digits + 2;
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find(text: &str, query: &str) -> TextMatches {
        search_text(text, query, &SearchOptions::default())
    }

    #[test]
    fn a_search_ignores_case_by_default() {
        let found = find("The Manuscript is a manuscript.", "manuscript");
        assert_eq!(found.total, 2);
    }

    #[test]
    fn a_case_sensitive_search_tells_the_two_apart() {
        let options = SearchOptions {
            case_sensitive: true,
            ..Default::default()
        };
        let found = search_text("The Manuscript is a manuscript.", "manuscript", &options);
        assert_eq!(found.total, 1);
        assert_eq!(found.matches[0].column, 20);
    }

    #[test]
    fn a_whole_word_search_skips_the_word_inside_a_longer_one() {
        let options = SearchOptions {
            whole_word: true,
            ..Default::default()
        };
        let found = search_text("Mark went to the market.", "mark", &options);
        assert_eq!(found.total, 1);
        assert_eq!(found.matches[0].column, 0);
    }

    #[test]
    fn a_whole_word_search_treats_an_apostrophe_as_part_of_the_word() {
        let options = SearchOptions {
            whole_word: true,
            ..Default::default()
        };
        assert_eq!(search_text("she can't stop", "can", &options).total, 0);
        assert_eq!(search_text("she can stop", "can", &options).total, 1);
    }

    #[test]
    fn every_match_carries_its_line_and_column() {
        let found = find("alpha\nbeta gamma\ngamma", "gamma");
        assert_eq!(found.total, 2);
        assert_eq!((found.matches[0].line, found.matches[0].column), (2, 5));
        assert_eq!((found.matches[1].line, found.matches[1].column), (3, 0));
    }

    #[test]
    fn offsets_count_utf16_code_units_so_the_editor_can_use_them() {
        // The em dash is one UTF-16 unit and three bytes; the note glyph is
        // two units and four bytes. A byte offset would be wrong twice over.
        let found = find("a — b 𝄞 needle", "needle");
        let text = "a — b 𝄞 needle";
        let expected: usize = text
            .chars()
            .take_while(|&c| c != 'n')
            .map(char::len_utf16)
            .sum();
        assert_eq!(found.matches[0].offset, expected);
        assert_eq!(found.matches[0].length, 6);
    }

    #[test]
    fn offsets_survive_windows_line_endings() {
        let found = find("first line\r\nsecond needle\r\n", "needle");
        // "first line" (10) + CRLF (2) + "second " (7).
        assert_eq!(found.matches[0].offset, 19);
        assert_eq!(found.matches[0].line, 2);
    }

    #[test]
    fn a_match_never_spans_a_line_break() {
        assert_eq!(find("one\ntwo", "one\ntwo").total, 0);
    }

    #[test]
    fn an_empty_query_finds_nothing() {
        assert!(find("a document with words in it", "").is_empty());
    }

    #[test]
    fn overlapping_occurrences_are_reported_once() {
        assert_eq!(find("aaa", "aa").total, 1);
    }

    #[test]
    fn the_excerpt_is_the_sentence_around_the_match_not_the_whole_line() {
        let line = "A first sentence entirely beside the point. The needle is here. And a third.";
        let found = find(line, "needle");
        assert_eq!(found.matches[0].excerpt, "The needle is here.");
        assert_eq!(found.matches[0].excerpt_start, 4);
    }

    #[test]
    fn an_excerpt_leaves_out_the_block_marker_the_line_opens_with() {
        assert_eq!(find("## The needle", "needle").matches[0].excerpt, "The needle");
        assert_eq!(find("- The needle", "needle").matches[0].excerpt, "The needle");
        assert_eq!(find("> - The needle", "needle").matches[0].excerpt, "The needle");
        assert_eq!(find("3. The needle", "needle").matches[0].excerpt, "The needle");
    }

    #[test]
    fn an_excerpt_keeps_emphasis_that_only_looks_like_a_bullet() {
        assert_eq!(
            find("**Emphasis** before the needle", "needle").matches[0].excerpt,
            "**Emphasis** before the needle"
        );
    }

    #[test]
    fn a_sentence_too_long_to_read_is_cut_around_the_match() {
        let long = format!("{} needle {}", "context ".repeat(40), "trailing ".repeat(40));
        let found = find(&long, "needle");
        let excerpt = &found.matches[0].excerpt;
        assert!(excerpt.chars().count() <= MAX_EXCERPT + 2, "{excerpt}");
        assert!(excerpt.starts_with('…') && excerpt.ends_with('…'), "{excerpt}");
        // The match survives the cut, and the highlight still points at it.
        let start = found.matches[0].excerpt_start;
        let matched: String = excerpt.chars().skip(start).take(6).collect();
        assert_eq!(matched, "needle");
    }

    #[test]
    fn the_per_document_cap_limits_the_list_but_not_the_count() {
        let options = SearchOptions {
            max_matches_per_document: 3,
            ..Default::default()
        };
        let text = "needle\n".repeat(10);
        let found = search_text(&text, "needle", &options);
        assert_eq!(found.matches.len(), 3);
        assert_eq!(found.total, 10);
    }

    #[test]
    fn a_documents_title_is_its_first_heading() {
        assert_eq!(
            first_heading("Some preamble.\n\n## On Rivers\n\n# Later\n"),
            Some("On Rivers".to_string())
        );
        assert_eq!(first_heading("No headings here.\n"), None);
    }
}
