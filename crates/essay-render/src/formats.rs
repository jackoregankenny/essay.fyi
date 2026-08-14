//! The formats a document can be set in.
//!
//! A *format* is a Typst template plus the claim that it suits a kind of
//! document. Four are built in and embedded, so rendering works with no
//! filesystem setup and an author who has never thought about templates still
//! gets a page worth sending.
//!
//! The built-ins are the *fallback*, not the only path — that distinction is
//! the whole point of this module existing rather than the template being an
//! `include_str!` at the top of `lib.rs`. Resolution is by id, and an id that
//! does not resolve falls back to the default rather than failing: a document
//! that names a format this machine has never heard of must still open, still
//! edit and still export, because the alternative is a manuscript held hostage
//! by a missing file. `resolve` reports which of those happened so the caller
//! can say so.
//!
//! Every format is entered the same way — `doc(title:, author:, date:, face:,
//! body)` — so `build_main_source` does not care which one it is calling.

/// Shared typography, imported by every format as `/base.typ`.
pub const BASE: &str = include_str!("../../../templates/base.typ");

/// Serialized as-is to the WebView, so a picker is a list of these rather than
/// a second copy of the same three strings maintained in the shell.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Format {
  pub id: &'static str,
  pub label: &'static str,
  /// One line, in the author's terms: what kind of document this is for.
  pub description: &'static str,
  /// Held back from the wire: what crosses is a menu entry, and several
  /// hundred lines of Typst per format is not something a menu has any use
  /// for. The compiler reads this field directly.
  #[serde(skip)]
  pub source: &'static str,
}

pub const FORMATS: &[Format] = &[
  Format {
    id: "essay",
    label: "Essay",
    description: "Justified serif on A4, page numbers, a quiet title. For an argument read straight through.",
    source: include_str!("../../../templates/essay/essay.typ"),
  },
  Format {
    id: "memo",
    label: "Memo",
    description: "Sans, ragged right, no page numbers. Short, internal, meant to be acted on.",
    source: include_str!("../../../templates/memo/memo.typ"),
  },
  Format {
    id: "report",
    label: "Report",
    description: "Title page, numbered sections, running head. Long, and read out of order.",
    source: include_str!("../../../templates/report/report.typ"),
  },
  Format {
    id: "rfc",
    label: "Proposal",
    description: "Numbered sections and a status block, at a narrow measure. Written to be argued with.",
    source: include_str!("../../../templates/rfc/rfc.typ"),
  },
];

pub const DEFAULT_FORMAT: &str = "essay";

/// The documented starting point an author copies to write their own format.
///
/// Not in `FORMATS` — it is a file to be copied, not a format to be chosen,
/// and offering it in the picker would put a fifth entry in the menu that is
/// just Essay with more comments. It is compiled here anyway, because a
/// starting point that does not typeset is worse than none: the author who
/// copies it inherits the fault and has no way to tell it was not theirs.
pub const FORMAT_TEMPLATE: &str = include_str!("../../../templates/format-template.typ");

/// What a lookup produced, and whether the document got what it asked for.
pub struct Resolved {
  pub format: &'static Format,
  /// The document named a format that does not exist here. The page is still
  /// produced — in the default — and the caller should say so rather than
  /// letting the author wonder why their report looks like an essay.
  pub fell_back_from: Option<String>,
}

/// What a finished render was actually set in.
///
/// The same facts `Resolved` holds, in the shape a caller reports rather than
/// typesets with. It travels beside the pages because the alternative — the
/// warning sentence `compile` writes — is prose: a pane can print it, but it
/// cannot tell from it which format is current, so it cannot show the choice
/// the author made or offer to correct a name that resolved to nothing.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatUsed {
  pub id: &'static str,
  pub label: &'static str,
  /// What the document asked for, and only when that is not what it got.
  /// Both ordinary cases — nothing asked for, or the request honoured — are
  /// `None`, because neither is news.
  pub requested: Option<String>,
}

