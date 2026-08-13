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

/// How many faces the machine offers.
///
/// Worth asking before compiling, because the alternative is discovering it as
/// a Typst diagnostic about an unresolvable family — which reads as a broken
/// template rather than as a machine with no fonts installed. Bare containers
/// and minimal CI images are exactly where this happens.
pub fn installed_face_count() -> usize {
  fonts().slots.len()
}

/// One family an author can ask for by name in a template.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
  pub name: String,
  /// How many faces back it — regular, bold, italic and so on.
  pub faces: usize,
  /// True when at least one face came from Essay's own font directory rather
  /// than from the operating system. The distinction is the whole point of the
  /// panel: these are the ones an author put there and can take away again.
  pub installed_by_author: bool,
}

/// Every family the typesetter can currently resolve, alphabetically.
///
/// Deduplicated by name because a family arrives once per face, and an author
/// choosing a typeface is choosing "Georgia", not "Georgia Bold Italic".
pub fn families() -> Vec<FontFamily> {
  let set = fonts();
  let dir = FONT_DIR.get();
  let mut by_name: HashMap<String, FontFamily> = HashMap::new();

  for face in set.db.faces() {
    // The first family name is English US where the font has one, which is
    // the name a template would spell.
    let Some((name, _)) = face.families.first() else {
      continue;
    };
    let mine = dir.is_some_and(|dir| face_path(&face.source).is_some_and(|p| p.starts_with(dir)));
    let entry = by_name.entry(name.clone()).or_insert_with(|| FontFamily {
      name: name.clone(),
      faces: 0,
      installed_by_author: false,
    });
    entry.faces += 1;
    entry.installed_by_author |= mine;
  }

  let mut out: Vec<FontFamily> = by_name.into_values().collect();
  out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
  out
}

/// Where a face was loaded from, when it came from a file at all.
fn face_path(source: &fontdb::Source) -> Option<&Path> {
  match source {
    fontdb::Source::File(path) => Some(path),
    fontdb::Source::SharedFile(path, _) => Some(path),
    fontdb::Source::Binary(_) => None,
  }
}

#[derive(Debug, thiserror::Error)]
pub enum FontError {
  #[error("Essay has nowhere to keep fonts on this machine")]
  NoFontDir,
  #[error("{name} is not a font file Essay can read")]
  NotAFont { name: String },
  #[error("cannot install {name}: {source}")]
  Io {
    name: String,
    #[source]
    source: std::io::Error,
  },
}

/// Copy font files into Essay's own directory and pick them up immediately.
///
/// Every file is parsed before it is copied, not after. A directory that only
/// ever contained real fonts cannot be the reason a document stops typesetting,
/// and "it installed and then nothing worked" is the failure worth designing
/// out — it is indistinguishable, from the author's side, from Essay breaking.
///
/// Returns the names actually installed.
pub fn install_fonts(files: &[PathBuf]) -> Result<Vec<String>, FontError> {
  let dir = FONT_DIR.get().ok_or(FontError::NoFontDir)?;
  let mut installed = Vec::new();

  for file in files {
    let name = file
      .file_name()
      .map(|n| n.to_string_lossy().into_owned())
      .unwrap_or_else(|| file.display().to_string());

    let data = std::fs::read(file).map_err(|source| FontError::Io {
      name: name.clone(),
      source,
    })?;
    if FontInfo::new(&data, 0).is_none() {
      return Err(FontError::NotAFont { name });
    }

    std::fs::write(dir.join(&name), &data).map_err(|source| FontError::Io {
      name: name.clone(),
      source,
    })?;
    installed.push(name);
  }

  if !installed.is_empty() {
    rescan_fonts();
  }
  Ok(installed)
}

/// Remove every face of a family that Essay installed.
///
/// Only from Essay's own directory: a family the operating system provides is
/// not ours to delete, and a writing app that uninstalls system fonts would be
/// doing something nobody asked for.
pub fn remove_family(family: &str) -> Result<usize, FontError> {
  let dir = FONT_DIR.get().ok_or(FontError::NoFontDir)?;
  let set = fonts();

  let doomed: Vec<PathBuf> = set
    .db
    .faces()
    .filter(|face| {
      face
        .families
        .first()
        .is_some_and(|(name, _)| name.eq_ignore_ascii_case(family))
    })
    .filter_map(|face| face_path(&face.source))
    .filter(|path| path.starts_with(dir))
    .map(Path::to_path_buf)
    .collect();

  let mut removed = 0;
  for path in doomed {
    // Best effort per file: one locked handle should not leave the rest of a
    // family half-removed and the panel telling a story neither true nor false.
    if std::fs::remove_file(&path).is_ok() {
      removed += 1;
    }
  }
  if removed > 0 {
    rescan_fonts();
  }
  Ok(removed)
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
      .ok_or_else(|| FileError::NotFound(id.vpath().get_without_slash().into()))
  }

  fn file(&self, id: FileId) -> FileResult<Bytes> {
    let Some(root) = &self.root else {
      return Err(FileError::NotFound(id.vpath().get_without_slash().into()));
    };
    let path = id
      .vpath()
      .realize(root)
      .map_err(|_| FileError::AccessDenied)?;
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
