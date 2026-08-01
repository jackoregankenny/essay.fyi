//! Watching the open document for edits that did not come from the editor.
//!
//! This is the universal agent fallback: it does not care *what* changed the
//! file — Claude Code, a `git checkout`, `sed`, another editor — only that the
//! bytes on disk stopped matching what Essay last accepted. Everything is
//! decided by content hash rather than by counting events, because agents
//! write in multi-hunk bursts and some tools rewrite a file several times in
//! a row.

use crate::file::hash_source;
use crate::Result;
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// How long the file has to stay still before we read it. Long enough to let
/// a burst of writes land, short enough that the author sees the change
/// arrive rather than wondering.
const QUIET_PERIOD: Duration = Duration::from_millis(200);

/// Fallback cadence when the platform's native backend is unavailable.
const POLL_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalChange {
    pub path: String,
    pub hash: String,
    pub contents: String,
}

struct Target {
    path: PathBuf,
    /// The content Essay believes is on disk. Advanced by `expect` just
    /// before Essay writes, so the app never reports its own saves back to
    /// itself.
    known_hash: String,
}

pub struct DocumentWatcher {
    on_change: Arc<dyn Fn(ExternalChange) + Send + Sync>,
    active: Mutex<Option<Active>>,
}

struct Active {
    /// Dropping the watcher drops the event sender, which ends the
    /// coalescing thread. Nothing else is needed to stop watching.
    _watcher: Box<dyn Watcher + Send>,
    target: Arc<Mutex<Target>>,
}

impl DocumentWatcher {
    pub fn new(on_change: impl Fn(ExternalChange) + Send + Sync + 'static) -> Self {
        Self {
            on_change: Arc::new(on_change),
            active: Mutex::new(None),
        }
    }

    /// Watch `path`, treating `known_hash` as the content already seen.
    /// Replaces any previous watch — one document is open at a time.
    pub fn watch(&self, path: &Path, known_hash: String) -> Result<()> {
        let Some(dir) = path.parent() else {
            return Ok(());
        };

        let target = Arc::new(Mutex::new(Target {
            path: path.to_path_buf(),
            known_hash,
        }));

        let (tx, rx) = mpsc::channel();
        let mut watcher = new_watcher(tx)?;
        // The directory, not the file: an editor or agent that replaces the
        // file rather than writing through it would otherwise take the watch
        // with it.
        watcher.watch(dir, RecursiveMode::NonRecursive)?;

        let on_change = Arc::clone(&self.on_change);
        let thread_target = Arc::clone(&target);
        std::thread::spawn(move || {
            coalesce(rx, thread_target, on_change);
        });

        *self.active.lock().unwrap() = Some(Active {
            _watcher: watcher,
            target,
        });
        Ok(())
    }

    /// Declare content Essay is about to write. Call before the write, not
    /// after: the watcher can observe the file the instant it lands.
    pub fn expect(&self, hash: String) {
        if let Some(active) = self.active.lock().unwrap().as_ref() {
            active.target.lock().unwrap().known_hash = hash;
        }
    }

    pub fn stop(&self) {
        *self.active.lock().unwrap() = None;
    }

    /// The path currently being watched, if any.
    pub fn watching(&self) -> Option<PathBuf> {
        self.active
            .lock()
            .unwrap()
            .as_ref()
            .map(|active| active.target.lock().unwrap().path.clone())
    }
}

fn new_watcher(tx: mpsc::Sender<()>) -> Result<Box<dyn Watcher + Send>> {
    // The event itself carries nothing we trust — only the fact that
    // *something* happened in the directory. Content decides the rest.
    let notify_tx = tx.clone();
    let handler = move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
            let _ = notify_tx.send(());
        }
    };

    match notify::recommended_watcher(handler) {
        Ok(watcher) => Ok(Box::new(watcher)),
        // Network shares and some Linux filesystems have no usable native
        // backend; polling is slower but never silently misses a change.
        Err(_) => {
            let handler = move |event: notify::Result<notify::Event>| {
                if event.is_ok() {
                    let _ = tx.send(());
                }
            };
            let config = notify::Config::default().with_poll_interval(POLL_INTERVAL);
            Ok(Box::new(notify::PollWatcher::new(handler, config)?))
        }
    }
}

