//! Watching whole workspace folders for files appearing, disappearing and
//! being renamed.
//!
//! This is a different job from `DocumentWatcher`, which is why it is a second
//! watcher rather than a generalisation of the first. That one asks "did the
//! bytes of *this one file* change?" and answers with a content hash. This one
//! asks "is the explorer's list of files still right?" — a question about the
//! shape of a directory tree, where content is irrelevant and a rename is the
//! interesting event. The two share the same discipline, though: the events
//! themselves are not trusted, they only mark a root as worth re-reading, and
//! the listing decides.
//!
//! Deciding by listing rather than by event is what keeps Essay's own autosave
//! from redrawing the explorer every 1.5 seconds. A save fires events under the
//! root, the root is re-walked, the listing is byte-identical, and nothing is
//! reported. The alternative — trusting event kinds — means either missing
//! renames on Windows (where they arrive as remove+create pairs whose ordering
//! is not guaranteed) or redrawing on every keystroke's worth of autosave.

use crate::Result;
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// How long a root has to stay still before it is re-walked. Longer than the
/// document watcher's 200ms because the work behind it is a directory walk
/// rather than one small read, and because an author who has just created a
/// file is not watching the millisecond it appears.
const QUIET_PERIOD: Duration = Duration::from_millis(400);

/// Fallback cadence when the platform's native backend is unavailable.
const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Directories that hold build output or tooling state rather than the
/// author's documents. Skipped by the walk, so an event inside one can never
/// change the listing and is dropped before it wakes anything.
const SKIPPED_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "out"];

/// How deep the walk goes. A guard against symlink loops and against someone
/// adding their home directory as a workspace folder, not a statement about
/// how people organise essays.
const MAX_DEPTH: u8 = 12;

/// One root whose file listing has changed, with the new listing.
///
/// The listing travels with the event so the explorer does not have to ask
/// again: the walk has just been done, and a second one would race the first.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootChange {
    pub root: String,
    pub paths: Vec<String>,
}

/// One workspace folder's Markdown contents as root-relative paths, in the
/// convention the explorer's tree widget takes: directories end with '/',
/// files are `.md`/`.markdown`. Hidden entries and build directories are
/// skipped.
pub fn markdown_tree(root: &Path) -> Vec<String> {
    let mut paths = Vec::new();
    if root.is_dir() {
        walk(root, root, &mut paths, 0);
    }
    paths
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<String>, depth: u8) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    // Sorted, because `read_dir` order is the filesystem's and comparing one
    // listing against the last is how a change is detected at all. Two walks
    // that disagree only about order would report every save as a change.
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if file_type.is_dir() {
            if SKIPPED_DIRS.contains(&name.as_str()) {
                continue;
            }
            if let Some(rel) = relative(root, &path) {
                out.push(format!("{rel}/"));
            }
            walk(root, &path, out, depth + 1);
        } else if is_markdown(&name) {
            if let Some(rel) = relative(root, &path) {
                out.push(rel);
            }
        }
    }
}

fn is_markdown(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

fn relative(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
}

/// A path an event landed on can never change the listing if the walk would
/// not have visited it — anything hidden, anything under a skipped directory.
///
/// This is the one place event paths are inspected, and it is deliberately
/// only ever used to discard. Getting it wrong costs a redundant walk, never a
/// missed change. It earns its keep on `.git`, which a single `git status`
/// churns hard enough to wake this thread continuously.
fn worth_walking_for(root: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else {
        // Some backends report the root itself, or a sibling on a rename.
        // Neither is something to filter on.
        return true;
    };
    !rel.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        name.starts_with('.') || SKIPPED_DIRS.contains(&name.as_ref())
    })
}

struct Root {
    path: PathBuf,
    /// The listing last reported. What a fresh walk is compared against.
    listing: Vec<String>,
}

pub struct RootWatcher {
    on_change: Arc<dyn Fn(RootChange) + Send + Sync>,
    active: Mutex<Option<Active>>,
}

struct Active {
    /// Dropping the watchers drops the event senders, which ends the
    /// coalescing thread. Nothing else is needed to stop watching.
    _watchers: Vec<Box<dyn Watcher + Send>>,
    roots: Arc<Mutex<Vec<Root>>>,
}

