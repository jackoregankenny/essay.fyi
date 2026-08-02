//! Probe: launch the Claude Code ACP adapter exactly the way the app does,
//! and print every event. Diagnostic, not a test — run with
//! `cargo run -p essay-agents --example probe_claude`.
//!
//! It also answers the startup-cost question: set `ESSAY_ADAPTER_ROOT` (or let
//! it default to the app data directory the shell uses) and the probe prepares
//! the pinned local install first, so the handshake it times is the one the
//! app will do. `ESSAY_NO_LOCAL_ADAPTER=1` skips that, timing the `npx -y`
//! path instead — the two numbers side by side are the whole argument.

use essay_agents::{AgentEvent, AgentHost, ChangeSet, HostObserver, PermissionRequest};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Default)]
struct Printer {
    turn_ended: AtomicBool,
    proposals: AtomicBool,
}

impl HostObserver for Printer {
    fn agent_event(&self, event: AgentEvent) {
        eprintln!("[event] {}", serde_json::to_string(&event).unwrap());
        if matches!(event, AgentEvent::TurnEnded { .. }) {
            self.turn_ended.store(true, Ordering::SeqCst);
        }
    }
    fn change_set(&self, change: &ChangeSet) {
        eprintln!(
            "[change] {} on {} — {} hunk(s), churn {:.2}, rewrite={}",
            change.id,
            change.file,
            change.diff.hunks.len(),
            change.diff.churn,
            change.looks_like_a_rewrite
        );
        self.proposals.store(true, Ordering::SeqCst);
    }
    fn permission_request(&self, request: &PermissionRequest) {
        eprintln!("[permission] {}", request.title);
    }
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("debug")).init();

    // The app data directory the desktop shell would hand over. Doing it here
    // too is what makes this probe a probe of the app's behaviour rather than
    // of a configuration only the probe has.
    if std::env::var("ESSAY_NO_LOCAL_ADAPTER").is_err() {
        if let Some(root) = adapter_root() {
            eprintln!("preparing adapters under {}", root.display());
            let started = std::time::Instant::now();
            essay_agents::prepare_adapters(&root).join().ok();
            eprintln!("adapters ready in {:.2}s", started.elapsed().as_secs_f64());
        }
    }

    for agent in essay_agents::list_agents() {
        eprintln!(
            "agent {}: available={} ({})",
            agent.id, agent.available, agent.command
        );
    }

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("essay.md");
    let original = "# The case for slow writing\n\nIt is a truth universally acknowledged that writing fast is writing badly.\n";
    std::fs::write(&path, original).unwrap();

    let agent_id = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "claude-code".to_string());
    let printer = Arc::new(Printer::default());
    let host = AgentHost::new(Arc::clone(&printer) as Arc<dyn HostObserver>);
    let started = std::time::Instant::now();
    let session = match host.start_session(&agent_id, &path).await {
        Ok(session) => {
            eprintln!(
                "STARTED in {:.2}s: session={} acp={}",
                started.elapsed().as_secs_f64(),
                session.session_id,
                session.acp_session_id
            );
            session
        }
        Err(err) => {
            eprintln!("FAILED: {err}");
            return;
        }
    };

    // The question CLAUDE.md leaves open: does the Claude Code adapter honour
    // the client `fs` capability (edits arrive as proposals) or write the file
    // itself like opencode does (edits arrive via the watcher)?
    if std::env::var("ESSAY_ACP_LIVE_PROMPT").is_ok() {
        host.prompt(
            &session.session_id,
            format!(
                "Edit the file {} — replace the single sentence with a tighter \
                 version. Make exactly one edit and then stop.",
                path.display()
            ),
        )
        .expect("prompt");

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(240);
        while !printer.turn_ended.load(Ordering::SeqCst) {
            if std::time::Instant::now() > deadline {
                eprintln!("VERDICT: the turn never ended");
                host.stop(&session.session_id).ok();
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }

        let on_disk = std::fs::read_to_string(&path).unwrap();
        let intercepted = printer.proposals.load(Ordering::SeqCst);
        eprintln!(
            "VERDICT: proposal_intercepted={} file_changed_on_disk={}",
            intercepted,
            on_disk != original
        );
        eprintln!("ON DISK NOW:\n{on_disk}");
    }

    host.stop(&session.session_id).ok();
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
}

/// Where the desktop shell keeps adapters, worked out without Tauri — the
/// crate stays free of it, and this is a diagnostic, so the bundle identifier
/// is spelled here rather than plumbed through.
fn adapter_root() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("ESSAY_ADAPTER_ROOT") {
        return Some(PathBuf::from(explicit));
    }
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
    });
    #[cfg(all(unix, not(target_os = "macos")))]
    let base = std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"));
    base.map(|base| base.join("fyi.essay.app"))
}
