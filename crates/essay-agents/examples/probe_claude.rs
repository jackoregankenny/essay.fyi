//! Probe: launch the Claude Code ACP adapter exactly the way the app does,
//! and print every event. Diagnostic, not a test — run with
//! `cargo run -p essay-agents --example probe_claude`.

use essay_agents::{AgentEvent, AgentHost, ChangeSet, HostObserver, PermissionRequest};
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
    let session = match host.start_session(&agent_id, &path).await {
        Ok(session) => {
            eprintln!(
                "STARTED: session={} acp={}",
                session.session_id, session.acp_session_id
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
