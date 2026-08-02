//! Adapters Essay installs for itself, once, instead of fetching every launch.
//!
//! Claude Code speaks ACP through an adapter published to npm, and the obvious
//! way to run it — `npx -y <package>` — asks the npm registry whether that
//! package is current *on every single launch*. The author pays those seconds
//! each time they open the panel, and an adapter already sitting in the npm
//! cache still will not start on a train. Both of those are answers to the same
//! problem: install a pinned copy once, under Essay's own app data directory,
//! and hand the script to `node` thereafter.
//!
//! Nothing here is required. A machine that has never finished an install, or
//! has no `npm` at all, falls back to the launcher exactly as before — the
//! adapter must never become *less* available than it was.

use crate::registry::which;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

/// An ACP adapter published to npm, at the version Essay pins.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Adapter {
    pub package: &'static str,
    pub version: &'static str,
    /// The folder this adapter's installs live under, spelled separately
    /// because a scoped package name is a path with a slash in it.
    pub dir: &'static str,
}

/// The Claude Code ACP adapter.
///
/// The version is pinned, and bumping it is a deliberate act rather than a
/// dependency-bot chore: installs are keyed by version, so a bump means the
/// next launch falls back to `npx` once while the new version installs behind
/// it, and the old tree is pruned only after that install succeeds.
pub const CLAUDE_ADAPTER: Adapter = Adapter {
    package: "@agentclientprotocol/claude-agent-acp",
    version: "0.64.0",
    dir: "claude-agent-acp",
};

/// Written last, after npm has exited happily *and* the entry point is where
/// we expect it. A torn install therefore reads as no install at all rather
/// than as a half of one that launches and then fails.
const MARKER: &str = ".essay-adapter-installed";

/// Our own manifest in the install directory. Without one npm walks upwards
/// looking for a project to install into, and the app data directory is not a
/// place to be guessing about.
const MANIFEST: &str = "{\n  \"name\": \"essay-adapters\",\n  \"private\": true\n}\n";

/// Where Essay keeps the adapters it installed.
///
/// Set once by the desktop shell, which is the only part of Essay that knows
/// about app data directories. The CLI and the tests leave it unset, and that
/// is not a degraded mode — it is precisely the "no local install, use the
/// launcher" case the fallback exists for.
static ADAPTER_ROOT: OnceLock<PathBuf> = OnceLock::new();

pub fn adapter_root() -> Option<&'static Path> {
    ADAPTER_ROOT.get().map(PathBuf::as_path)
}

/// Record where adapters live, and start installing the pinned ones.
///
/// Returns as soon as the thread is spawned. An agent launched while the
/// install is still running uses the launcher, which is what it would have
/// done anyway — the install is an optimisation arriving in the background,
/// never a gate in front of the author pressing a button. The handle is
/// returned for the diagnostics that want to wait for it; the app drops it.
pub fn prepare_adapters(app_data_dir: &Path) -> std::thread::JoinHandle<()> {
    let root = app_data_dir.to_path_buf();
    // A second call means a second window, not a second answer.
    let _ = ADAPTER_ROOT.set(root.clone());
    std::thread::spawn(move || match ensure_installed(&root, &CLAUDE_ADAPTER) {
        Ok(entry) => log::info!(
            "{}@{} ready at {}",
            CLAUDE_ADAPTER.package,
            CLAUDE_ADAPTER.version,
            entry.display()
        ),
        // Not an error the author needs to see: the launcher still works, and
        // the only symptom is the startup cost they had yesterday.
        Err(err) => log::warn!("local adapter install skipped: {err}"),
    })
}

/// `<root>/adapters/<dir>` — every version of one adapter.
pub fn versions_dir(root: &Path, adapter: &Adapter) -> PathBuf {
    root.join("adapters").join(adapter.dir)
}

/// `<root>/adapters/<dir>/<version>` — one install.
pub fn install_dir(root: &Path, adapter: &Adapter) -> PathBuf {
    versions_dir(root, adapter).join(adapter.version)
}

/// The script to hand `node`, if a finished install of the pinned version is
/// sitting there. Both halves are load-bearing: the marker says npm finished,
/// the file says the tree it left behind still contains the thing we are about
/// to run.
pub fn installed_entry(root: &Path, adapter: &Adapter) -> Option<PathBuf> {
    let dir = install_dir(root, adapter);
    if !dir.join(MARKER).is_file() {
        return None;
    }
    entry_point(&dir, adapter)
}

