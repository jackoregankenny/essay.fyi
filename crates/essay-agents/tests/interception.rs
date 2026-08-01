//! End-to-end: an agent asks Essay to write the manuscript, and Essay does not.
//!
//! The agent here is in-process rather than a subprocess, connected over an
//! ACP channel instead of stdio. Everything above the transport is the real
//! thing: the real handshake, the real `fs/*` handlers, the real change-set
//! store. The point is to pin the behaviour that defines the feature —
//! *proposal, not write* — deterministically, without a model in the loop.
//!
//! `opencode.rs` covers the other half: that this handshake is the one a real
//! agent binary actually speaks.

use agent_client_protocol::schema::v1::{
    AgentCapabilities, ContentBlock, ContentChunk, InitializeRequest, InitializeResponse,
    NewSessionRequest, NewSessionResponse, PromptRequest, PromptResponse, ReadTextFileRequest,
    SessionNotification, SessionUpdate, StopReason, TextContent, ToolCall, WriteTextFileRequest,
};
use agent_client_protocol::{Agent, Channel, Client};
use essay_agents::{
    AcceptOutcome, AgentEvent, AgentHost, ChangeSet, ChangeStatus, HostObserver, PermissionRequest,
};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Collects what the app would have shown the author.
#[derive(Default)]
struct Recorder {
    events: Mutex<Vec<AgentEvent>>,
    changes: Mutex<Vec<ChangeSet>>,
    permissions: Mutex<Vec<PermissionRequest>>,
}

impl HostObserver for Recorder {
    fn agent_event(&self, event: AgentEvent) {
        self.events.lock().unwrap().push(event);
    }
    fn change_set(&self, change: &ChangeSet) {
        self.changes.lock().unwrap().push(change.clone());
    }
    fn permission_request(&self, request: &PermissionRequest) {
        self.permissions.lock().unwrap().push(request.clone());
    }
}