impl RootWatcher {
    pub fn new(on_change: impl Fn(RootChange) + Send + Sync + 'static) -> Self {
        Self {
            on_change: Arc::new(on_change),
            active: Mutex::new(None),
        }
    }

    /// Watch this set of folders, replacing whatever was being watched.
    ///
    /// Takes the whole set rather than adding one at a time because that is
    /// how the explorer knows it: folders are added and removed from a list,
    /// and reconciling a delta here would be a second place for that list to
    /// be wrong.
    ///
    /// The current listing of each root is read now and treated as already
    /// seen, so starting a watch never reports a change that has not happened.
    pub fn watch(&self, roots: &[PathBuf]) -> Result<()> {
        // Stop first: on Windows a live watch holds a directory handle, and a
        // folder being re-watched must not be watched twice.
        self.stop();
        if roots.is_empty() {
            return Ok(());
        }

        let state: Vec<Root> = roots
            .iter()
            .map(|path| Root {
                path: path.clone(),
                listing: markdown_tree(path),
            })
            .collect();
        let state = Arc::new(Mutex::new(state));

        let (tx, rx) = mpsc::channel();
        let mut watchers = Vec::new();
        for (index, root) in roots.iter().enumerate() {
            // A failed watch costs that folder its liveness, never the
            // explorer: the tree is still walked when the pane opens and by
            // the refresh button. Permission-denied subtrees and vanished
            // folders are ordinary, not exceptional, and one of them must not
            // take the other roots down with it.
            if let Ok(watcher) = watch_root(root.clone(), index, tx.clone()) {
                watchers.push(watcher);
            }
        }
        // Dropping our own sender matters: without it the coalescing thread
        // would never see the channel disconnect and would outlive the watch.
        drop(tx);

        let on_change = Arc::clone(&self.on_change);
        let thread_state = Arc::clone(&state);
        std::thread::spawn(move || {
            coalesce(rx, thread_state, on_change);
        });

        *self.active.lock().unwrap() = Some(Active {
            _watchers: watchers,
            roots: state,
        });
        Ok(())
    }

    pub fn stop(&self) {
        *self.active.lock().unwrap() = None;
    }

    /// The folders currently being watched, in the order they were given.
    pub fn watching(&self) -> Vec<PathBuf> {
        self.active
            .lock()
            .unwrap()
            .as_ref()
            .map(|active| {
                active
                    .roots
                    .lock()
                    .unwrap()
                    .iter()
                    .map(|root| root.path.clone())
                    .collect()
            })
            .unwrap_or_default()
    }
}

fn watch_root(
    root: PathBuf,
    index: usize,
    tx: mpsc::Sender<usize>,
) -> notify::Result<Box<dyn Watcher + Send>> {
    // Recursive: a file created three folders down is exactly the case the
    // explorer misses today.
    let mut watcher = new_watcher(root.clone(), index, tx)?;
    watcher.watch(&root, RecursiveMode::Recursive)?;
    Ok(watcher)
}

fn new_watcher(
    root: PathBuf,
    index: usize,
    tx: mpsc::Sender<usize>,
) -> notify::Result<Box<dyn Watcher + Send>> {
    let handler = {
        let root = root.clone();
        let tx = tx.clone();
        move |event: notify::Result<notify::Event>| {
            if let Ok(event) = event {
                if event.paths.is_empty()
                    || event.paths.iter().any(|path| worth_walking_for(&root, path))
                {
                    let _ = tx.send(index);
                }
            }
        }
    };

    match notify::recommended_watcher(handler) {
        Ok(watcher) => Ok(Box::new(watcher)),
        // Network shares and some Linux filesystems have no usable native
        // backend; polling is slower but never silently misses a change.
        Err(_) => {
            let handler = move |event: notify::Result<notify::Event>| {
                if let Ok(event) = event {
                    if event.paths.is_empty()
                        || event.paths.iter().any(|path| worth_walking_for(&root, path))
                    {
                        let _ = tx.send(index);
                    }
                }
            };
            let config = notify::Config::default().with_poll_interval(POLL_INTERVAL);
            Ok(Box::new(notify::PollWatcher::new(handler, config)?))
        }
    }
}

