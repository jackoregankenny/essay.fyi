//! Typesetting pipeline (Milestone 2).
//!
//! Markdown source → Typst markup (convert) → embedded Typst compiler
//! (world) → SVG pages for the live preview, PDF for export, PNG for
//! tests and the CLI. Full-document compilation; the caller debounces.
//! Typing and navigation must never wait on this pipeline — hosts run it
//! off the UI thread.

mod convert;
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
pub use world::{font_dir, rescan_fonts, use_font_dir};

/// The default Essay template, embedded so rendering works with zero
/// filesystem setup. Authors will be able to override it per project.
const ESSAY_TEMPLATE: &str = include_str!("../../../templates/essay/essay.typ");

#[derive(Debug, Error)]
pub enum RenderError {
  #[error("typst compilation failed:\n{0}")]
  Compilation(String),
}

pub struct RenderedPages {
  pub svgs: Vec<String>,
  pub warnings: Vec<String>,
}

/// Compile Markdown straight to SVG pages (the live preview format:
/// self-contained, crisp at any zoom, and ready for future source mapping).
pub fn render_svg_pages(
  markdown_source: &str,
  root: Option<PathBuf>,
) -> Result<RenderedPages, RenderError> {
  let (document, warnings) = compile(markdown_source, root)?;
  let options = typst_svg::SvgOptions::default();
  let svgs = document
    .pages()
    .iter()
    .map(|page| typst_svg::svg(page, &options))
    .collect();
  Ok(RenderedPages { svgs, warnings })
}

/// Compile Markdown to a finished PDF.
pub fn render_pdf(
  markdown_source: &str,
  root: Option<PathBuf>,
) -> Result<Vec<u8>, RenderError> {
  let (document, _) = compile(markdown_source, root)?;
  typst_pdf::pdf(&document, &typst_pdf::PdfOptions::default())
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
  let (document, _) = compile(markdown_source, root)?;
  let page = document
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

fn compile(
  markdown_source: &str,
  root: Option<PathBuf>,
) -> Result<(PagedDocument, Vec<String>), RenderError> {
  // Looked for before converting, not after, because it decides whether
  // `[@key]` may become a citation at all: Typst treats a `#cite` with no
  // `#bibliography` as a compile error, so a draft with nowhere to resolve
  // has to keep its citations as the plain text the author typed.
  //
  // An unsaved manuscript has no folder to look in. That is the ordinary
  // case, not a failure: citations start resolving when the file has a home
  // and a `references.bib` beside it.
  let bibliography = root.as_deref().and_then(find_bibliography);
  let converted = markdown_to_typst(markdown_source, bibliography.is_some());
  // A stray `.bib` must not give an uncited document a References section.
  let main = build_main_source(&converted, bibliography.filter(|_| converted.has_citations));
  let world = EssayWorld::new(main, ESSAY_TEMPLATE, root);
  let result = typst::compile::<PagedDocument>(&world);
  let warnings = result
    .warnings
    .iter()
    .map(|w| w.message.to_string())
    .collect();
  match result.output {
    Ok(document) => Ok((document, warnings)),
    Err(errors) => Err(RenderError::Compilation(format_diagnostics(&errors))),
  }
}

fn build_main_source(converted: &Converted, bibliography: Option<&str>) -> String {
  let fm = &converted.front_matter;
  let mut main = String::from("#import \"/template.typ\": essay\n#show: essay.with(");
  if let Some(title) = &fm.title {
    main.push_str(&format!("title: \"{}\", ", escape_str(title)));
  }
  if let Some(author) = &fm.author {
    main.push_str(&format!("author: \"{}\", ", escape_str(author)));
  }
  if let Some(date) = &fm.date {
    main.push_str(&format!("date: \"{}\", ", escape_str(date)));
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