/// Install the pinned adapter unless it is already there. Blocking, and meant
/// for a background thread.
pub fn ensure_installed(root: &Path, adapter: &Adapter) -> Result<PathBuf, InstallError> {
    if let Some(entry) = installed_entry(root, adapter) {
        return Ok(entry);
    }

    let npm = which("npm").ok_or(InstallError::NpmMissing {
        package: adapter.package,
    })?;
    let dir = install_dir(root, adapter);
    fs::create_dir_all(&dir)?;
    fs::write(dir.join("package.json"), MANIFEST)?;

    // Every path stays out of the argument list: npm is told where to install
    // by being run there. On Windows the command goes through `cmd /c`, and a
    // command interpreter re-parsing a quoted path — the app data directory of
    // an author whose account name has a space in it — is a class of bug worth
    // simply not having.
    let spec = format!("{}@{}", adapter.package, adapter.version);
    let output = npm_command(&npm)
        .current_dir(&dir)
        .arg("install")
        .arg(&spec)
        .arg("--no-audit")
        .arg("--no-fund")
        .arg("--loglevel=error")
        .output()?;

    if !output.status.success() {
        return Err(InstallError::Failed {
            spec,
            message: last_words(&output.stderr, &output.stdout),
        });
    }

    let entry =
        entry_point(&dir, adapter).ok_or(InstallError::NoEntryPoint { spec: spec.clone() })?;
    fs::write(dir.join(MARKER), &spec)?;
    prune_other_versions(root, adapter);
    Ok(entry)
}

/// Delete installs of every other version of this adapter.
///
/// Best effort, and deliberately after the new install rather than before: a
/// file locked by a running adapter costs disk, not correctness, and the author
/// would rather have a working agent than an error about housekeeping.
fn prune_other_versions(root: &Path, adapter: &Adapter) {
    let Ok(entries) = fs::read_dir(versions_dir(root, adapter)) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name() == *adapter.version || !entry.path().is_dir() {
            continue;
        }
        if let Err(err) = fs::remove_dir_all(entry.path()) {
            log::warn!(
                "cannot remove old adapter {}: {err}",
                entry.path().display()
            );
        }
    }
}

/// `<install>/node_modules/<package>` — where npm puts the package itself.
fn package_dir(install_dir: &Path, adapter: &Adapter) -> PathBuf {
    let mut dir = install_dir.join("node_modules");
    for part in adapter.package.split('/') {
        dir.push(part);
    }
    dir
}

fn entry_point(install_dir: &Path, adapter: &Adapter) -> Option<PathBuf> {
    let package = package_dir(install_dir, adapter);
    entry_candidates(&package)
        .into_iter()
        .map(|relative| join_posix(&package, &relative))
        .find(|candidate| candidate.is_file())
}

/// Join a path a manifest spelled the npm way — forward slashes, often with a
/// leading `./` — onto a real one. Windows resolves both anyway; a path that
/// reads back cleanly is worth the four lines when it is going into a log line
/// and a command line the author may have to reason about.
fn join_posix(base: &Path, relative: &str) -> PathBuf {
    let mut joined = base.to_path_buf();
    for part in relative
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
    {
        joined.push(part);
    }
    joined
}