/// Wait for the roots to go quiet, then re-walk only the ones that stirred.
///
/// Only the roots that saw an event are walked: a workspace can hold a dozen
/// folders, and a file appearing in one says nothing about the others.
fn coalesce(
    rx: mpsc::Receiver<usize>,
    roots: Arc<Mutex<Vec<Root>>>,
    on_change: Arc<dyn Fn(RootChange) + Send + Sync>,
) {
    while let Ok(first) = rx.recv() {
        let mut dirty = vec![first];
        loop {
            match rx.recv_timeout(QUIET_PERIOD) {
                Ok(index) => {
                    if !dirty.contains(&index) {
                        dirty.push(index);
                    }
                }
                Err(RecvTimeoutError::Timeout) => break,
                // The watch was replaced or stopped. Anything still pending
                // belongs to a set of roots nobody is looking at.
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }

        for index in dirty {
            // Walked outside the lock: the walk is the slow part, and holding
            // the roots locked through it would stall `watching()` and every
            // other event thread behind one directory read.
            let Some(path) = roots
                .lock()
                .unwrap()
                .get(index)
                .map(|root| root.path.clone())
            else {
                continue;
            };
            let listing = markdown_tree(&path);

            {
                let mut roots = roots.lock().unwrap();
                let Some(root) = roots.get_mut(index) else {
                    continue;
                };
                // The listing, not the events, is what decides. Essay's own
                // autosave rewrites a file that is already in the tree, so it
                // lands here and stops.
                if root.listing == listing {
                    continue;
                }
                root.listing = listing.clone();
            }

            on_change(RootChange {
                root: path.display().to_string(),
                paths: listing,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    /// Watching is inherently timing-dependent; give the OS room without
    /// making the suite slow.
    fn wait_for_change(rx: &mpsc::Receiver<RootChange>) -> Option<RootChange> {
        rx.recv_timeout(Duration::from_secs(5)).ok()
    }

    fn watched_root() -> (tempfile::TempDir, RootWatcher, mpsc::Receiver<RootChange>) {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("notes.md"), "# Notes\n").expect("seed");

        let (tx, rx) = channel();
        let watcher = RootWatcher::new(move |change| {
            let _ = tx.send(change);
        });
        watcher.watch(&[dir.path().to_path_buf()]).expect("watch");
        (dir, watcher, rx)
    }

    #[test]
    fn lists_markdown_as_root_relative_paths_with_directories_marked() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(dir.path().join("drafts")).expect("mkdir");
        std::fs::write(dir.path().join("drafts/memo.md"), "").expect("write");
        std::fs::write(dir.path().join("notes.md"), "").expect("write");
        std::fs::write(dir.path().join("photo.png"), "").expect("write");

        assert_eq!(
            markdown_tree(dir.path()),
            vec!["drafts/".to_string(), "drafts/memo.md".into(), "notes.md".into()]
        );
    }

    #[test]
    fn leaves_hidden_and_build_directories_out_of_the_listing() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(dir.path().join(".essay")).expect("mkdir");
        std::fs::write(dir.path().join(".essay/scratch.md"), "").expect("write");
        std::fs::create_dir(dir.path().join("node_modules")).expect("mkdir");
        std::fs::write(dir.path().join("node_modules/readme.md"), "").expect("write");
        std::fs::write(dir.path().join("kept.md"), "").expect("write");

        assert_eq!(markdown_tree(dir.path()), vec!["kept.md".to_string()]);
    }

    #[test]
    fn reports_a_file_created_by_something_other_than_essay() {
        let (dir, _watcher, rx) = watched_root();
        std::fs::write(dir.path().join("new-essay.md"), "# New\n").expect("create");

        let change = wait_for_change(&rx).expect("no change reported");
        assert_eq!(change.root, dir.path().display().to_string());
        assert!(change.paths.contains(&"new-essay.md".to_string()));
    }

    #[test]
    fn reports_a_file_created_in_a_subdirectory() {
        let (dir, _watcher, rx) = watched_root();
        std::fs::create_dir(dir.path().join("research")).expect("mkdir");
        std::fs::write(dir.path().join("research/interviews.md"), "").expect("create");

        let change = wait_for_change(&rx).expect("no change reported");
        assert!(change.paths.contains(&"research/".to_string()));
        assert!(change.paths.contains(&"research/interviews.md".to_string()));
    }

    #[test]
    fn reports_a_deletion_by_the_file_leaving_the_listing() {
        let (dir, _watcher, rx) = watched_root();
        std::fs::remove_file(dir.path().join("notes.md")).expect("delete");

        let change = wait_for_change(&rx).expect("no change reported");
        assert!(change.paths.is_empty());
    }

    #[test]
    fn reports_a_rename_as_one_change_carrying_both_sides() {
        let (dir, _watcher, rx) = watched_root();
        std::fs::rename(dir.path().join("notes.md"), dir.path().join("journal.md"))
            .expect("rename");

        let change = wait_for_change(&rx).expect("no change reported");
        assert_eq!(change.paths, vec!["journal.md".to_string()]);
    }

    #[test]
    fn editing_a_file_that_is_already_listed_is_not_a_change() {
        let (dir, _watcher, rx) = watched_root();
        std::fs::write(dir.path().join("notes.md"), "# Rewritten by autosave\n")
            .expect("write");

        assert!(
            rx.recv_timeout(Duration::from_secs(1)).is_err(),
            "reported a content edit as a change to the file listing"
        );
    }

    #[test]
    fn a_file_the_listing_ignores_is_not_a_change() {
        let (dir, _watcher, rx) = watched_root();
        std::fs::write(dir.path().join("cover.png"), "not markdown").expect("write");

        assert!(
            rx.recv_timeout(Duration::from_secs(1)).is_err(),
            "reported a non-Markdown file as a change to the file listing"
        );
    }

    #[test]
    fn a_burst_of_creations_settles_into_one_report() {
        let (dir, _watcher, rx) = watched_root();
        for n in 1..=5 {
            std::fs::write(dir.path().join(format!("chapter-{n}.md")), "").expect("write");
        }

        let change = wait_for_change(&rx).expect("no change reported");
        assert_eq!(change.paths.len(), 6, "expected five new files beside notes.md");
        assert!(
            rx.recv_timeout(Duration::from_secs(1)).is_err(),
            "a burst of creations should read as one change"
        );
    }

    #[test]
    fn watches_every_root_it_is_given_independently() {
        let one = tempfile::tempdir().expect("tempdir");
        let two = tempfile::tempdir().expect("tempdir");
        let (tx, rx) = channel();
        let watcher = RootWatcher::new(move |change| {
            let _ = tx.send(change);
        });
        watcher
            .watch(&[one.path().to_path_buf(), two.path().to_path_buf()])
            .expect("watch");

        std::fs::write(two.path().join("second.md"), "").expect("write");

        let change = wait_for_change(&rx).expect("no change reported");
        assert_eq!(change.root, two.path().display().to_string());
        assert_eq!(change.paths, vec!["second.md".to_string()]);
    }

    #[test]
    fn stopping_ends_the_watch() {
        let (dir, watcher, rx) = watched_root();
        watcher.stop();
        std::fs::write(dir.path().join("after-stopping.md"), "").expect("write");

        assert!(rx.recv_timeout(Duration::from_secs(1)).is_err());
        assert!(watcher.watching().is_empty());
    }

    #[test]
    fn watching_again_replaces_the_previous_set_of_roots() {
        let (first, watcher, rx) = watched_root();
        let second = tempfile::tempdir().expect("tempdir");
        watcher
            .watch(&[second.path().to_path_buf()])
            .expect("re-watch");

        assert_eq!(watcher.watching(), vec![second.path().to_path_buf()]);

        std::fs::write(first.path().join("orphaned.md"), "").expect("write");
        assert!(
            rx.recv_timeout(Duration::from_secs(1)).is_err(),
            "reported a change in a folder that is no longer watched"
        );
    }
}