impl Recorder {
    async fn wait_for_change(&self) -> ChangeSet {
        for _ in 0..200 {
            if let Some(change) = self.changes.lock().unwrap().first().cloned() {
                return change;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("no change set arrived");
    }

    async fn wait_for_turn_end(&self) {
        for _ in 0..200 {
            let ended = self
                .events
                .lock()
                .unwrap()
                .iter()
                .any(|event| matches!(event, AgentEvent::TurnEnded { .. }));
            if ended {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("the turn never ended");
    }
}

/// What the fake agent does when prompted.
#[derive(Clone)]
enum Behaviour {
    /// Announce a tool call, then ask the client to write `content`.
    Write { path: String, content: String },
    /// Ask the client to read `path` and report what came back.
    Read { path: String },
}

/// Spawn an agent that speaks real ACP over an in-process channel.
fn fake_agent(behaviour: Behaviour, echo: Arc<Mutex<Option<String>>>) -> Channel {
    let (ours, theirs) = Channel::duplex();

    tokio::spawn(async move {
        let session_id = "fake-session-1";
        let result = Agent
            .builder()
            .name("fake-agent")
            .on_receive_request(
                async move |request: InitializeRequest, responder, _cx| {
                    responder.respond(
                        InitializeResponse::new(request.protocol_version)
                            .agent_capabilities(AgentCapabilities::new()),
                    )
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |_request: NewSessionRequest, responder, _cx| {
                    responder.respond(NewSessionResponse::new(session_id))
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                {
                    async move |_request: PromptRequest, responder, cx| {
                        let behaviour = behaviour.clone();
                        let echo = Arc::clone(&echo);
                        let connection = cx.clone();
                        // Off the dispatch loop: this turn waits on responses
                        // from the client, which the dispatch loop must stay
                        // free to deliver.
                        cx.spawn(async move {
                            match behaviour {
                                Behaviour::Write { path, content } => {
                                    connection.send_notification_to(
                                        Client,
                                        SessionNotification::new(
                                            session_id,
                                            SessionUpdate::ToolCall(ToolCall::new(
                                                "call_write_1",
                                                "Edit the manuscript",
                                            )),
                                        ),
                                    )?;
                                    connection.send_notification_to(
                                        Client,
                                        SessionNotification::new(
                                            session_id,
                                            SessionUpdate::AgentMessageChunk(ContentChunk::new(
                                                ContentBlock::Text(TextContent::new(
                                                    "Tightening that section.",
                                                )),
                                            )),
                                        ),
                                    )?;
                                    connection
                                        .send_request_to(
                                            Client,
                                            WriteTextFileRequest::new(session_id, path, content),
                                        )
                                        .block_task()
                                        .await?;
                                }
                                Behaviour::Read { path } => {
                                    let response = connection
                                        .send_request_to(
                                            Client,
                                            ReadTextFileRequest::new(session_id, path),
                                        )
                                        .block_task()
                                        .await?;
                                    *echo.lock().unwrap() = Some(response.content);
                                }
                            }
                            responder.respond(PromptResponse::new(StopReason::EndTurn))
                        })
                    }
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_to(theirs)
            .await;
        if let Err(err) = result {
            eprintln!("fake agent ended: {err}");
        }
    });

    ours
}

async fn start(host: &AgentHost, document: &Path, transport: Channel) -> String {
    host.start_session_over("fake", "fake-agent", document, transport)
        .await
        .expect("session")
        .session_id
}

#[tokio::test(flavor = "multi_thread")]
async fn a_write_becomes_a_pending_change_set_not_a_write() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("essay.md");
    std::fs::write(&path, "# Draft\n\nAlpha.\n").unwrap();

    let recorder = Arc::new(Recorder::default());
    let host = AgentHost::new(Arc::clone(&recorder) as Arc<dyn HostObserver>);
    let transport = fake_agent(
        Behaviour::Write {
            path: path.display().to_string(),
            content: "# Draft\n\nAlpha, tightened.\n".into(),
        },
        Arc::new(Mutex::new(None)),
    );

    let session = start(&host, &path, transport).await;
    host.prompt(&session, "tighten the opening".into()).unwrap();

    let change = recorder.wait_for_change().await;

    assert_eq!(change.status, ChangeStatus::Pending);
    assert_eq!(change.proposed_contents, "# Draft\n\nAlpha, tightened.\n");
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "# Draft\n\nAlpha.\n",
        "the manuscript must be untouched until the author accepts"
    );
    assert!(!change.diff.is_empty());
    assert_eq!(host.changes().list().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_proposal_carries_the_instruction_and_the_tool_call_that_produced_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("essay.md");
    std::fs::write(&path, "# Draft\n").unwrap();

    let recorder = Arc::new(Recorder::default());
    let host = AgentHost::new(Arc::clone(&recorder) as Arc<dyn HostObserver>);
    let transport = fake_agent(
        Behaviour::Write {
            path: path.display().to_string(),
            content: "# Rewritten\n".into(),
        },
        Arc::new(Mutex::new(None)),
    );

    let session = start(&host, &path, transport).await;
    host.prompt(&session, "make the title sharper".into())
        .unwrap();

    let change = recorder.wait_for_change().await;

    assert_eq!(change.provenance.agent, "fake-agent");
    assert_eq!(change.provenance.session_id, session);
    assert_eq!(change.provenance.prompt_excerpt, "make the title sharper");
    assert_eq!(
        change.provenance.tool_call_id.as_deref(),
        Some("call_write_1"),
        "the write should be attributed to the tool call announced just before it"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_agent_reads_back_the_edit_it_believes_it_made() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("essay.md");
    std::fs::write(&path, "# On disk\n").unwrap();

    let recorder = Arc::new(Recorder::default());
    let host = AgentHost::new(Arc::clone(&recorder) as Arc<dyn HostObserver>);

    // Seed a pending proposal, as an earlier turn would have.
    host.changes()
        .propose(
            &path,
            "# On disk\n",
            "# What the agent wrote\n".into(),
            essay_agents::provenance("fake-agent", "earlier", None, "an earlier turn"),
        )
        .expect("a proposal");

    let echo = Arc::new(Mutex::new(None));
    let transport = fake_agent(
        Behaviour::Read {
            path: path.display().to_string(),
        },
        Arc::clone(&echo),
    );

    let session = start(&host, &path, transport).await;
    host.prompt(&session, "check the title".into()).unwrap();
    recorder.wait_for_turn_end().await;

    assert_eq!(
        echo.lock().unwrap().as_deref(),
        Some("# What the agent wrote\n"),
        "reading back the untouched file would read to the agent as its edit being reverted"
    );
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "# On disk\n",
        "and the author's file is still the author's file"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_read_with_nothing_pending_serves_the_real_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("essay.md");
    std::fs::write(&path, "# The truth\n").unwrap();

    let recorder = Arc::new(Recorder::default());
    let host = AgentHost::new(Arc::clone(&recorder) as Arc<dyn HostObserver>);
    let echo = Arc::new(Mutex::new(None));
    let transport = fake_agent(
        Behaviour::Read {
            path: path.display().to_string(),
        },
        Arc::clone(&echo),
    );

    let session = start(&host, &path, transport).await;
    host.prompt(&session, "read it".into()).unwrap();
    recorder.wait_for_turn_end().await;

    assert_eq!(echo.lock().unwrap().as_deref(), Some("# The truth\n"));
}

#[tokio::test(flavor = "multi_thread")]
async fn accepting_a_proposal_is_the_only_thing_that_reaches_disk() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("essay.md");
    std::fs::write(&path, "# Draft\n").unwrap();

    let recorder = Arc::new(Recorder::default());
    let host = AgentHost::new(Arc::clone(&recorder) as Arc<dyn HostObserver>);
    let transport = fake_agent(
        Behaviour::Write {
            path: path.display().to_string(),
            content: "# Accepted\n".into(),
        },
        Arc::new(Mutex::new(None)),
    );

    let session = start(&host, &path, transport).await;
    host.prompt(&session, "sharpen it".into()).unwrap();
    let change = recorder.wait_for_change().await;

    let mut announced = None;
    let outcome = host
        .changes()
        .accept(&change.id, "fake-agent", |hash| {
            announced = Some(hash.to_string())
        })
        .expect("accept");

    assert!(matches!(outcome, AcceptOutcome::Written { .. }));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "# Accepted\n");
    assert!(
        announced.is_some(),
        "the watcher must be told before Essay writes, or it reports our own save as an intrusion"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_session_transcript_reaches_the_app_in_order() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("essay.md");
    std::fs::write(&path, "# Draft\n").unwrap();

    let recorder = Arc::new(Recorder::default());
    let host = AgentHost::new(Arc::clone(&recorder) as Arc<dyn HostObserver>);
    let transport = fake_agent(
        Behaviour::Write {
            path: path.display().to_string(),
            content: "# Edited\n".into(),
        },
        Arc::new(Mutex::new(None)),
    );

    let session = start(&host, &path, transport).await;
    host.prompt(&session, "go".into()).unwrap();
    recorder.wait_for_turn_end().await;

    let events = recorder.events.lock().unwrap();
    let kinds: Vec<&str> = events
        .iter()
        .map(|event| match event {
            AgentEvent::Started { .. } => "started",
            AgentEvent::Prompt { .. } => "prompt",
            AgentEvent::Message { .. } => "message",
            AgentEvent::Thought { .. } => "thought",
            AgentEvent::ToolCall { .. } => "toolCall",
            AgentEvent::Plan { .. } => "plan",
            AgentEvent::Options { .. } => "options",
            AgentEvent::Commands { .. } => "commands",
            AgentEvent::TurnEnded { .. } => "turnEnded",
            AgentEvent::Error { .. } => "error",
            AgentEvent::Stopped { .. } => "stopped",
        })
        .collect();

    assert_eq!(kinds.first(), Some(&"started"));
    assert_eq!(kinds.get(1), Some(&"prompt"));
    assert!(kinds.contains(&"toolCall"));
    assert!(kinds.contains(&"message"));
    assert_eq!(kinds.last(), Some(&"turnEnded"));
    assert!(
        !kinds.contains(&"error"),
        "a clean turn reported an error: {kinds:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn stopping_a_session_that_was_never_started_is_an_error_not_a_panic() {
    let recorder = Arc::new(Recorder::default());
    let host = AgentHost::new(recorder as Arc<dyn HostObserver>);
    assert!(host.stop("agent-session-99").is_err());
    assert!(host.prompt("agent-session-99", "hello".into()).is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unknown_agent_cannot_be_started() {
    let recorder = Arc::new(Recorder::default());
    let host = AgentHost::new(recorder as Arc<dyn HostObserver>);
    let dir = tempfile::tempdir().unwrap();
    assert!(host
        .start_session("emacs-doctor", &dir.path().join("essay.md"))
        .await
        .is_err());
}
