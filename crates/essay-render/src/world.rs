//! Minimal Typst `World`: in-memory main + template sources, the machine's
//! own fonts, and filesystem reads (images, data files) resolved against the
//! document's directory. Fully offline — no package downloads.
//!
//! **Fonts come from the system, not from the binary.** Embedding Typst's
//! default set costs 9.23 MB in every artifact for four families, and Essay
//! reaches two of them. The trade is real and worth stating plainly: a
//! document no longer typesets identically on every machine, because the
//! faces available differ. `templates/essay/essay.typ` names a stack rather
//! than a family so the fallback is a decision rather than an accident.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, PoisonError, RwLock};

use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook, FontInfo};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};

fn project_file(path: &str) -> FileId {
  FileId::new(RootedPath::new(
    VirtualRoot::Project,
    VirtualPath::new(path).expect("static project path is valid"),
  ))
}

/// One installed face: enough to name it in the book, plus the handle to read
/// its bytes if the compiler actually reaches for it.
///
/// The split matters. Building the book needs every face's *metadata*, which
/// means opening every font file on the machine once; loading every face's
/// *data* would mean holding a few hundred megabytes of fonts nobody asked
/// for. So the bytes arrive per face, on first use, and stay cached.
struct FontSlot {
  id: fontdb::ID,
  loaded: OnceLock<Option<Font>>,
}

struct FontSet {
  book: LazyHash<FontBook>,
  /// Parallel to the book: `slots[i]` is the face `book.info(i)` describes.
  slots: Vec<FontSlot>,
  db: fontdb::Database,
}

impl FontSet {
  /// Every face this machine can typeset with.
  ///
  /// A face whose metadata cannot be read is skipped rather than fatal — a
  /// broken font somewhere in a system directory must not stop a manuscript
  /// printing. Skipping in step keeps `slots` aligned with the book.
  fn scan() -> Self {
    let mut db = fontdb::Database::new();

    // The author's own faces go in first, and that order is the decision:
    // Typst resolves a family name to the earliest matching face, so a font
    // installed deliberately wins against the system's copy of the same
    // family. Someone who installs Libertinus Serif means theirs.
    if let Some(dir) = FONT_DIR.get() {
      db.load_fonts_dir(dir);
    }
    db.load_system_fonts();

    let mut book = FontBook::new();
    let mut slots = Vec::new();
    for face in db.faces() {
      let info = db
        .with_face_data(face.id, |data, index| FontInfo::new(data, index))
        .flatten();
      if let Some(info) = info {
        book.push(info);
        slots.push(FontSlot {
          id: face.id,
          loaded: OnceLock::new(),
        });
      }
    }

    FontSet {
      book: LazyHash::new(book),
      slots,
      db,
    }
  }
}

/// Where the author's own fonts live, if the shell has said.
///
/// Set once by the desktop shell, which is the only part of Essay that knows
/// about app data directories. The CLI and the tests leave it unset, and that
/// is not a degraded mode — it means "typeset with what the machine has",
/// which is what happens either way.
static FONT_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Point the typesetter at a directory of faces the author installed.
///
/// Read when the font set is next scanned rather than immediately, so calling
/// this during startup — before any document opens — costs nothing.
pub fn use_font_dir(dir: PathBuf) {
  let _ = FONT_DIR.set(dir);
}

/// The author's font directory, for whoever needs to put a file in it.
pub fn font_dir() -> Option<&'static Path> {
  FONT_DIR.get().map(PathBuf::as_path)
}

/// The scanned set, kept behind a lock rather than a `OnceLock` so that
/// installing a face does not mean relaunching the app to use it.
static FONTS: RwLock<Option<Arc<FontSet>>> = RwLock::new(None);

/// Forget the scanned faces; the next render picks up whatever is on disk now.
pub fn rescan_fonts() {
  *FONTS.write().unwrap_or_else(PoisonError::into_inner) = None;
}

/// The current font set, scanning on first use.
///
/// Handed out as an `Arc` and captured for the life of one `EssayWorld`, so a
/// render sees a consistent set of faces even if fonts are installed while it
/// is running.
fn fonts() -> Arc<FontSet> {
  if let Some(set) = FONTS
    .read()
    .unwrap_or_else(PoisonError::into_inner)
    .as_ref()
  {
    return Arc::clone(set);
  }
  let mut guard = FONTS.write().unwrap_or_else(PoisonError::into_inner);
  // Another thread may have scanned while this one waited for the write lock.
  if let Some(set) = guard.as_ref() {
    return Arc::clone(set);
  }
  let set = Arc::new(FontSet::scan());
  *guard = Some(Arc::clone(&set));
  set
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
  /// Captured at construction, so one render typesets against one set of
  /// faces even if fonts are installed while it runs.
  fonts: Arc<FontSet>,
}

impl EssayWorld {
  pub fn new(main_source: String, template_source: &str, root: Option<PathBuf>) -> Self {
    let main = project_file("/main.typ");
    let template = project_file("/template.typ");
    let mut sources = HashMap::new();
    sources.insert(main, Source::new(main, main_source));
    sources.insert(template, Source::new(template, template_source.to_string()));
    Self {
      main,
      sources,
      root,
      fonts: fonts(),
    }
  }
}

impl World for EssayWorld {
  fn library(&self) -> &LazyHash<Library> {
    library()
  }

  fn book(&self) -> &LazyHash<FontBook> {
    &self.fonts.book
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
    let slot = self.fonts.slots.get(index)?;
    slot
      .loaded
      .get_or_init(|| {
        self
          .fonts
          .db
          .with_face_data(slot.id, |data, index| {
            Font::new(Bytes::new(data.to_vec()), index)
          })
          .flatten()
      })
      .clone()
  }

  fn today(&self, _offset: Option<typst::foundations::Duration>) -> Option<Datetime> {
    None
  }
}
