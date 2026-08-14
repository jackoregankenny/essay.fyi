//! Writing image bytes to disk — the one byte-level write path the frontend
//! has, and deliberately the only one.
//!
//! Pasted image data has no source path (a webview never exposes one on
//! paste), so honouring `images.ts`'s path policy means *writing* a file. That
//! is why this module exists and why `imageDrop.ts` said paste "does nothing
//! rather than something silent or lossy" until it did.
//!
//! Three rules hold here, and none of them are the caller's to bend:
//!
//! 1. **The caller names the folder, never the filename.** Where the bytes
//!    belong is an authored preference (beside the document, in a per-document
//!    folder, or in a central library) and it lives in the frontend. What the
//!    file ends up *called* is this module's problem, because only the
//!    filesystem knows what is already taken.
//! 2. **Never overwrite.** A colliding stem gains `-2`, `-3`, and so on. An
//!    author who pastes two screenshots in a row has two screenshots, not one
//!    screenshot twice — and a paste must never destroy an image an earlier
//!    paragraph is still pointing at.
//! 3. **Extensions come from a fixed set.** The extension reaches this code
//!    from a clipboard MIME type, which is attacker-adjacent input the moment
//!    a document can be opened from anywhere; an unchecked one is a path
//!    component. Anything not on the list is refused rather than sanitised,
//!    because a silently renamed file is a broken reference later.

use std::fs;
use std::path::{Path, PathBuf};

/// The extensions Essay will write. Mirrors `IMAGE_EXTENSIONS` in
/// `apps/desktop/src/lib/images.ts`; the two must agree, and the Rust side is
/// the one that gets to refuse.
const ALLOWED: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg"];

/// Absolute paths with forward slashes — the one spelling `images.ts` accepts,
/// so a Windows backslash never reaches the Markdown.
fn normalise(path: &Path) -> String {
  path.to_string_lossy().replace('\\', "/")
}

/// Strip a caller-supplied stem down to something that is unambiguously a
/// filename and nothing else. Separators, parent hops, colons and control
/// characters all go; an empty result becomes `image`.
fn safe_stem(stem: &str) -> String {
  let mapped: String = stem
    .chars()
    .map(|c| match c {
      'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | ' ' | '.' => c,
      _ => '-',
    })
    .collect();

  // Collapse runs of the separators the mapping can produce. Containment is
  // already guaranteed — every separator became a dash, so what comes out is
  // one path component and one component cannot traverse anywhere — but
  // `../../etc/passwd` would otherwise survive as `..-..-etc-passwd`, and a
  // filename that still reads as a traversal attempt is a thing someone has
  // to reason about later. Collapsed, it is just `etc-passwd`.
  let mut collapsed = String::with_capacity(mapped.len());
  for c in mapped.chars() {
    let repeated = matches!(c, '-' | '.' | ' ') && collapsed.chars().last() == Some(c);
    if !repeated {
      collapsed.push(c);
    }
  }

  let trimmed = collapsed.trim_matches(|c| matches!(c, '.' | '-' | ' '));
  if trimmed.is_empty() {
    "image".to_string()
  } else {
    // Long stems are a paste-time accident (some clipboards hand over a whole
    // sentence as a suggested name); the reference has to stay readable.
    trimmed
      .chars()
      .take(60)
      .collect::<String>()
      .trim_matches(|c| matches!(c, '.' | '-' | ' '))
      .to_string()
  }
}

fn checked_extension(extension: &str) -> Result<String, String> {
  let lower = extension.trim().trim_start_matches('.').to_lowercase();
  if ALLOWED.contains(&lower.as_str()) {
    Ok(lower)
  } else {
    Err(format!("unsupported image type: {extension}"))
  }
}

/// The first free `<dir>/<stem>.<ext>`, `<stem>-2.<ext>`, … Bounded so a
/// pathological directory cannot spin here forever.
fn free_path(dir: &Path, stem: &str, extension: &str) -> Result<PathBuf, String> {
  for n in 1..=9_999 {
    let name = if n == 1 {
      format!("{stem}.{extension}")
    } else {
      format!("{stem}-{n}.{extension}")
    };
    let candidate = dir.join(name);
    if !candidate.exists() {
      return Ok(candidate);
    }
  }
  Err(format!("no free filename for {stem}.{extension} in {}", dir.display()))
}

/// Write pasted image bytes into `dir`, returning the absolute path written.
///
/// The directory is created if it is missing — an assets folder that does not
/// exist yet is the ordinary case for the first image in a document, not an
/// error to report to someone who is mid-sentence.
#[tauri::command]
pub fn write_image_bytes(
  dir: String,
  stem: String,
  extension: String,
  bytes: Vec<u8>,
) -> Result<String, String> {
  if bytes.is_empty() {
    return Err("refusing to write an empty image".to_string());
  }
  let extension = checked_extension(&extension)?;
  let dir = PathBuf::from(&dir);
  fs::create_dir_all(&dir).map_err(|err| format!("cannot create {}: {err}", dir.display()))?;

  let target = free_path(&dir, &safe_stem(&stem), &extension)?;
  // A plain write, not the manuscript's temp-and-rename: a torn image costs a
  // re-paste, and the guard that matters here is `free_path` never handing
  // back a name that is already spoken for.
  fs::write(&target, &bytes).map_err(|err| format!("cannot write {}: {err}", target.display()))?;
  Ok(normalise(&target))
}

