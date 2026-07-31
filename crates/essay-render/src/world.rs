//! Minimal Typst `World`: in-memory main + template sources, embedded
//! default fonts, and filesystem reads (images, data files) resolved
//! against the document's directory. Fully offline — no package downloads.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};

fn project_file(path: &str) -> FileId {
  FileId::new(RootedPath::new(
    VirtualRoot::Project,
    VirtualPath::new(path).expect("static project path is valid"),
  ))
}

/// Embedded default fonts (Libertinus, New Computer Modern, DejaVu Mono…),
/// loaded once per process.
fn fonts() -> &'static (LazyHash<FontBook>, Vec<Font>) {
  static FONTS: OnceLock<(LazyHash<FontBook>, Vec<Font>)> = OnceLock::new();
  FONTS.get_or_init(|| {
    let mut book = FontBook::new();
    let mut fonts = Vec::new();
    for data in typst_assets::fonts() {
      let bytes = Bytes::new(data);
      for font in Font::iter(bytes) {
        book.push(font.info().clone());
        fonts.push(font);
      }
    }
    (LazyHash::new(book), fonts)
  })
}

fn library() -> &'static LazyHash<Library> {
  static LIBRARY: OnceLock<LazyHash<Library>> = OnceLock::new();
  LIBRARY.get_or_init(|| LazyHash::new(Library::default()))
}

pub struct EssayWorld {
  main: FileId,
  sources: HashMap<FileId, Source>,
  /// Directory that relative file references (images…) resolve against —
  /// the document's folder when the document has been saved.
  root: Option<PathBuf>,
}

impl EssayWorld {
  pub fn new(main_source: String, template_source: &str, root: Option<PathBuf>) -> Self {
    let main = project_file("/main.typ");
    let template = project_file("/template.typ");
    let mut sources = HashMap::new();
    sources.insert(main, Source::new(main, main_source));
    sources.insert(template, Source::new(template, template_source.to_string()));
    Self { main, sources, root }
  }
}

impl World for EssayWorld {
  fn library(&self) -> &LazyHash<Library> {
    library()
  }

  fn book(&self) -> &LazyHash<FontBook> {
    &fonts().0
  }

  fn main(&self) -> FileId {
    self.main
  }

  fn source(&self, id: FileId) -> FileResult<Source> {
    self
      .sources
      .get(&id)
      .cloned()
      .ok_or_else(|| FileError::NotFound(id.vpath().as_rootless_path().into()))
  }

  fn file(&self, id: FileId) -> FileResult<Bytes> {
    let Some(root) = &self.root else {
      return Err(FileError::NotFound(id.vpath().as_rootless_path().into()));
    };
    let Some(path) = id.vpath().resolve(root) else {
      return Err(FileError::AccessDenied);
    };
    std::fs::read(&path)
      .map(Bytes::new)
      .map_err(|err| FileError::from_io(err, &path))
  }

  fn font(&self, index: usize) -> Option<Font> {
    fonts().1.get(index).cloned()
  }

  fn today(&self, _offset: Option<typst::foundations::Duration>) -> Option<Datetime> {
    None
  }
}
