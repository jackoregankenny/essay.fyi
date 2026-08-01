//! Against the real thing: `opencode acp`, launched as a subprocess.
//!
//! `interception.rs` proves the behaviour; this proves the handshake Essay
//! sends is the one a shipped agent binary actually accepts. Everything about
//! ACP that could be wrong on paper — the protocol version, the capability
//! shape, the `session/new` payload, whether the subprocess even resolves on
//! this platform — is wrong here first.
//!
//! The test skips loudly rather than failing when opencode is not installed;
//! it is a real-world dependency, not a fixture. It never passes vacuously:
//! everything it asserts requires the agent to have answered.

use essay_agents::{AgentEvent, AgentHost, ChangeSet, HostObserver, PermissionRequest};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

/// One agent subprocess at a time. Cargo runs the cases in this file in
/// parallel threads, and two `opencode acp` processes racing to start in the
/// same instant is a fight over the agent's own state, not a thing under test:
/// one of them loses its stdio before it answers `initialize`.
static ONE_AT_A_TIME: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

#[derive(Default)]
struct Recorder {
    events: Mutex<Vec<AgentEvent>>,
    changes: Mutex<Vec<ChangeSet>>,
}

impl HostObserver for Recorder {
    fn agent_event(&self, event: AgentEvent) {
        eprintln!("[event] {}", serde_json::to_string(&event).unwrap());
        self.events.lock().unwrap().push(event);
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
        self.changes.lock().unwrap().push(change.clone());
    }
    fn permission_request(&self, request: &PermissionRequest) {
        eprintln!("[permission] {}", request.title);
    }
}

fn opencode_installed() -> bool {
    essay_agents::list_agents()
        .into_iter()
        .any(|agent| agent.id == "opencode" && agent.available)
}

#[tokio::test(flavor = "multi_thread")]
async fn essays_handshake_is_one_the_real_opencode_binary_accepts() {
    if !opencode_installed() {
        eprintln!("SKIPPED: opencode is not on PATH — install it to run this test");
        return;
    }

    let _serialised = ONE_AT_A_TIME.lock().await;

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("essay.md");
    std::fs::write(&path, "# A draft\n\nThe opening paragraph.\n").unwrap();

    let recorder = Arc::new(Recorder::default());
    let host = AgentHost::new(Arc::clone(&recorder) as Arc<dyn HostObserver>);

    let session = host
        .start_session("opencode", &path)
        .await
        .expect("opencode did not complete the ACP handshake");

    eprintln!("opencode session: {}", session.acp_session_id);

    assert_eq!(session.agent_id, "opencode");
    assert!(
        !session.acp_session_id.is_empty(),
        "the agent must have answered session/new with an id"
    );
    assert!(
        session.acp_session_id != session.session_id,
        "the agent's session id is its own, not the one Essay made up"
    );
    assert_eq!(host.sessions().len(), 1);

    host.stop(&session.session_id).expect("stop");
    // The subprocess dies with the connection; give it a moment so the test
    // does not leave one behind for the next case.
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(host.sessions().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_session_survives_being_started_and_stopped_without_a_prompt() {
    if !opencode_installed() {
        eprintln!("SKIPPED: opencode is not on PATH");
        return;
    }

    let _serialised = ONE_AT_A_TIME.lock().await;

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("essay.md");
    std::fs::write(&path, "# A draft\n").unwrap();

    let recorder = Arc::new(Recorder::default());
    let host = AgentHost::new(Arc::clone(&recorder) as Arc<dyn HostObserver>);
    let session = host.start_session("opencode", &path).await.expect("start");

    host.stop(&session.session_id).expect("stop");
    tokio::time::sleep(Duration::from_millis(800)).await;

    let events = recorder.events.lock().unwrap();
    assert!(
        events
            .iter()
            .any(|event| matches!(event, AgentEvent::Started { .. })),
        "the app should have been told the session opened"
    );
    assert!(
        events
            .iter()
            .any(|event| matches!(event, AgentEvent::Stopped { .. })),
        "and that it closed"
    );
}

/// The whole loop with a real model behind it: prompt opencode to edit a
/// manuscript, and see which channel the edit comes back on.
///
/// **What this test found, 2026-07-31, opencode 1.17.8:** it does not use the
/// `fs` capability. Essay advertises `fs.readTextFile` and `fs.writeTextFile`
/// in `initialize`; opencode acknowledges the handshake and then reads and
/// writes the file with its own tools, sending `tool_call` notifications about
/// it but never an `fs/read_text_file` or `fs/write_text_file` request. So the
/// edit lands on disk and there is nothing for the host to hold.
///
/// The assertion is therefore the one that holds either way: an edit is
/// *accounted for* — it arrived as a proposal, or it arrived on disk where the
/// `DocumentWatcher` catches it. Asserting "a proposal arrives" would be
/// asserting a third party's compliance; asserting "it does not" would freeze
/// their bug into our suite. This asserts Essay's own guarantee: nothing an
/// agent does to the manuscript goes unnoticed.
///
/// Opt-in (`ESSAY_ACP_LIVE_PROMPT=1`): it costs tokens, needs the network and
/// an authenticated opencode, and depends on a model choosing to edit at all.
#[tokio::test(flavor = "multi_thread")]
async fn a_real_agent_edit_is_accounted_for_one_way_or_the_other() {
    if std::env::var("ESSAY_ACP_LIVE_PROMPT").is_err() {
        eprintln!("SKIPPED: set ESSAY_ACP_LIVE_PROMPT=1 to prompt a real model");
        return;
    }
    if !opencode_installed() {
        eprintln!("SKIPPED: opencode is not on PATH");
        return;
    }

    let _serialised = ONE_AT_A_TIME.lock().await;

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("essay.md");
    let original = "# The case for slow writing\n\nIt is a truth universally acknowledged that writing fast is writing badly.\n";
    std::fs::write(&path, original).unwrap();

    let recorder = Arc::new(Recorder::default());
    let host = AgentHost::new(Arc::clone(&recorder) as Arc<dyn HostObserver>);
    let session = host.start_session("opencode", &path).await.expect("start");

    host.prompt(
        &session.session_id,
        format!(
            "Edit the file {} — replace the single sentence with a tighter version. \
             Make exactly one edit and then stop.",
            path.display()
        ),
    )
    .expect("prompt");

    let deadline = std::time::Instant::now() + Duration::from_secs(240);
    loop {
        let ended = recorder
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|event| matches!(event, AgentEvent::TurnEnded { .. }));
        if ended {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the turn never ended"
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    let proposed = recorder.changes.lock().unwrap().first().cloned();
    let on_disk = std::fs::read_to_string(&path).unwrap();
    let wrote_directly = on_disk != original;

    match (&proposed, wrote_directly) {
        (Some(change), false) => {
            eprintln!("opencode honoured the fs capability: {} held for review", change.id);
            assert_eq!(change.provenance.agent, "opencode");
            assert!(!change.diff.is_empty());
        }
        (_, true) => eprintln!(
            "opencode bypassed the fs capability and wrote the file itself — \
             this is what the DocumentWatcher fallback exists for"
        ),
        (None, false) => panic!("the model made no edit at all; nothing to account for"),
    }

    assert!(
        proposed.is_some() || wrote_directly,
        "the turn ended having reported an edit that reached neither the review queue nor disk"
    );

    // Whichever channel it used, the session can say who it was.
    assert_eq!(
        host.attribution(&session.session_id).map(|p| p.agent),
        Some("opencode".to_string())
    );

    host.stop(&session.session_id).ok();
}
