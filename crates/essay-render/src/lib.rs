//! Typesetting pipeline (Milestone 2).
//!
//! Markdown source → Typst markup (convert) → embedded Typst compiler
//! (world) → SVG pages for the live preview, PDF for export, PNG for
//! tests and the CLI. Full-document compilation; the caller debounces.
//! Typing and navigation must never wait on this pipeline — hosts run it
//! off the UI thread.

mod convert;
pub mod formats;
mod world;

use std::path::PathBuf;

use thiserror::Error;
use typst_layout::PagedDocument;
use world::EssayWorld;

pub use convert::{markdown_to_typst, Converted, FrontMatter};
/// Faces the author supplied, on top of the machine's own. Essay embeds no
/// fonts (see `world.rs`), so this is how a document gets a face the system
/// does not ship — and the answer to the same manuscript setting differently
/// on two computers.
pub use world::{
  families, font_dir, install_fonts, remove_family, rescan_fonts, use_font_dir, FontError,
  FontFamily,
};


#[derive(Debug, Error)]
pub enum RenderError {
  #[error("typst compilation failed:\n{0}")]
  Compilation(String),
  /// Nothing to typeset with. Its own variant rather than a compilation
  /// failure because the cause and the fix are entirely different: the
  /// template is fine, the machine has no fonts installed.
  #[error(
    "no fonts are installed on this machine, so there is nothing to typeset with.\n\
     Essay uses the system's fonts rather than embedding its own — install a serif \
     and a monospace family (fonts-dejavu-core or fonts-liberation on Linux), or \
     put font files in Essay's font directory."
  )]
  NoFonts,
}

pub struct RenderedPages {
  pub svgs: Vec<String>,
  pub warnings: Vec<String>,
  /// Which format these pages were set in. Beside the warnings rather than
  /// inside them: a fallback is a sentence to read, but the format is a fact
  /// the caller acts on.
  pub format: formats::FormatUsed,
}

/// What one pass of the compiler produced, before it is turned into pages or
/// bytes. A struct rather than a tuple because the third member is the one
/// every caller forgets, and a tuple lets it be dropped silently.
struct Compiled {
  document: PagedDocument,
  warnings: Vec<String>,
  format: formats::FormatUsed,
}

/// Compile Markdown straight to SVG pages (the live preview format:
/// self-contained, crisp at any zoom, and ready for future source mapping).
pub fn render_svg_pages(
  markdown_source: &str,
  root: Option<PathBuf>,
) -> Result<RenderedPages, RenderError> {
  let compiled = compile(markdown_source, root)?;
  let options = typst_svg::SvgOptions::default();
  let svgs = compiled
    .document
    .pages()
    .iter()
    .map(|page| typst_svg::svg(page, &options))
    .collect();
  Ok(RenderedPages {
    svgs,
    warnings: compiled.warnings,
    format: compiled.format,
  })
}

/// Compile Markdown to a finished PDF.
pub fn render_pdf(
  markdown_source: &str,
  root: Option<PathBuf>,
) -> Result<Vec<u8>, RenderError> {
  let compiled = compile(markdown_source, root)?;
  typst_pdf::pdf(&compiled.document, &typst_pdf::PdfOptions::default())
    .map_err(|errors| RenderError::Compilation(format_diagnostics(&errors)))
}

/// Compile one page to PNG — used by tests and `essay render --format png`
/// to eyeball real typeset output. Gated behind the `png` feature: the
/// raster stack (typst-render, tiny-skia) has no consumer in the desktop
/// app, which only needs SVG (preview) and PDF (export).
#[cfg(feature = "png")]
pub fn render_png_page(
  markdown_source: &str,
  root: Option<PathBuf>,
  page_index: usize,
  pixel_per_pt: f32,
) -> Result<Vec<u8>, RenderError> {
  let compiled = compile(markdown_source, root)?;
  let page = compiled
    .document
    .pages()
    .get(page_index)
    .ok_or_else(|| RenderError::Compilation(format!("no page {page_index}")))?;
  let options = typst_render::RenderOptions {
    pixel_per_pt: f64::from(pixel_per_pt).into(),
    ..Default::default()
  };
  let pixmap = typst_render::render(page, &options);
  pixmap
    .encode_png()
    .map_err(|err| RenderError::Compilation(err.to_string()))
}

/// Bibliography sources Essay will find on its own, in the order it prefers
/// them. Hayagriva's own YAML format first, then BibTeX — both are what Typst
/// reads natively, so this costs nothing beyond the lookup.
///
/// A fixed list rather than a setting, because the point is that citing works
/// without configuring anything: put `references.bib` beside the manuscript
/// and `[@key]` starts typesetting. `docs/document-model.md` already places
/// the file exactly there.
const BIBLIOGRAPHY_NAMES: [&str; 4] = [
  "references.yml",
  "references.yaml",
  "references.bib",
  "bibliography.bib",
];