/// Move an already-written image into `dir`, returning its new absolute path.
///
/// This is what turns a staged paste into a filed one when an untitled buffer
/// is first saved. A rename across volumes fails on every platform, so the
/// copy-then-delete fallback is not optional: the staging directory is in app
/// data and the document can be on any drive the author likes.
#[tauri::command]
pub fn relocate_image(from: String, dir: String) -> Result<String, String> {
  let source = PathBuf::from(&from);
  if !source.is_file() {
    return Err(format!("{from} is not a file"));
  }
  let dir = PathBuf::from(&dir);
  fs::create_dir_all(&dir).map_err(|err| format!("cannot create {}: {err}", dir.display()))?;

  let stem = source
    .file_stem()
    .map(|s| s.to_string_lossy().to_string())
    .unwrap_or_else(|| "image".to_string());
  let extension = source
    .extension()
    .map(|s| s.to_string_lossy().to_string())
    .unwrap_or_else(|| "png".to_string());
  let extension = checked_extension(&extension)?;
  let target = free_path(&dir, &safe_stem(&stem), &extension)?;

  match fs::rename(&source, &target) {
    Ok(()) => Ok(normalise(&target)),
    Err(_) => {
      fs::copy(&source, &target)
        .map_err(|err| format!("cannot copy to {}: {err}", target.display()))?;
      // The copy is the file now; failing to remove the original leaves a
      // stale byte in a scratch directory, which is not worth failing a save.
      let _ = fs::remove_file(&source);
      Ok(normalise(&target))
    }
  }
}

/// The two image homes that live in app data rather than beside a document.
///
/// `staged-images` holds pastes made before a buffer has a folder of its own —
/// in app data precisely *because* there is no document yet, the same
/// reasoning as `RecoveryStore`. `images` is the central library an author can
/// choose instead of an assets folder.
///
/// Allowlisted rather than joined blindly: `name` arrives from the frontend
/// and would otherwise be a path component.
const APP_IMAGE_DIRS: &[&str] = &["staged-images", "images"];

/// Absolute path to one of the app-data image homes, created if missing.
///
/// Nothing prunes either on a schedule: an image whose document was never
/// saved is the author's to throw away, and deleting it on a timer would be
/// Essay losing their work.
#[tauri::command]
pub fn image_app_dir(name: String, app: tauri::AppHandle) -> Result<String, String> {
  use tauri::Manager;
  if !APP_IMAGE_DIRS.contains(&name.as_str()) {
    return Err(format!("unknown image directory: {name}"));
  }
  let dir = app.path().app_data_dir().map_err(|err| err.to_string())?.join(&name);
  fs::create_dir_all(&dir).map_err(|err| format!("cannot create {}: {err}", dir.display()))?;
  Ok(normalise(&dir))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("essay-images-{name}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn writes_bytes_and_returns_a_forward_slash_path() {
    let dir = temp_dir("write");
    let path = write_image_bytes(
      dir.to_string_lossy().to_string(),
      "shot".into(),
      "png".into(),
      vec![1, 2, 3],
    )
    .unwrap();
    assert!(path.ends_with("shot.png"));
    assert!(!path.contains('\\'));
    assert_eq!(fs::read(&path).unwrap(), vec![1, 2, 3]);
  }

  #[test]
  fn a_second_paste_never_overwrites_the_first() {
    let dir = temp_dir("collide");
    let d = dir.to_string_lossy().to_string();
    let first = write_image_bytes(d.clone(), "shot".into(), "png".into(), vec![1]).unwrap();
    let second = write_image_bytes(d, "shot".into(), "png".into(), vec![2]).unwrap();
    assert_ne!(first, second);
    assert!(second.ends_with("shot-2.png"));
    assert_eq!(fs::read(&first).unwrap(), vec![1]);
  }

  #[test]
  fn a_stem_cannot_escape_its_directory() {
    let dir = temp_dir("escape");
    let path = write_image_bytes(
      dir.to_string_lossy().to_string(),
      "../../etc/passwd".into(),
      "png".into(),
      vec![1],
    )
    .unwrap();
    // The property that matters: the file landed in the directory it was
    // given, not somewhere up the tree.
    let written = Path::new(&path);
    assert_eq!(written.parent().unwrap(), dir);
    assert_eq!(written.file_name().unwrap(), "etc-passwd.png");
  }

  #[test]
  fn a_stem_of_pure_punctuation_still_produces_a_name() {
    let dir = temp_dir("punctuation");
    let path =
      write_image_bytes(dir.to_string_lossy().to_string(), "///".into(), "png".into(), vec![1])
        .unwrap();
    assert!(path.ends_with("image.png"));
  }

  #[test]
  fn an_unknown_extension_is_refused_rather_than_repaired() {
    let dir = temp_dir("ext");
    let err = write_image_bytes(
      dir.to_string_lossy().to_string(),
      "payload".into(),
      "exe".into(),
      vec![1],
    )
    .unwrap_err();
    assert!(err.contains("unsupported image type"));
  }

  #[test]
  fn an_empty_paste_is_not_a_file() {
    let dir = temp_dir("empty");
    assert!(
      write_image_bytes(dir.to_string_lossy().to_string(), "x".into(), "png".into(), vec![])
        .is_err()
    );
  }

  #[test]
  fn relocating_moves_the_bytes_and_frees_the_old_path() {
    let staging = temp_dir("stage");
    let final_dir = temp_dir("final");
    let staged = write_image_bytes(
      staging.to_string_lossy().to_string(),
      "pasted".into(),
      "png".into(),
      vec![7, 7],
    )
    .unwrap();

    let moved = relocate_image(staged.clone(), final_dir.to_string_lossy().to_string()).unwrap();
    assert!(moved.ends_with("pasted.png"));
    assert_eq!(fs::read(&moved).unwrap(), vec![7, 7]);
    assert!(!Path::new(&staged).exists());
  }
}