/// Where the package says its executable is, in the order worth trusting.
///
/// Read out of the installed `package.json` rather than assumed, so a version
/// bump that moves the file still launches — a hardcoded path that stops
/// matching would not break anything loudly, it would quietly fall back to
/// `npx` forever, which is the failure that is hardest to notice.
fn entry_candidates(package: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(manifest) = fs::read_to_string(package.join("package.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
    {
        match manifest.get("bin") {
            Some(Value::String(path)) => out.push(path.clone()),
            Some(Value::Object(bins)) => {
                out.extend(bins.values().filter_map(Value::as_str).map(str::to_string))
            }
            _ => {}
        }
        if let Some(main) = manifest.get("main").and_then(Value::as_str) {
            out.push(main.to_string());
        }
    }
    // The layout every version of this adapter has shipped so far, as a last
    // resort for a manifest we could not read.
    out.push("dist/index.js".to_string());
    out
}

/// `npm` is a script on Windows — the same `.cmd` shape as `npx`, with the same
/// extensionless sh script sitting beside it — so it needs the interpreter.
fn npm_command(npm: &Path) -> Command {
    #[cfg(windows)]
    if crate::registry::is_script(npm) {
        let mut command = Command::new("cmd");
        command.arg("/c").arg(npm);
        return command;
    }
    Command::new(npm)
}

/// The tail of what npm said, for a log line the reader can act on. npm puts
/// the actual reason on stderr and occasionally only on stdout.
fn last_words(stderr: &[u8], stdout: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let text = if text.trim().is_empty() {
        String::from_utf8_lossy(stdout).into_owned()
    } else {
        text.into_owned()
    };
    let tail: Vec<&str> = text.lines().rev().take(4).collect();
    tail.into_iter().rev().collect::<Vec<_>>().join("; ")
}

#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    #[error("npm is not on PATH, so {package} cannot be installed locally")]
    NpmMissing { package: &'static str },
    #[error("npm install {spec} failed: {message}")]
    Failed { spec: String, message: String },
    #[error("npm install {spec} left no entry point behind")]
    NoEntryPoint { spec: String },
    #[error("cannot prepare the adapter directory: {0}")]
    Io(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAKE: Adapter = Adapter {
        package: "@scope/fake-adapter",
        version: "1.2.3",
        dir: "fake-adapter",
    };

    /// Lay out on disk what a finished `npm install` leaves behind, without
    /// the network: the package under its scope, a manifest naming the binary,
    /// and the file that binary points at.
    fn lay_out_install(root: &Path, adapter: &Adapter, manifest: &str, entry: &str) -> PathBuf {
        let package = package_dir(&install_dir(root, adapter), adapter);
        fs::create_dir_all(package.join(entry).parent().unwrap()).unwrap();
        fs::write(package.join("package.json"), manifest).unwrap();
        fs::write(package.join(entry), "// adapter").unwrap();
        package
    }

    fn mark_complete(root: &Path, adapter: &Adapter) {
        fs::write(install_dir(root, adapter).join(MARKER), "done").unwrap();
    }

    #[test]
    fn a_finished_install_offers_the_script_its_manifest_names() {
        let root = tempfile::tempdir().unwrap();
        lay_out_install(
            root.path(),
            &FAKE,
            r#"{"bin":{"fake-adapter":"dist/index.js"}}"#,
            "dist/index.js",
        );
        mark_complete(root.path(), &FAKE);

        let entry = installed_entry(root.path(), &FAKE).expect("the install is finished");
        assert!(entry.ends_with("dist/index.js"));
    }

    #[test]
    fn an_install_that_never_finished_is_not_an_install() {
        let root = tempfile::tempdir().unwrap();
        // Everything is on disk except the marker: npm was interrupted, or the
        // machine lost power halfway through unpacking.
        lay_out_install(
            root.path(),
            &FAKE,
            r#"{"bin":{"fake-adapter":"dist/index.js"}}"#,
            "dist/index.js",
        );
        assert!(installed_entry(root.path(), &FAKE).is_none());
    }

    #[test]
    fn a_marker_without_the_files_it_promises_is_not_an_install() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(install_dir(root.path(), &FAKE)).unwrap();
        mark_complete(root.path(), &FAKE);
        assert!(installed_entry(root.path(), &FAKE).is_none());
    }

    #[test]
    fn an_install_of_another_version_does_not_answer_for_the_pinned_one() {
        let root = tempfile::tempdir().unwrap();
        let stale = Adapter {
            version: "1.0.0",
            ..FAKE
        };
        lay_out_install(
            root.path(),
            &stale,
            r#"{"bin":{"fake-adapter":"dist/index.js"}}"#,
            "dist/index.js",
        );
        mark_complete(root.path(), &stale);

        assert!(installed_entry(root.path(), &FAKE).is_none());
        assert!(installed_entry(root.path(), &stale).is_some());
    }

    /// The reason the entry point is read rather than hardcoded: a package that
    /// moves its output still launches.
    #[test]
    fn the_entry_point_follows_the_manifest_rather_than_a_guess() {
        let root = tempfile::tempdir().unwrap();
        lay_out_install(
            root.path(),
            &FAKE,
            r#"{"bin":{"fake-adapter":"build/cli.mjs"}}"#,
            "build/cli.mjs",
        );
        mark_complete(root.path(), &FAKE);

        let entry = installed_entry(root.path(), &FAKE).expect("the install is finished");
        assert!(entry.ends_with("build/cli.mjs"));
    }

    /// npm allows `bin` to be one string rather than a map, and manifests
    /// habitually spell the path `./like/this`.
    #[test]
    fn a_single_string_bin_and_a_relative_prefix_are_both_understood() {
        let root = tempfile::tempdir().unwrap();
        lay_out_install(
            root.path(),
            &FAKE,
            r#"{"bin":"./dist/index.js"}"#,
            "dist/index.js",
        );
        mark_complete(root.path(), &FAKE);

        let entry = installed_entry(root.path(), &FAKE).expect("the install is finished");
        assert!(entry.ends_with("dist/index.js"));
        assert!(
            !entry.to_string_lossy().contains("/."),
            "the path a log line shows should read like a path"
        );
    }

    #[test]
    fn pruning_keeps_the_pinned_version_and_removes_the_rest() {
        let root = tempfile::tempdir().unwrap();
        for version in ["1.0.0", "1.1.0", FAKE.version] {
            fs::create_dir_all(versions_dir(root.path(), &FAKE).join(version)).unwrap();
        }
        prune_other_versions(root.path(), &FAKE);

        assert!(install_dir(root.path(), &FAKE).is_dir());
        assert!(!versions_dir(root.path(), &FAKE).join("1.0.0").exists());
        assert!(!versions_dir(root.path(), &FAKE).join("1.1.0").exists());
    }

    #[test]
    fn the_pinned_claude_adapter_installs_under_its_own_version() {
        let root = Path::new("/app-data");
        assert!(install_dir(root, &CLAUDE_ADAPTER).ends_with(CLAUDE_ADAPTER.version));
        assert!(versions_dir(root, &CLAUDE_ADAPTER).ends_with("claude-agent-acp"));
    }
}