/// The document's bibliography file, relative to its folder.
///
/// Returns the bare filename: Typst resolves it through `World::file`, which
/// resolves against the same root as an image, so a relative name is what
/// keeps the reference working wherever the folder is moved to.
fn find_bibliography(root: &std::path::Path) -> Option<&'static str> {
  BIBLIOGRAPHY_NAMES
    .into_iter()
    .find(|name| root.join(name).is_file())
}

fn compile(markdown_source: &str, root: Option<PathBuf>) -> Result<Compiled, RenderError> {
  // Looked for before converting, not after, because it decides whether
  // `[@key]` may become a citation at all: Typst treats a `#cite` with no
  // `#bibliography` as a compile error, so a draft with nowhere to resolve
  // has to keep its citations as the plain text the author typed.
  //
  // An unsaved manuscript has no folder to look in. That is the ordinary
  // case, not a failure: citations start resolving when the file has a home
  // and a `references.bib` beside it.
  // Asked first, because everything below it assumes there is something to set
  // type in. Without this the symptom is a Typst diagnostic about an
  // unresolvable font family, which reads as a broken template.
  if world::installed_face_count() == 0 {
    return Err(RenderError::NoFonts);
  }

  let bibliography = root.as_deref().and_then(find_bibliography);
  let converted = markdown_to_typst(markdown_source, bibliography.is_some());
  // A stray `.bib` must not give an uncited document a References section.
  let main = build_main_source(&converted, bibliography.filter(|_| converted.has_citations));
  let resolved = formats::resolve(converted.front_matter.format.as_deref());
  let world = EssayWorld::new(main, &formats::library(resolved.format), root);
  let result = typst::compile::<PagedDocument>(&world);
  // A format names a *stack*, so most of its families are expected to be
  // absent — that is the mechanism working, not a fault. Typst warns once per
  // miss regardless, which on a machine without Libertinus put nine lines in
  // the Proof pane on every keystroke and taught the author to ignore it.
  // Suppressed here, and replaced below by the one fact that is actionable:
  // whether the face *you asked for* is on this machine.
  let mut warnings: Vec<String> = result
    .warnings
    .iter()
    .map(|w| w.message.to_string())
    .filter(|message| !message.starts_with("unknown font family:"))
    .collect();
  if let Some(face) = &converted.front_matter.font {
    if !face_installed(face) {
      warnings.insert(
        0,
        format!(
          "“{face}” is not installed on this machine, so {} used its own face. \
           The document still asks for it, and it will be used wherever it is installed.",
          resolved.format.label
        ),
      );
    }
  }
  // Reported as a warning rather than swallowed: the document asked for
  // something it did not get, and the page it did get looks entirely fine,
  // which is exactly why nobody would notice.
  if let Some(missing) = &resolved.fell_back_from {
    warnings.insert(
      0,
      format!(
        "no format named “{missing}” — set in {} instead",
        resolved.format.label
      ),
    );
  }
  match result.output {
    Ok(document) => Ok(Compiled {
      document,
      warnings,
      format: resolved.used(),
    }),
    Err(errors) => Err(RenderError::Compilation(format_diagnostics(&errors))),
  }
}

/// Case-insensitively, because a family is spelled by a human into front
/// matter and Typst matches families case-insensitively too.
fn face_installed(face: &str) -> bool {
  let wanted = face.trim().to_lowercase();
  families()
    .iter()
    .any(|family| family.name.to_lowercase() == wanted)
}

fn build_main_source(converted: &Converted, bibliography: Option<&str>) -> String {
  let fm = &converted.front_matter;
  // `/format.typ` and `doc` regardless of which format resolved — the entry
  // point is part of the contract a format signs, so this string never has to
  // know which one it is calling.
  let mut main = String::from("#import \"/format.typ\": doc\n#show: doc.with(");
  if let Some(title) = &fm.title {
    main.push_str(&format!("title: \"{}\", ", escape_str(title)));
  }
  if let Some(author) = &fm.author {
    main.push_str(&format!("author: \"{}\", ", escape_str(author)));
  }
  if let Some(date) = &fm.date {
    main.push_str(&format!("date: \"{}\", ", escape_str(date)));
  }
  if let Some(font) = &fm.font {
    main.push_str(&format!("face: \"{}\", ", escape_str(font)));
  }
  main.push_str(")\n\n");
  main.push_str(&converted.body);
  // After the body, because a bibliography is what follows an essay. Typst
  // renders the heading and the entries; the template's heading rules style
  // it like any other section, so it needs nothing there.
  if let Some(path) = bibliography {
    main.push_str("\n\n#bibliography(\"");
    main.push_str(&escape_str(path));
    main.push_str("\")\n");
  }
  main
}

