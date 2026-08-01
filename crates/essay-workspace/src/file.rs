//! Guarded, atomic file IO for the canonical Markdown document.
//!
//! Contents are never normalised on the way through — no added trailing
//! newline, no line-ending rewriting. What the editor serialized is exactly
//! what lands on disk (invariant 2: saving must not gratuitously rewrite the
//! author's Markdown).

use crate::{Result, WorkspaceError};
use serde::Serialize;
use std::fs;
use std::io::Write as _;
use std::path::Path;

/// Content hash used everywhere as the document's identity at a point in
/// time: the write guard, the watcher's "have I seen this?" check, and the
/// blob key in the sidecar store.
pub fn hash_source(source: &str) -> String {
    blake3::hash(source.as_bytes()).to_hex().to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPayload {
    pub contents: String,
    pub hash: String,
}

/// The result of an attempted save. A conflict is an ordinary outcome, not an
/// error: the author asked to save, the world had moved on, and both versions
/// still exist. The caller decides.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum WriteOutcome {
    Written {
        hash: String,
    },
    Conflict {
        disk_hash: String,
        disk_contents: String,
    },
}

pub fn read_document(path: &Path) -> Result<DocumentPayload> {
    let contents = fs::read_to_string(path).map_err(|source| WorkspaceError::Read {
        path: path.display().to_string(),
        source,
    })?;
    let hash = hash_source(&contents);
    Ok(DocumentPayload { contents, hash })
}

/// Write `contents` to `path`, refusing if the file changed since the editor
/// last saw it.
///
/// `base_hash` is the hash the caller believes is on disk. `None` means the
/// caller owns this location outright — a first save, or a Save As where the
/// native dialog already asked about replacing.
pub fn write_document(
    path: &Path,
    contents: &str,
    base_hash: Option<&str>,
) -> Result<WriteOutcome> {
    if let Some(expected) = base_hash {
        // A missing file is not a conflict: the author's buffer is the only
        // surviving copy, and refusing to write would be the lossy choice.
        if path.exists() {
            let on_disk = read_document(path)?;
            if on_disk.hash != expected {
                return Ok(WriteOutcome::Conflict {
                    disk_hash: on_disk.hash,
                    disk_contents: on_disk.contents,
                });
            }
        }
    }

    write_atomic(path, contents)?;
    Ok(WriteOutcome::Written {
        hash: hash_source(contents),
    })
}

/// Write through a temporary file in the same directory, then rename over the
/// target. A crash mid-write leaves either the old document or the new one,
/// never a half-written manuscript.
fn write_atomic(path: &Path, contents: &str) -> Result<()> {
    let failed = |source: std::io::Error| WorkspaceError::Write {
        path: path.display().to_string(),
        source,
    };

    let dir = path.parent().ok_or_else(|| WorkspaceError::NotAFile {
        path: path.display().to_string(),
    })?;
    let name = path.file_name().ok_or_else(|| WorkspaceError::NotAFile {
        path: path.display().to_string(),
    })?;

    let temp = dir.join(format!(".{}.essay-tmp", name.to_string_lossy()));
    {
        let mut handle = fs::File::create(&temp).map_err(failed)?;
        handle.write_all(contents.as_bytes()).map_err(failed)?;
        handle.sync_all().map_err(failed)?;
    }

    // std::fs::rename replaces an existing destination on both Unix and
    // Windows (MOVEFILE_REPLACE_EXISTING).
    if let Err(source) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(failed(source));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_doc(contents: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("essay.md");
        fs::write(&path, contents).expect("seed");
        (dir, path)
    }

    #[test]
    fn writes_when_the_base_hash_still_matches() {
        let (_dir, path) = temp_doc("# One\n");
        let base = hash_source("# One\n");

        let outcome = write_document(&path, "# Two\n", Some(&base)).expect("write");

        assert!(matches!(outcome, WriteOutcome::Written { .. }));
        assert_eq!(fs::read_to_string(&path).unwrap(), "# Two\n");
    }

    #[test]
    fn refuses_to_clobber_an_edit_that_arrived_underneath() {
        let (_dir, path) = temp_doc("# One\n");
        let base = hash_source("# One\n");
        fs::write(&path, "# Edited by an agent\n").expect("external edit");

        let outcome = write_document(&path, "# Two\n", Some(&base)).expect("write");

        match outcome {
            WriteOutcome::Conflict { disk_contents, .. } => {
                assert_eq!(disk_contents, "# Edited by an agent\n");
            }
            WriteOutcome::Written { .. } => panic!("clobbered an external edit"),
        }
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "# Edited by an agent\n",
            "the external edit must survive a refused write"
        );
    }

    #[test]
    fn no_base_hash_means_the_caller_owns_the_location() {
        let (_dir, path) = temp_doc("# One\n");
        let outcome = write_document(&path, "# Replaced\n", None).expect("write");
        assert!(matches!(outcome, WriteOutcome::Written { .. }));
        assert_eq!(fs::read_to_string(&path).unwrap(), "# Replaced\n");
    }

    #[test]
    fn writes_a_file_that_vanished_rather_than_losing_the_buffer() {
        let (_dir, path) = temp_doc("# One\n");
        let base = hash_source("# One\n");
        fs::remove_file(&path).expect("delete");

        let outcome = write_document(&path, "# Recovered\n", Some(&base)).expect("write");

        assert!(matches!(outcome, WriteOutcome::Written { .. }));
        assert_eq!(fs::read_to_string(&path).unwrap(), "# Recovered\n");
    }

    #[test]
    fn leaves_no_temporary_files_behind() {
        let (dir, path) = temp_doc("# One\n");
        write_document(&path, "# Two\n", None).expect("write");

        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|name| name.contains("essay-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "left {leftovers:?}");
    }

    /// The WebView reads these keys by hand; nothing else type-checks the
    /// boundary, so pin it here.
    #[test]
    fn the_outcome_crosses_to_the_webview_in_camel_case() {
        let conflict = WriteOutcome::Conflict {
            disk_hash: "abc".into(),
            disk_contents: "# On disk\n".into(),
        };
        assert_eq!(
            serde_json::to_value(&conflict).unwrap(),
            serde_json::json!({
                "status": "conflict",
                "diskHash": "abc",
                "diskContents": "# On disk\n",
            })
        );

        let written = WriteOutcome::Written { hash: "abc".into() };
        assert_eq!(
            serde_json::to_value(&written).unwrap(),
            serde_json::json!({ "status": "written", "hash": "abc" })
        );
    }

    #[test]
    fn contents_are_not_normalised_on_the_way_through() {
        let (_dir, path) = temp_doc("");
        // No trailing newline, CRLF line endings, trailing spaces: all of it
        // is the author's business, none of it is ours.
        let quirky = "# Title\r\n\r\nA line with trailing space   \r\nno final newline";
        write_document(&path, quirky, None).expect("write");
        assert_eq!(fs::read_to_string(&path).unwrap(), quirky);
    }
}