impl Resolved {
  pub fn used(&self) -> FormatUsed {
    FormatUsed {
      id: self.format.id,
      label: self.format.label,
      requested: self.fell_back_from.clone(),
    }
  }
}

fn find(id: &str) -> Option<&'static Format> {
  FORMATS.iter().find(|format| format.id == id)
}

pub fn default_format() -> &'static Format {
  find(DEFAULT_FORMAT).expect("the default format is built in")
}

/// Resolve what the document asked for. `None` — the ordinary case of a
/// document that has never been given a format — is not a fallback: nothing
/// was asked for, so nothing was missed.
pub fn resolve(requested: Option<&str>) -> Resolved {
  match requested {
    None => Resolved {
      format: default_format(),
      fell_back_from: None,
    },
    Some(id) => match find(id) {
      Some(format) => Resolved {
        format,
        fell_back_from: None,
      },
      None => Resolved {
        format: default_format(),
        fell_back_from: Some(id.to_string()),
      },
    },
  }
}

/// The virtual files a render serves to Typst: the chosen format at a fixed
/// path, plus the base it imports.
pub fn library(format: &'static Format) -> [(&'static str, &'static str); 2] {
  [("/format.typ", format.source), ("/base.typ", BASE)]
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn every_format_is_entered_the_same_way() {
    // `build_main_source` calls `doc(..)` on whatever it is handed, so a
    // format that names its entry point differently is a runtime failure in a
    // document rather than a compile error here.
    for format in FORMATS {
      assert!(
        format.source.contains("#let doc("),
        "{} does not define `doc`",
        format.id
      );
    }
  }

  #[test]
  fn unknown_format_falls_back_and_says_so() {
    let resolved = resolve(Some("nonexistent"));
    assert_eq!(resolved.format.id, DEFAULT_FORMAT);
    assert_eq!(resolved.fell_back_from.as_deref(), Some("nonexistent"));
  }

  #[test]
  fn no_request_is_not_a_fallback() {
    let resolved = resolve(None);
    assert_eq!(resolved.format.id, DEFAULT_FORMAT);
    assert!(resolved.fell_back_from.is_none());
  }

  #[test]
  fn what_was_used_carries_the_unhonoured_request() {
    let used = resolve(Some("nonexistent")).used();
    assert_eq!(used.id, DEFAULT_FORMAT);
    assert_eq!(used.requested.as_deref(), Some("nonexistent"));

    // A request that was honoured leaves nothing to report, or every render
    // of every document would arrive looking like a correction.
    let used = resolve(Some("memo")).used();
    assert_eq!(used.id, "memo");
    assert!(used.requested.is_none());
  }

  /// The file authors are told to copy has to be a file that works. This is
  /// the cheapest possible statement of that: it defines `doc` like every
  /// other format, so `build_main_source` can call it. Whether it *typesets*
  /// is asserted in `lib.rs`, which is where a compiler is available.
  #[test]
  fn the_starting_point_signs_the_same_contract() {
    assert!(FORMAT_TEMPLATE.contains("#let doc("));
    // The two mistakes most likely to be copied outward, both of which
    // produce a page that looks fine on the machine that wrote it: a face
    // used instead of passed on, and typography applied to the body alone so
    // the title silently renders in Typst's default.
    assert!(
      FORMAT_TEMPLATE.contains("face: face"),
      "the template must pass the author's face through, not consume it"
    );
    assert!(
      FORMAT_TEMPLATE.contains("show: typography.with("),
      "the template must apply typography with `show:`, or its title block        falls outside the document's own face"
    );
  }

  /// The picker reads this list off the wire, so the three strings it shows
  /// have to survive the crossing — and the template body has to not make it,
  /// since it is the bulk of the payload and no menu wants it.
  #[test]
  fn a_format_crosses_as_a_menu_entry() {
    let json = serde_json::to_value(FORMATS).expect("serializes");
    let first = &json[0];
    assert_eq!(first["id"], "essay");
    assert!(first["label"].is_string());
    assert!(first["description"].is_string());
    assert!(first.get("source").is_none());
  }
}