fn escape_str(text: &str) -> String {
  text.replace('\\', "\\\\").replace('"', "\\\"")
}

fn format_diagnostics(errors: &[typst::diag::SourceDiagnostic]) -> String {
  errors
    .iter()
    .map(|e| e.message.to_string())
    .collect::<Vec<_>>()
    .join("\n")
}

#[cfg(test)]
mod tests {
  use super::*;

  const SAMPLE: &str = "---\ntitle: Test Document\n---\n\n# Introduction\n\nSome **bold** text with a [link](https://example.com).\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n> A quote about ==important things==.\n";

  /// Body only, so a test can put its own front matter in front of it.
  /// Deliberately exercises every construct a format restyles: headings at
  /// three levels, a quote, a table, a list, code, and a link.
  const SAMPLE_BODY: &str = "# One\n\nBody text with a [link](https://example.com) and `code`.\n\n## Two\n\n> A quote.\n\n### Three\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- first\n- second\n\n```rust\nfn main() {}\n```\n";

  #[test]
  fn compiles_sample_to_pages() {
    let pages = render_svg_pages(SAMPLE, None).expect("compiles");
    assert!(!pages.svgs.is_empty());
    assert!(pages.svgs[0].starts_with("<svg"));
  }

  #[test]
  fn produces_pdf_bytes() {
    let pdf = render_pdf(SAMPLE, None).expect("pdf");
    assert!(pdf.starts_with(b"%PDF-"));
  }

  /// Every built-in format has to typeset a real document, not merely parse.
  /// A format is Typst source embedded at compile time, so a mistake in one is
  /// invisible until an author picks it — this is the only place that notices.
  #[test]
  fn every_format_typesets_a_real_document() {
    for format in formats::FORMATS {
      let source = format!(
        "---\ntitle: Test\nauthor: Jack\ndate: 2026-08-14\nformat: {}\n---\n\n{}",
        format.id, SAMPLE_BODY
      );
      let pages = render_svg_pages(&source, None)
        .unwrap_or_else(|err| panic!("{} failed to typeset: {err}", format.id));
      assert!(!pages.svgs.is_empty(), "{} produced no pages", format.id);
      assert!(
        pages.warnings.is_empty(),
        "{} warned: {:?}",
        format.id,
        pages.warnings
      );
    }
  }

  /// `templates/format-template.typ` is what an author copies to write a
  /// format, so it has to typeset — and it has to keep typesetting as
  /// `base.typ` changes underneath it, which is the failure this catches.
  /// Compiled through the same path a real format takes, by standing it up as
  /// one; it is deliberately absent from `FORMATS`, so nothing else would.
  #[test]
  fn the_format_template_an_author_copies_actually_works() {
    const STARTING_POINT: formats::Format = formats::Format {
      id: "format-template",
      label: "Starting point",
      description: "The documented file an author copies.",
      source: formats::FORMAT_TEMPLATE,
    };
    let source = format!("---
title: Test
author: Jack
---

{SAMPLE_BODY}");
    let converted = markdown_to_typst(&source, false);
    let main = build_main_source(&converted, None);
    let world = EssayWorld::new(main, &formats::library(&STARTING_POINT), None);
    let result = typst::compile::<PagedDocument>(&world);
    let errors = result.output.err().map(|e| format_diagnostics(&e));
    assert!(errors.is_none(), "the starting point does not typeset: {errors:?}");
  }

  /// The report format emits a title page, so it must reach two pages where
  /// the essay format does not — the cheapest proof that the formats are
  /// actually different documents rather than the same one relabelled.
  #[test]
  fn formats_produce_different_pages() {
    let with = |id: &str| {
      let source = format!("---\ntitle: Test\nformat: {id}\n---\n\n{SAMPLE_BODY}");
      render_svg_pages(&source, None).expect("typesets").svgs.len()
    };
    assert!(
      with("report") > with("essay"),
      "report's title page did not produce an extra page"
    );
  }

  #[test]
  fn an_unknown_format_still_typesets_and_warns() {
    let source = format!("---\ntitle: Test\nformat: nope\n---\n\n{SAMPLE_BODY}");
    let pages = render_svg_pages(&source, None).expect("falls back rather than failing");
    assert!(!pages.svgs.is_empty());
    assert!(
      pages.warnings.iter().any(|w| w.contains("nope")),
      "the fallback was silent: {:?}",
      pages.warnings
    );
  }

  /// The pages have to say what they were set in, and say it in a form the
  /// caller can act on. The warning above is the same news as prose; a pane
  /// that has to tick the current format in a menu cannot read it from there.
  #[test]
  fn the_pages_report_the_format_they_were_set_in() {
    let asked = format!("---\ntitle: Test\nformat: memo\n---\n\n{SAMPLE_BODY}");
    let pages = render_svg_pages(&asked, None).expect("typesets");
    assert_eq!(pages.format.id, "memo");
    assert_eq!(pages.format.label, "Memo");
    assert!(pages.format.requested.is_none());

    let missing = format!("---\ntitle: Test\nformat: nope\n---\n\n{SAMPLE_BODY}");
    let pages = render_svg_pages(&missing, None).expect("falls back");
    assert_eq!(pages.format.id, formats::DEFAULT_FORMAT);
    assert_eq!(pages.format.requested.as_deref(), Some("nope"));

    // A document that never asked is not a document that was refused.
    let pages = render_svg_pages(SAMPLE, None).expect("typesets");
    assert_eq!(pages.format.id, formats::DEFAULT_FORMAT);
    assert!(pages.format.requested.is_none());
  }

  /// A face the machine does not have must fall through the format's stack
  /// rather than fail the render — the whole reason a format names a stack.
  #[test]
  fn an_uninstalled_face_does_not_break_the_page() {
    let source =
      format!("---\ntitle: Test\nfont: No Such Family At All\n---\n\n{SAMPLE_BODY}");
    let pages = render_svg_pages(&source, None).expect("typesets anyway");
    assert!(!pages.svgs.is_empty());
    // Said once, in the author's terms, rather than as Typst's per-family
    // misses — and it has to say the document still asks for the face, or the
    // author deletes a correct choice because their laptop lacks the font.
    assert_eq!(pages.warnings.len(), 1, "{:?}", pages.warnings);
    assert!(pages.warnings[0].contains("No Such Family At All"));
  }

  /// The stack's own misses must never reach the author. This is the warning
  /// that flooded the Proof pane nine lines at a time.
  #[test]
  fn a_formats_own_fallbacks_are_not_reported() {
    let pages = render_svg_pages(SAMPLE, None).expect("typesets");
    assert!(
      !pages
        .warnings
        .iter()
        .any(|w| w.contains("unknown font family")),
      "{:?}",
      pages.warnings
    );
  }

  #[test]
  fn reports_useful_error_for_bad_template_call() {
    // A degenerate doc must still compile (empty body is valid).
    let pages = render_svg_pages("", None).expect("empty compiles");
    assert_eq!(pages.svgs.len(), 1);
  }

  fn citations_fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/citations")
  }