/// Wait for the directory to go quiet, then decide by content hash.
///
/// Every event in the directory wakes this loop, including Essay's own
/// temporary write file. That is deliberate: filtering by event path is
/// where watchers get subtle and wrong, and re-reading one small file is
/// cheaper than being clever about it.
fn coalesce(
    rx: mpsc::Receiver<()>,
    target: Arc<Mutex<Target>>,
    on_change: Arc<dyn Fn(ExternalChange) + Send + Sync>,
) {
    while rx.recv().is_ok() {
        loop {
            match rx.recv_timeout(QUIET_PERIOD) {
                Ok(()) => continue,
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }

        let path = target.lock().unwrap().path.clone();

        // A file we cannot read right now — deleted, or briefly locked mid
        // rename — is not a change we can describe. The buffer in the editor
        // is untouched and journalled; the next event settles it.
        let Ok(contents) = std::fs::read_to_string(&path) else {
            continue;
        };
        let hash = hash_source(&contents);

        {
            let mut target = target.lock().unwrap();
            if target.known_hash == hash {
                continue;
            }
            target.known_hash = hash.clone();
        }

        on_change(ExternalChange {
            path: path.display().to_string(),
            hash,
            contents,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    /// Watching is inherently timing-dependent; give the OS room without
    /// making the suite slow.
    fn wait_for_change(rx: &mpsc::Receiver<ExternalChange>) -> Option<ExternalChange> {
        rx.recv_timeout(Duration::from_secs(5)).ok()
    }

    fn watched_doc(contents: &str) -> (tempfile::TempDir, PathBuf, DocumentWatcher, mpsc::Receiver<ExternalChange>) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("essay.md");
        std::fs::write(&path, contents).expect("seed");

        let (tx, rx) = channel();
        let watcher = DocumentWatcher::new(move |change| {
            let _ = tx.send(change);
        });
        watcher
            .watch(&path, hash_source(contents))
            .expect("watch");
        (dir, path, watcher, rx)
    }

    #[test]
    fn reports_an_edit_made_by_something_other_than_essay() {
        let (_dir, path, _watcher, rx) = watched_doc("# One\n");
        std::fs::write(&path, "# Rewritten by an agent\n").expect("external edit");

        let change = wait_for_change(&rx).expect("no change reported");
        assert_eq!(change.contents, "# Rewritten by an agent\n");
        assert_eq!(change.hash, hash_source("# Rewritten by an agent\n"));
    }

    #[test]
    fn stays_quiet_for_a_write_essay_announced() {
        let (_dir, path, watcher, rx) = watched_doc("# One\n");

        watcher.expect(hash_source("# Saved by Essay\n"));
        std::fs::write(&path, "# Saved by Essay\n").expect("our own save");

        assert!(
            rx.recv_timeout(Duration::from_millis(800)).is_err(),
            "reported Essay's own save as an external change"
        );
    }

    #[test]
    fn a_touch_that_changes_nothing_is_not_a_change() {
        let (_dir, path, _watcher, rx) = watched_doc("# One\n");
        std::fs::write(&path, "# One\n").expect("rewrite identical content");

        assert!(
            rx.recv_timeout(Duration::from_millis(800)).is_err(),
            "reported a rewrite with identical content"
        );
    }

    #[test]
    fn a_burst_of_writes_settles_into_one_report() {
        let (_dir, path, _watcher, rx) = watched_doc("# One\n");
        for hunk in 1..=5 {
            std::fs::write(&path, format!("# Hunk {hunk}\n")).expect("write");
        }

        let change = wait_for_change(&rx).expect("no change reported");
        assert_eq!(change.contents, "# Hunk 5\n");
        assert!(
            rx.recv_timeout(Duration::from_millis(800)).is_err(),
            "a multi-hunk agent write should read as one change"
        );
    }

    #[test]
    fn stopping_ends_the_watch() {
        let (_dir, path, watcher, rx) = watched_doc("# One\n");
        watcher.stop();
        std::fs::write(&path, "# After stopping\n").expect("write");

        assert!(rx.recv_timeout(Duration::from_millis(800)).is_err());
        assert!(watcher.watching().is_none());
    }
}
