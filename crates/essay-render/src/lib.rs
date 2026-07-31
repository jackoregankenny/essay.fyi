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
/// to eyeball real typeset output.
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

fn compile(
  markdown_source: &str,
  root: Option<PathBuf>,
) -> Result<(PagedDocument, Vec<String>), RenderError> {
  let converted = markdown_to_typst(markdown_source);
  let main = build_main_source(&converted);
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

fn build_main_source(converted: &Converted) -> String {
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
}