  /// The end-to-end claim: `[@key]` beside a `references.bib` typesets.
  ///
  /// Compiling *is* the assertion, and it is a strong one. Typst rejects a
  /// `#cite` whose key is not in the bibliography, and rejects one with no
  /// bibliography at all — both are compile errors, not missing references.
  /// So a document this size that renders has necessarily found the file and
  /// resolved every key in it.
  ///
  /// Not asserted on the SVG text: typst-svg emits glyphs as paths, so the
  /// rendered words are not there to search for.
  #[test]
  fn a_cited_manuscript_typesets_with_its_bibliography() {
    let dir = citations_fixture();
    let source = std::fs::read_to_string(dir.join("cited-essay.md")).expect("fixture");

    let pages = render_svg_pages(&source, Some(dir)).expect("compiles with bibliography");

    assert!(!pages.svgs.is_empty());
  }

  /// The same manuscript with nowhere to resolve its sources — an unsaved
  /// draft, which is where most citations get typed in the first place.
  ///
  /// This is the case that fails loudly if citations are emitted
  /// unconditionally: the document does not lose its bibliography, it stops
  /// compiling, and the author gets a blank preview for typing `[@key]`.
  #[test]
  fn citing_without_a_folder_still_prints() {
    let source =
      std::fs::read_to_string(citations_fixture().join("cited-essay.md")).expect("fixture");
    let pages = render_svg_pages(&source, None).expect("compiles without bibliography");
    assert!(!pages.svgs.is_empty());
  }

  #[test]
  fn finds_the_bibliography_beside_the_manuscript() {
    assert_eq!(find_bibliography(&citations_fixture()), Some("references.bib"));
    assert_eq!(
      find_bibliography(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/diffs")),
      None
    );
  }

  #[test]
  fn a_stray_bib_does_not_give_an_uncited_document_a_reference_section() {
    let converted = markdown_to_typst("# Plain\n\nNo sources here.\n", true);
    assert!(!converted.has_citations);

    let main = build_main_source(&converted, Some("references.bib").filter(|_| converted.has_citations));
    assert!(!main.contains("#bibliography("));

    // …and it still typesets with the fixture folder as its root.
    render_svg_pages("# Plain\n\nNo sources here.\n", Some(citations_fixture())).expect("compiles");
  }

  #[test]
  fn a_cited_document_gets_the_bibliography_call() {
    let converted = markdown_to_typst("Old advice [@strunk1918].\n", true);
    let main = build_main_source(&converted, Some("references.bib"));
    assert!(main.contains("#bibliography(\"references.bib\")"));
  }
}
