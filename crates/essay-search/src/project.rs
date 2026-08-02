//! Search across the workspace folders.
//!
//! Essay is multi-root by design — any number of folders, never one vault — so
//! this takes a list of roots rather than a project directory, and everything
//! it reports is stated relative to the root it was found under.

use crate::{first_heading, search_text, Match, SearchOptions, TextMatches};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Directories that hold no manuscripts and can hold a great many files.
const SKIPPED_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "out"];

const MAX_DEPTH: u8 = 12;

/// A manuscript is prose. A `.md` past this size is generated output or a data
/// dump, and reading it costs more than any match in it is worth.
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// One document's matches, which is the unit a writer reads results in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMatches {
    /// Absolute path, for opening the file.
    pub path: String,
    /// The workspace root this was found under.
    pub root: String,
    /// Path relative to that root, for showing it.
    pub relative_path: String,
    /// The document's first heading, when it has one. A writer knows their
    /// work by its title far more readily than by its filename.
    pub title: Option<String>,
    pub matches: Vec<Match>,
    /// Occurrences in this document, before the per-document cap.
    pub total: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearch {
    /// Documents with at least one match, in root then path order.
    pub documents: Vec<DocumentMatches>,
    pub total_matches: usize,
    pub documents_searched: usize,
    /// The document cap was reached, so there is more than this to find.
    pub truncated: bool,
}

/// Search one file, or `None` if it holds no matches, cannot be read, or is
/// too large to be prose.
pub fn search_file(path: &Path, root: &Path, query: &str, options: &SearchOptions) -> Option<DocumentMatches> {
    let size = std::fs::metadata(path).ok()?.len();
    if size > MAX_FILE_BYTES {
        return None;
    }
    // Not UTF-8 means not a manuscript Essay could open either, so a read
    // failure here is a skip rather than an error worth surfacing.
    let contents = std::fs::read_to_string(path).ok()?;
    let TextMatches { matches, total } = search_text(&contents, query, options);
    if total == 0 {
        return None;
    }
    Some(DocumentMatches {
        path: path.to_string_lossy().to_string(),
        root: root.to_string_lossy().to_string(),
        relative_path: relative_path(root, path),
        title: first_heading(&contents),
        matches,
        total,
    })
}

/// Search every Markdown file under every root.
///
/// `skip` is the document already open in the editor. Its results come from the
/// buffer instead, which is both ahead of what is on disk and the only version
/// whose offsets can be turned into caret positions — listing the file's own
/// copy beside those would offer the author two answers to one question.
pub fn search_project(
    roots: &[PathBuf],
    query: &str,
    options: &SearchOptions,
    skip: Option<&Path>,
) -> ProjectSearch {
    let mut result = ProjectSearch::default();
    if query.is_empty() {
        return result;
    }
    let skip = skip.map(canonical);

    // A root and one of its own subfolders can both be in the workspace — the
    // explorer allows exactly that — and a file reached twice must still be one
    // result with one set of matches.
    let mut seen: HashSet<PathBuf> = HashSet::new();

    for root in roots {
        let mut files = Vec::new();
        collect_markdown(root, &mut files, 0);
        // Deterministic order, so the same search twice reads the same way.
        files.sort();

        for file in files {
            let key = canonical(&file);
            if !seen.insert(key.clone()) {
                continue;
            }
            if skip.as_ref() == Some(&key) {
                continue;
            }
            result.documents_searched += 1;
            let Some(document) = search_file(&file, root, query, options) else {
                continue;
            };
            result.total_matches += document.total;
            result.documents.push(document);
            if result.documents.len() >= options.max_documents {
                result.truncated = true;
                return result;
            }
        }
    }
    result
}

