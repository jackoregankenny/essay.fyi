//! Typesetting pipeline (Milestone 2).
//!
//! Markdown source → document index → Essay intermediate document → Typst
//! source + template → PDF / preview pages. Typst is embedded as a Rust
//! library; compilation is full-document after a short debounce (no
//! incremental typesetting until profiling demands it). Typing and
//! navigation must never wait on this pipeline.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum RenderError {
    #[error("typst compilation failed: {0}")]
    Compilation(String),
    #[error("template not found: {0}")]
    TemplateNotFound(String),
}

/// Boundary the app depends on; the Typst embedding stays replaceable
/// behind it.
pub trait Typesetter {
    /// Compile Typst source to a PDF.
    fn compile_pdf(&self, typst_source: &str) -> Result<Vec<u8>, RenderError>;
}
