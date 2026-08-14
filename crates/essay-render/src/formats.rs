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

pub struct Format {
  pub id: &'static str,
  pub label: &'static str,
  /// One line, in the author's terms: what kind of document this is for.
  pub description: &'static str,
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

/// What a lookup produced, and whether the document got what it asked for.
pub struct Resolved {
  pub format: &'static Format,
  /// The document named a format that does not exist here. The page is still
  /// produced — in the default — and the caller should say so rather than
  /// letting the author wonder why their report looks like an essay.
  pub fell_back_from: Option<String>,
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
}