/// Canonical form for identity comparisons only.
///
/// Falls back to the path as given: a path that cannot be canonicalised is one
/// that does not resolve, and treating it as its own identity is no worse than
/// what the caller passed in.
fn canonical(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn collect_markdown(dir: &Path, out: &mut Vec<PathBuf>, depth: u8) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // `.essay/` holds the document's own history — every revision of every
        // manuscript. Searching it would answer a search for a sentence with
        // every draft that ever contained it.
        if name.starts_with('.') {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if file_type.is_dir() {
            if !SKIPPED_DIRS.contains(&name.as_str()) {
                collect_markdown(&path, out, depth + 1);
            }
        } else {
            let lower = name.to_lowercase();
            if lower.ends_with(".md") || lower.ends_with(".markdown") {
                out.push(path);
            }
        }
    }
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A workspace folder holding the named files.
    fn workspace(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        for (name, contents) in files {
            let path = dir.path().join(name);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).expect("parent");
            }
            std::fs::write(&path, contents).expect("write");
        }
        dir
    }

    fn search(roots: &[PathBuf], query: &str) -> ProjectSearch {
        search_project(roots, query, &SearchOptions::default(), None)
    }

    #[test]
    fn a_search_walks_every_root_and_groups_results_by_document() {
        let one = workspace(&[("a.md", "the needle is here\n")]);
        let two = workspace(&[
            ("b.md", "no match at all\n"),
            ("notes/c.md", "needle again\nand a needle twice\n"),
        ]);
        let found = search(
            &[one.path().to_path_buf(), two.path().to_path_buf()],
            "needle",
        );

        assert_eq!(found.documents.len(), 2);
        assert_eq!(found.total_matches, 3);
        assert_eq!(found.documents_searched, 3);
        assert_eq!(found.documents[0].relative_path, "a.md");
        assert_eq!(found.documents[1].relative_path, "notes/c.md");
        assert_eq!(found.documents[1].total, 2);
    }

    #[test]
    fn a_document_is_reported_under_its_own_title() {
        let dir = workspace(&[("river.md", "# On Rivers\n\nThe needle floats.\n")]);
        let found = search(&[dir.path().to_path_buf()], "needle");
        assert_eq!(found.documents[0].title.as_deref(), Some("On Rivers"));
    }

    #[test]
    fn the_open_document_is_left_to_the_editors_own_results() {
        let dir = workspace(&[("open.md", "the needle\n"), ("other.md", "the needle\n")]);
        let found = search_project(
            &[dir.path().to_path_buf()],
            "needle",
            &SearchOptions::default(),
            Some(&dir.path().join("open.md")),
        );
        assert_eq!(found.documents.len(), 1);
        assert_eq!(found.documents[0].relative_path, "other.md");
    }

    #[test]
    fn a_file_reached_through_two_overlapping_roots_is_reported_once() {
        let dir = workspace(&[("notes/deep.md", "the needle\n")]);
        let found = search(
            &[dir.path().to_path_buf(), dir.path().join("notes")],
            "needle",
        );
        assert_eq!(found.documents.len(), 1);
        assert_eq!(found.total_matches, 1);
    }

    #[test]
    fn hidden_directories_and_non_markdown_files_are_not_searched() {
        let dir = workspace(&[
            (".essay/history.md", "the needle\n"),
            ("notes.txt", "the needle\n"),
            ("real.md", "the needle\n"),
        ]);
        let found = search(&[dir.path().to_path_buf()], "needle");
        assert_eq!(found.documents.len(), 1);
        assert_eq!(found.documents[0].relative_path, "real.md");
    }

    #[test]
    fn the_document_cap_stops_the_walk_and_says_so() {
        let files: Vec<(String, String)> = (0..5)
            .map(|n| (format!("doc{n}.md"), "the needle\n".to_string()))
            .collect();
        let borrowed: Vec<(&str, &str)> = files
            .iter()
            .map(|(name, body)| (name.as_str(), body.as_str()))
            .collect();
        let dir = workspace(&borrowed);
        let options = SearchOptions {
            max_documents: 2,
            ..Default::default()
        };
        let found = search_project(&[dir.path().to_path_buf()], "needle", &options, None);
        assert_eq!(found.documents.len(), 2);
        assert!(found.truncated);
    }

    #[test]
    fn an_empty_query_searches_nothing_at_all() {
        let dir = workspace(&[("a.md", "words\n")]);
        let found = search(&[dir.path().to_path_buf()], "");
        assert_eq!(found.documents_searched, 0);
    }
}
