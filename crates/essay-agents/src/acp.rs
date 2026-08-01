//! The ACP client host.
//!
//! Essay is the *client* in Agent Client Protocol terms: it launches an agent
//! as a subprocess and speaks JSON-RPC to it over stdio. The protocol's shape
//! is why this is the right channel for Essay rather than merely a convenient
//! one — when a client advertises the `fs` capability, a well-behaved agent
//! stops touching the filesystem itself and asks the client to read and write
//! on its behalf. That hands Essay the interception point the product needs:
//!
//! - `fs/write_text_file` never writes. It becomes a pending change set and
//!   returns success, so the agent's model of the world stays consistent and
//!   it does not retry. The author decides whether it ever reaches disk.
//! - `fs/read_text_file` serves the file — or, once a proposal is pending for
//!   that path, the proposal, because that is what the agent was told it wrote.
//! - `session/request_permission` is routed to the author and the ACP request
//!   is left open until they answer.
//!
//! A note on returning success for a write that did not happen. ACP has no
//! "held for review" response: `WriteTextFileResponse` is an empty object, and
//! the only alternative is a JSON-RPC error, which agents surface as a failed
//! tool call and commonly retry. Reporting failure for a write Essay fully
//! intends to honour would be the less truthful answer of the two, and it
//! would produce exactly the write loop the change-set queue exists to avoid.
//! The pending-content overlay is what keeps the story consistent afterwards.

use crate::changeset::{provenance, ChangeSetStore};
use crate::registry::{self, LaunchError};
use crate::session::{
    AgentCommand, AgentEvent, HostObserver, PermissionBroker, PermissionDecision,
    PermissionOption, PermissionRequest, PlanEntry, SessionChoice, SessionCommand, SessionOption,
    SessionSummary,
};
use agent_client_protocol::schema::v1::{
    AvailableCommand, AvailableCommandInput, CancelNotification, ClientCapabilities, ContentBlock,
    ContentChunk, FileSystemCapabilities, Implementation, InitializeRequest, NewSessionRequest,
    PromptRequest, ReadTextFileRequest, ReadTextFileResponse, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
    SessionConfigKind, SessionConfigOption, SessionConfigSelectOptions, SessionModeState,
    SessionNotification, SessionUpdate, SetSessionConfigOptionRequest, SetSessionModeRequest,
    WriteTextFileRequest, WriteTextFileResponse,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Client};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};

/// How long to wait for `initialize` + `session/new` before giving up.
///
/// Generous because an agent behind `npx -y` fetches its adapter from the
/// registry on first run, and that is a download, not a handshake.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(120);

/// The id under which the session mode appears among a session's options.
///
/// ACP models the mode as its own mechanism (`session/set_mode`) and
/// everything else as config options (`session/set_config_option`); Essay
/// flattens both into one list so the panel renders every knob the same way.
/// This id is how the host knows which wire call a change goes out on.
pub const MODE_OPTION_ID: &str = "mode";

#[derive(Debug, thiserror::Error)]
pub enum HostError {
    #[error(transparent)]
    Launch(#[from] LaunchError),
    #[error("unknown agent `{0}`")]
    UnknownAgent(String),
    #[error("no session {0}")]
    UnknownSession(String),
    #[error("{agent} did not finish starting up within {seconds}s")]
    HandshakeTimeout { agent: String, seconds: u64 },
    #[error("{agent} could not start: {message}")]
    Handshake { agent: String, message: String },
}

/// The app's handle on a running session: what to tell the frontend, where to
/// send commands, and the context the handlers share.
struct RunningSession {
    summary: SessionSummary,
    commands: mpsc::UnboundedSender<SessionCommand>,
    document: PathBuf,
    context: Arc<SessionContext>,
}

/// Owns every running agent session and the review queue they feed.
pub struct AgentHost {
    changes: Arc<ChangeSetStore>,
    permissions: Arc<PermissionBroker>,
    observer: Arc<dyn HostObserver>,
    sessions: Mutex<HashMap<String, RunningSession>>,
    next_session: AtomicU64,
}

impl AgentHost {
    pub fn new(observer: Arc<dyn HostObserver>) -> Self {
        Self {
            changes: Arc::new(ChangeSetStore::new()),
            permissions: Arc::new(PermissionBroker::new()),
            observer,
            sessions: Mutex::new(HashMap::new()),
            next_session: AtomicU64::new(0),
        }
    }

    pub fn changes(&self) -> &Arc<ChangeSetStore> {
        &self.changes
    }

    pub fn permissions(&self) -> &Arc<PermissionBroker> {
        &self.permissions
    }

    /// The agent behind a session, for attributing an accepted change set.
    pub fn agent_name(&self, session_id: &str) -> Option<String> {
        self.sessions
            .lock()
            .unwrap()
            .get(session_id)
            .map(|session| session.summary.agent_name.clone())
    }

    /// Who to credit for an edit that did not come through the protocol.
    ///
    /// Some agents ignore the `fs` capability and write the file themselves —
    /// opencode 1.17.8 does, verified against the binary. Those edits reach
    /// `DocumentWatcher` instead of this host, and would otherwise be recorded
    /// as `RevisionAuthor::Unknown` even though Essay knows perfectly well
    /// which agent it has running against that document. The attribution is
    /// circumstantial, not protocol-borne, and callers should treat it that
    /// way: it names the session that was live, not a request that was made.
    pub fn attribution(&self, session_id: &str) -> Option<crate::Provenance> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(session_id)?;
        Some(session.context.attribution())
    }

    /// The live session working on `document`, if there is one. Lets the
    /// watcher ask "was an agent doing this?" before calling an edit anonymous.
    pub fn session_for(&self, document: &Path) -> Option<String> {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .find(|session| crate::changeset::same_file(&session.document, document))
            .map(|session| session.summary.session_id.clone())
    }

    /// Launch `agent_id` and open a session rooted at `document`'s folder.
    ///
    /// Returns only once the agent has answered `initialize` and `session/new`.
    /// A failure to start is an error the author sees on the button they
    /// pressed, rather than an event arriving later out of nowhere.
    pub async fn start_session(
        &self,
        agent_id: &str,
        document: &Path,
    ) -> Result<SessionSummary, HostError> {
        let definition = registry::definition(agent_id)
            .ok_or_else(|| HostError::UnknownAgent(agent_id.to_string()))?;
        let config = definition.launch_config()?;

        self.start_session_over(
            definition.id,
            definition.name,
            document,
            AcpAgent::new(config),
        )
        .await
    }

    /// Open a session over an arbitrary ACP transport.
    ///
    /// Exposed because the transport is the one thing worth substituting: it is
    /// how the interception behaviour is tested against an in-process agent
    /// without a subprocess, and how an in-process agent would be hosted if
    /// Essay ever ships one. Ordinary callers want [`Self::start_session`].
    #[doc(hidden)]
    pub async fn start_session_over(
        &self,
        agent_id: &str,
        agent_name: &str,
        document: &Path,
        transport: impl agent_client_protocol::ConnectTo<Client> + 'static,
    ) -> Result<SessionSummary, HostError> {
        let session_id = format!(
            "agent-session-{}",
            self.next_session.fetch_add(1, Ordering::Relaxed) + 1
        );

        // The session's working directory is the document's folder: the agent
        // should be able to see the manuscript's neighbours (notes, figures,
        // other chapters) without being handed the whole disk.
        let cwd = document
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));

        let context = Arc::new(SessionContext {
            session_id: session_id.clone(),
            agent_name: agent_name.to_string(),
            changes: Arc::clone(&self.changes),
            permissions: Arc::clone(&self.permissions),
            observer: Arc::clone(&self.observer),
            prompt: Mutex::new(String::new()),
            latest_tool_call: Mutex::new(None),
            mode_state: Mutex::new(None),
            configs: Mutex::new(Vec::new()),
        });

        let (commands_tx, commands_rx) = mpsc::unbounded_channel();
        let (ready_tx, ready_rx) = oneshot::channel();

        let task_context = Arc::clone(&context);
        tokio::spawn(async move {
            let session_id = task_context.session_id.clone();
            let observer = Arc::clone(&task_context.observer);
            let result = run_connection(task_context, transport, cwd, commands_rx, ready_tx).await;
            if let Err(err) = result {
                // The connection ending is normal; it ending badly is not, and
                // the author is owed the reason either way.
                observer.agent_event(AgentEvent::Error {
                    session_id: session_id.clone(),
                    message: err,
                });
            }
            observer.agent_event(AgentEvent::Stopped { session_id });
        });

        let acp_session_id = match tokio::time::timeout(HANDSHAKE_TIMEOUT, ready_rx).await {
            Ok(Ok(Ok(id))) => id,
            Ok(Ok(Err(message))) => {
                return Err(HostError::Handshake {
                    agent: agent_name.to_string(),
                    message,
                })
            }
            // The task ended before it answered — it already reported why.
            Ok(Err(_)) => {
                return Err(HostError::Handshake {
                    agent: agent_name.to_string(),
                    message: "the agent exited during startup".to_string(),
                })
            }
            Err(_) => {
                return Err(HostError::HandshakeTimeout {
                    agent: agent_name.to_string(),
                    seconds: HANDSHAKE_TIMEOUT.as_secs(),
                })
            }
        };

        let summary = SessionSummary {
            session_id: session_id.clone(),
            agent_id: agent_id.to_string(),
            agent_name: agent_name.to_string(),
            acp_session_id,
            document: document.display().to_string(),
        };

        self.sessions.lock().unwrap().insert(
            session_id,
            RunningSession {
                summary: summary.clone(),
                commands: commands_tx,
                document: document.to_path_buf(),
                context: Arc::clone(&context),
            },
        );

        self.observer.agent_event(AgentEvent::Started {
            session_id: summary.session_id.clone(),
            agent_id: summary.agent_id.clone(),
            agent_name: summary.agent_name.clone(),
            acp_session_id: summary.acp_session_id.clone(),
            document: summary.document.clone(),
        });

        let options = context.options_snapshot();
        if !options.is_empty() {
            self.observer.agent_event(AgentEvent::Options {
                session_id: summary.session_id.clone(),
                options,
            });
        }

        Ok(summary)
    }

    pub fn prompt(&self, session_id: &str, prompt: String) -> Result<(), HostError> {
        self.command(session_id, SessionCommand::Prompt(prompt))
    }

    /// The knobs the agent exposes on this session, with current values.
    pub fn options(&self, session_id: &str) -> Vec<SessionOption> {
        self.sessions
            .lock()
            .unwrap()
            .get(session_id)
            .map(|session| session.context.options_snapshot())
            .unwrap_or_default()
    }

    /// Change one of the agent's knobs — `mode`, `model`, whichever it
    /// advertised. The result comes back as an `Options` event rather than a
    /// return value, because agents also change these on their own and the
    /// panel needs one source of truth for both.
    pub fn set_option(
        &self,
        session_id: &str,
        option_id: String,
        value: String,
    ) -> Result<(), HostError> {
        self.command(session_id, SessionCommand::SetOption { option_id, value })
    }

    /// Interrupt the turn in progress. The session survives it.
    pub fn cancel(&self, session_id: &str) -> Result<(), HostError> {
        self.command(session_id, SessionCommand::Cancel)
    }

    /// End a session and the subprocess with it.
    pub fn stop(&self, session_id: &str) -> Result<(), HostError> {
        let session = self
            .sessions
            .lock()
            .unwrap()
            .remove(session_id)
            .ok_or_else(|| HostError::UnknownSession(session_id.to_string()))?;
        // Best effort: if the task is already gone the channel is closed, which
        // is the outcome we wanted anyway.
        let _ = session.commands.send(SessionCommand::Stop);
        self.permissions.cancel_all();
        Ok(())
    }

    pub fn sessions(&self) -> Vec<SessionSummary> {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .map(|session| session.summary.clone())
            .collect()
    }

    /// The document a session was opened against.
    pub fn document(&self, session_id: &str) -> Option<PathBuf> {
        self.sessions
            .lock()
            .unwrap()
            .get(session_id)
            .map(|session| session.document.clone())
    }

    fn command(&self, session_id: &str, command: SessionCommand) -> Result<(), HostError> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| HostError::UnknownSession(session_id.to_string()))?;
        session
            .commands
            .send(command)
            .map_err(|_| HostError::UnknownSession(session_id.to_string()))
    }
}

/// Everything the protocol handlers need. One per session, shared by the
/// handlers and the command loop.
struct SessionContext {
    session_id: String,
    agent_name: String,
    changes: Arc<ChangeSetStore>,
    permissions: Arc<PermissionBroker>,
    observer: Arc<dyn HostObserver>,
    /// The instruction that started the current turn, kept for provenance.
    prompt: Mutex<String>,
    /// The most recent tool call the agent announced.
    ///
    /// ACP's `fs/write_text_file` carries no tool-call id, so this is the only
    /// thread back to the transcript entry that caused a write. Agents
    /// announce the call immediately before making the request, which makes it
    /// reliable in practice and a best guess in principle — hence
    /// `tool_call_id: Option<_>` rather than a required field.
    latest_tool_call: Mutex<Option<String>>,
    /// The session mode as ACP's dedicated mechanism reports it. Kept apart
    /// from `configs` because agents (the Claude Code adapter does) advertise
    /// the *same* mode a second time as a config option; on read, the config
    /// copy shadows this one so the author never sees the knob twice.
    mode_state: Mutex<Option<SessionOption>>,
    /// The knobs from ACP config options — model, effort, whatever else —
    /// with their current values. Replaced whole whenever the agent says so.
    configs: Mutex<Vec<SessionOption>>,
}

impl SessionContext {
    fn emit(&self, event: AgentEvent) {
        self.observer.agent_event(event);
    }

    fn current_prompt(&self) -> String {
        self.prompt.lock().unwrap().clone()
    }

    /// Hold a write as a proposal instead of performing it.
    fn intercept_write(&self, path: &Path, proposed: String) {
        // The file as it stands right now, not as the editor last saw it: the
        // proposal must be diffed against what accepting it would replace.
        let current = std::fs::read_to_string(path).unwrap_or_default();
        let provenance = provenance(
            &self.agent_name,
            &self.session_id,
            self.latest_tool_call.lock().unwrap().clone(),
            &self.current_prompt(),
        );

        match self.changes.propose(path, &current, proposed, provenance) {
            Some(change) => self.observer.change_set(&change),
            None => log::info!(
                "{} rewrote {} to what it already contained",
                self.agent_name,
                path.display()
            ),
        }
    }

    /// What the agent should see when it reads a file.
    fn read_for_agent(&self, path: &Path) -> std::io::Result<String> {
        match self.changes.pending_contents(path) {
            Some(pending) => Ok(pending),
            None => std::fs::read_to_string(path),
        }
    }

    fn attribution(&self) -> crate::Provenance {
        provenance(
            &self.agent_name,
            &self.session_id,
            self.latest_tool_call.lock().unwrap().clone(),
            &self.current_prompt(),
        )
    }

    fn note_tool_call(&self, id: Option<String>) {
        if let Some(id) = id {
            *self.latest_tool_call.lock().unwrap() = Some(id);
        }
    }

    /// The knobs as one list: config options, plus the mode-mechanism entry
    /// when no config option already covers it.
    fn options_snapshot(&self) -> Vec<SessionOption> {
        let configs = self.configs.lock().unwrap().clone();
        let mut out = Vec::new();
        if let Some(mode) = self.mode_state.lock().unwrap().clone() {
            if !configs.iter().any(|config| config.id == MODE_OPTION_ID) {
                out.push(mode);
            }
        }
        out.extend(configs);
        out
    }

    /// Record a new current value for one option — in both stores, because an
    /// agent that advertises its mode twice changes it in both places at once.
    /// Returns the whole list, which is what crosses to the frontend — state,
    /// never a delta.
    fn set_current(&self, option_id: &str, value: &str) -> Vec<SessionOption> {
        if option_id == MODE_OPTION_ID {
            if let Some(mode) = self.mode_state.lock().unwrap().as_mut() {
                mode.current_value = value.to_string();
            }
        }
        if let Some(option) = self
            .configs
            .lock()
            .unwrap()
            .iter_mut()
            .find(|option| option.id == option_id)
        {
            option.current_value = value.to_string();
        }
        self.options_snapshot()
    }

    /// Replace every config-derived option with the set the agent just sent.
    fn replace_configs(&self, configs: &[SessionConfigOption]) -> Vec<SessionOption> {
        *self.configs.lock().unwrap() =
            configs.iter().filter_map(config_option).collect();
        self.options_snapshot()
    }

    fn emit_options(&self, options: Vec<SessionOption>) {
        self.emit(AgentEvent::Options {
            session_id: self.session_id.clone(),
            options,
        });
    }
}

/// Run one agent connection until the session is stopped or the agent exits.
async fn run_connection(
    context: Arc<SessionContext>,
    transport: impl agent_client_protocol::ConnectTo<Client> + 'static,
    cwd: PathBuf,
    mut commands: mpsc::UnboundedReceiver<SessionCommand>,
    ready: oneshot::Sender<Result<String, String>>,
) -> Result<(), String> {
    let agent_name = context.agent_name.clone();
    // Shared with the connection closure: whichever side sees the failure
    // first — the handshake inside, or the connection dying under it — must be
    // able to hand `start_session` the real reason.
    let ready = Arc::new(Mutex::new(Some(ready)));
    let handshake_ready = Arc::clone(&ready);

    let result = Client
        .builder()
        .name("essay")
        // A write is never a write. See the module comment for why this
        // answers `Ok` to something it did not do.
        .on_receive_request(
            {
                let context = Arc::clone(&context);
                async move |request: WriteTextFileRequest, responder, _cx| {
                    context.intercept_write(&request.path, request.content);
                    responder.respond(WriteTextFileResponse::new())
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let context = Arc::clone(&context);
                async move |request: ReadTextFileRequest, responder, _cx| {
                    match context.read_for_agent(&request.path) {
                        Ok(contents) => responder.respond(ReadTextFileResponse::new(slice(
                            &contents,
                            request.line,
                            request.limit,
                        ))),
                        Err(err) => responder.respond_with_internal_error(format!(
                            "cannot read {}: {err}",
                            request.path.display()
                        )),
                    }
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let context = Arc::clone(&context);
                async move |request: RequestPermissionRequest, responder, cx| {
                    let (request_id, decision) = context.permissions.open();
                    context.observer.permission_request(&PermissionRequest {
                        request_id,
                        session_id: context.session_id.clone(),
                        agent_name: context.agent_name.clone(),
                        title: request.tool_call.fields.title.clone().unwrap_or_default(),
                        tool_call_id: Some(request.tool_call.tool_call_id.to_string()),
                        options: request
                            .options
                            .iter()
                            .map(|option| PermissionOption {
                                option_id: option.option_id.to_string(),
                                name: option.name.clone(),
                                kind: kind_name(&option.kind),
                            })
                            .collect(),
                    });

                    // Answer on a spawned task, not here: this callback runs
                    // inside the dispatch loop, and an author who takes a
                    // minute to decide must not stop the transcript streaming
                    // behind them.
                    cx.spawn(async move {
                        let outcome = match decision.await {
                            Ok(PermissionDecision::Selected { option_id }) => {
                                RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                                    option_id,
                                ))
                            }
                            // A dropped sender means the session went away
                            // while the ask was outstanding; ACP spells that
                            // `Cancelled`.
                            _ => RequestPermissionOutcome::Cancelled,
                        };
                        responder.respond(RequestPermissionResponse::new(outcome))
                    })
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_notification(
            {
                let context = Arc::clone(&context);
                async move |notification: SessionNotification, _cx| {
                    context.handle_update(notification.update);
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .connect_with(transport, async |cx| {
            let handshake = async {
                cx.send_request(
                    InitializeRequest::new(ProtocolVersion::V1)
                        .client_capabilities(
                            ClientCapabilities::new()
                                // The whole reason this crate exists: with `fs`
                                // advertised, edits arrive as requests Essay can
                                // hold rather than as writes it can only discover
                                // afterwards.
                                .fs(FileSystemCapabilities::new()
                                    .read_text_file(true)
                                    .write_text_file(true))
                                // No terminal: Essay is not an IDE, and an agent
                                // with a shell can write the manuscript behind the
                                // protocol's back.
                                .terminal(false),
                        )
                        .client_info(Implementation::new(
                            "essay",
                            env!("CARGO_PKG_VERSION"),
                        )),
                )
                .block_task()
                .await?;

                cx.send_request(NewSessionRequest::new(cwd.clone()))
                    .block_task()
                    .await
            }
            .await;

            let acp_session_id = match handshake {
                Ok(response) => {
                    // The knobs arrive with `session/new`; hold them so the
                    // host can answer "what can I tune?" without a round trip.
                    *context.mode_state.lock().unwrap() =
                        response.modes.as_ref().map(mode_option);
                    *context.configs.lock().unwrap() = response
                        .config_options
                        .as_deref()
                        .unwrap_or_default()
                        .iter()
                        .filter_map(config_option)
                        .collect();
                    response.session_id
                }
                Err(err) => {
                    if let Some(ready) = handshake_ready.lock().unwrap().take() {
                        let _ = ready.send(Err(err.to_string()));
                    }
                    return Err(err);
                }
            };

            let waiting = handshake_ready.lock().unwrap().take();
            if let Some(ready) = waiting {
                // Nobody waiting means `start_session` gave up; end the
                // connection rather than leave an orphan subprocess running.
                if ready.send(Ok(acp_session_id.to_string())).is_err() {
                    return Ok(());
                }
            }

            command_loop(&context, &cx, &acp_session_id, &mut commands).await;
            Ok(())
        })
        .await;

    // A connection that died before the handshake answered — a spawn failure,
    // a subprocess that printed an error and exited — still owes the author
    // its reason on the button they pressed, not only in the event stream.
    if let Err(err) = &result {
        if let Some(ready) = ready.lock().unwrap().take() {
            let _ = ready.send(Err(err.to_string()));
        }
    }

    context.permissions.cancel_all();
    result.map_err(|err| format!("{agent_name}: {err}"))
}

/// Drive the session: one prompt at a time, cancellable while it runs.
async fn command_loop<Link>(
    context: &SessionContext,
    cx: &agent_client_protocol::ConnectionTo<Link>,
    acp_session_id: &agent_client_protocol::schema::v1::SessionId,
    commands: &mut mpsc::UnboundedReceiver<SessionCommand>,
) where
    Link: agent_client_protocol::Role + agent_client_protocol::role::HasPeer<agent_client_protocol::Agent>,
{
    while let Some(command) = commands.recv().await {
        let text = match command {
            SessionCommand::Stop => return,
            // Nothing is running, so there is nothing to interrupt.
            SessionCommand::Cancel => continue,
            SessionCommand::SetOption { option_id, value } => {
                apply_option(context, cx, acp_session_id, &option_id, &value).await;
                continue;
            }
            SessionCommand::Prompt(text) => text,
        };

        *context.prompt.lock().unwrap() = text.clone();
        context.emit(AgentEvent::Prompt {
            session_id: context.session_id.clone(),
            text: text.clone(),
        });

        let turn = cx
            .send_request_to(
                agent_client_protocol::Agent,
                PromptRequest::new(acp_session_id.clone(), vec![ContentBlock::from(text)]),
            )
            .block_task();
        tokio::pin!(turn);

        loop {
            tokio::select! {
                result = &mut turn => {
                    match result {
                        Ok(response) => context.emit(AgentEvent::TurnEnded {
                            session_id: context.session_id.clone(),
                            stop_reason: stop_reason_name(&response.stop_reason),
                        }),
                        Err(err) => context.emit(AgentEvent::Error {
                            session_id: context.session_id.clone(),
                            message: err.to_string(),
                        }),
                    }
                    break;
                }
                command = commands.recv() => {
                    match command {
                        Some(SessionCommand::Cancel) => {
                            // Fire and forget: the agent confirms by ending the
                            // turn with `cancelled`, which the arm above reports.
                            let _ = cx.send_notification_to(
                                agent_client_protocol::Agent,
                                CancelNotification::new(acp_session_id.clone()),
                            );
                        }
                        // Mid-turn on purpose: switching out of a plan mode
                        // while the agent works is the whole point of modes.
                        Some(SessionCommand::SetOption { option_id, value }) => {
                            apply_option(context, cx, acp_session_id, &option_id, &value).await;
                        }
                        // Dropping the pinned turn cancels the outgoing request.
                        Some(SessionCommand::Stop) | None => return,
                        Some(SessionCommand::Prompt(ignored)) => log::warn!(
                            "dropped a prompt sent while {} was still answering: {ignored}",
                            context.agent_name
                        ),
                    }
                }
            }
        }
    }
}

/// Send one knob change out on whichever wire call ACP assigns it.
///
/// Failure is an `Error` event rather than a return value: the caller is the
/// command loop, and the author who flipped the control has long since moved
/// on — the panel is what has to hear about it.
async fn apply_option<Link>(
    context: &SessionContext,
    cx: &agent_client_protocol::ConnectionTo<Link>,
    acp_session_id: &agent_client_protocol::schema::v1::SessionId,
    option_id: &str,
    value: &str,
) where
    Link: agent_client_protocol::Role
        + agent_client_protocol::role::HasPeer<agent_client_protocol::Agent>,
{
    // A knob the agent advertised as a config option changes over
    // `session/set_config_option`; only a mode advertised solely through the
    // mode mechanism goes out on `session/set_mode`.
    let (is_config, toggle) = {
        let configs = context.configs.lock().unwrap();
        match configs.iter().find(|option| option.id == option_id) {
            Some(option) => (true, option.kind == "toggle"),
            None => (false, false),
        }
    };

    if !is_config && option_id == MODE_OPTION_ID {
        let result = cx
            .send_request_to(
                agent_client_protocol::Agent,
                SetSessionModeRequest::new(acp_session_id.clone(), value.to_string()),
            )
            .block_task()
            .await;
        match result {
            // Agents may also announce the change; emitting our own copy too
            // costs a repeat of the same state and never a wrong one.
            Ok(_) => {
                let options = context.set_current(MODE_OPTION_ID, value);
                context.emit_options(options);
            }
            Err(err) => context.emit(AgentEvent::Error {
                session_id: context.session_id.clone(),
                message: format!("could not switch mode: {err}"),
            }),
        }
        return;
    }
    let request = if toggle {
        SetSessionConfigOptionRequest::new(
            acp_session_id.clone(),
            option_id.to_string(),
            value == "true",
        )
    } else {
        SetSessionConfigOptionRequest::new(
            acp_session_id.clone(),
            option_id.to_string(),
            agent_client_protocol::schema::v1::SessionConfigValueId::from(value.to_string()),
        )
    };

    match cx
        .send_request_to(agent_client_protocol::Agent, request)
        .block_task()
        .await
    {
        Ok(response) => {
            let options = context.replace_configs(&response.config_options);
            context.emit_options(options);
        }
        Err(err) => context.emit(AgentEvent::Error {
            session_id: context.session_id.clone(),
            message: format!("could not change {option_id}: {err}"),
        }),
    }
}

impl SessionContext {
    fn handle_update(&self, update: SessionUpdate) {
        let session_id = self.session_id.clone();
        match update {
            SessionUpdate::AgentMessageChunk(chunk) => {
                if let Some(text) = chunk_text(&chunk) {
                    self.emit(AgentEvent::Message { session_id, text });
                }
            }
            SessionUpdate::AgentThoughtChunk(chunk) => {
                if let Some(text) = chunk_text(&chunk) {
                    self.emit(AgentEvent::Thought { session_id, text });
                }
            }
            SessionUpdate::ToolCall(call) => {
                self.note_tool_call(Some(call.tool_call_id.to_string()));
                self.emit(AgentEvent::ToolCall {
                    session_id,
                    tool_call_id: call.tool_call_id.to_string(),
                    title: call.title.clone(),
                    status: format!("{:?}", call.status).to_lowercase(),
                    tool_kind: format!("{:?}", call.kind).to_lowercase(),
                    locations: call
                        .locations
                        .iter()
                        .map(|location| location.path.display().to_string())
                        .collect(),
                });
            }
            SessionUpdate::ToolCallUpdate(update) => {
                self.note_tool_call(Some(update.tool_call_id.to_string()));
                self.emit(AgentEvent::ToolCall {
                    session_id,
                    tool_call_id: update.tool_call_id.to_string(),
                    title: update.fields.title.clone().unwrap_or_default(),
                    status: update
                        .fields
                        .status
                        .map(|status| format!("{status:?}").to_lowercase())
                        .unwrap_or_else(|| "in_progress".to_string()),
                    tool_kind: update
                        .fields
                        .kind
                        .map(|kind| format!("{kind:?}").to_lowercase())
                        .unwrap_or_else(|| "other".to_string()),
                    locations: update
                        .fields
                        .locations
                        .unwrap_or_default()
                        .iter()
                        .map(|location| location.path.display().to_string())
                        .collect(),
                });
            }
            SessionUpdate::Plan(plan) => self.emit(AgentEvent::Plan {
                session_id,
                entries: plan
                    .entries
                    .iter()
                    .map(|entry| PlanEntry {
                        content: entry.content.clone(),
                        priority: format!("{:?}", entry.priority).to_lowercase(),
                        status: format!("{:?}", entry.status).to_lowercase(),
                    })
                    .collect(),
            }),
            SessionUpdate::CurrentModeUpdate(update) => {
                let options = self.set_current(MODE_OPTION_ID, &update.current_mode_id.to_string());
                self.emit_options(options);
            }
            SessionUpdate::ConfigOptionUpdate(update) => {
                let options = self.replace_configs(&update.config_options);
                self.emit_options(options);
            }
            SessionUpdate::AvailableCommandsUpdate(update) => self.emit(AgentEvent::Commands {
                session_id,
                commands: update
                    .available_commands
                    .iter()
                    .map(agent_command)
                    .collect(),
            }),
            // The rest — usage, session metadata, the author's own message
            // echoed back — say nothing the panel needs yet.
            _ => {}
        }
    }
}

fn chunk_text(chunk: &ContentChunk) -> Option<String> {
    match &chunk.content {
        ContentBlock::Text(text) => Some(text.text.clone()),
        _ => None,
    }
}

/// The session mode, rendered as one more option among the agent's knobs.
fn mode_option(state: &SessionModeState) -> SessionOption {
    SessionOption {
        id: MODE_OPTION_ID.to_string(),
        name: "Mode".to_string(),
        description: None,
        category: Some("mode".to_string()),
        kind: "select".to_string(),
        current_value: state.current_mode_id.to_string(),
        choices: state
            .available_modes
            .iter()
            .map(|mode| SessionChoice {
                value: mode.id.to_string(),
                name: mode.name.clone(),
                description: mode.description.clone(),
                group: None,
            })
            .collect(),
    }
}

/// One ACP config option, flattened for the panel. `None` for shapes this
/// version of the protocol does not know — dropping a knob is better than
/// refusing the session that carries it.
fn config_option(config: &SessionConfigOption) -> Option<SessionOption> {
    let (kind, current_value, choices) = match &config.kind {
        SessionConfigKind::Select(select) => {
            let choices = match &select.options {
                SessionConfigSelectOptions::Ungrouped(options) => options
                    .iter()
                    .map(|option| select_choice(option, None))
                    .collect(),
                SessionConfigSelectOptions::Grouped(groups) => groups
                    .iter()
                    .flat_map(|group| {
                        group
                            .options
                            .iter()
                            .map(|option| select_choice(option, Some(group.name.clone())))
                    })
                    .collect(),
                _ => return None,
            };
            ("select", select.current_value.to_string(), choices)
        }
        SessionConfigKind::Boolean(toggle) => (
            "toggle",
            toggle.current_value.to_string(),
            vec![
                SessionChoice {
                    value: "true".to_string(),
                    name: "On".to_string(),
                    description: None,
                    group: None,
                },
                SessionChoice {
                    value: "false".to_string(),
                    name: "Off".to_string(),
                    description: None,
                    group: None,
                },
            ],
        ),
        _ => return None,
    };

    Some(SessionOption {
        id: config.id.to_string(),
        name: config.name.clone(),
        description: config.description.clone(),
        category: config
            .category
            .as_ref()
            .map(|category| format!("{category:?}").to_lowercase()),
        kind: kind.to_string(),
        current_value,
        choices,
    })
}

fn select_choice(
    option: &agent_client_protocol::schema::v1::SessionConfigSelectOption,
    group: Option<String>,
) -> SessionChoice {
    SessionChoice {
        value: option.value.to_string(),
        name: option.name.clone(),
        description: option.description.clone(),
        group,
    }
}

fn agent_command(command: &AvailableCommand) -> AgentCommand {
    AgentCommand {
        name: command.name.clone(),
        description: command.description.clone(),
        input_hint: command.input.as_ref().and_then(|input| match input {
            AvailableCommandInput::Unstructured(unstructured) => Some(unstructured.hint.clone()),
            _ => None,
        }),
    }
}

fn kind_name(kind: &agent_client_protocol::schema::v1::PermissionOptionKind) -> String {
    use agent_client_protocol::schema::v1::PermissionOptionKind as K;
    match kind {
        K::AllowOnce => "allow_once",
        K::AllowAlways => "allow_always",
        K::RejectOnce => "reject_once",
        K::RejectAlways => "reject_always",
        _ => "unknown",
    }
    .to_string()
}

fn stop_reason_name(reason: &agent_client_protocol::schema::v1::StopReason) -> String {
    use agent_client_protocol::schema::v1::StopReason as S;
    match reason {
        S::EndTurn => "end_turn",
        S::MaxTokens => "max_tokens",
        S::MaxTurnRequests => "max_turn_requests",
        S::Refusal => "refusal",
        S::Cancelled => "cancelled",
        _ => "unknown",
    }
    .to_string()
}

/// Honour `line`/`limit` on a read, which agents use to page through a long
/// manuscript instead of pulling forty pages into their context.
pub(crate) fn slice(contents: &str, line: Option<u32>, limit: Option<u32>) -> String {
    if line.is_none() && limit.is_none() {
        return contents.to_string();
    }
    // ACP counts from 1.
    let start = line.unwrap_or(1).max(1) as usize - 1;
    let lines: Vec<&str> = contents.split_inclusive('\n').collect();
    let taken = lines
        .into_iter()
        .skip(start)
        .take(limit.map_or(usize::MAX, |limit| limit as usize));
    taken.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_read_without_a_range_returns_the_whole_file() {
        let source = "one\ntwo\nthree\n";
        assert_eq!(slice(source, None, None), source);
    }

    #[test]
    fn a_read_counts_lines_from_one() {
        assert_eq!(slice("one\ntwo\nthree\n", Some(2), None), "two\nthree\n");
    }

    #[test]
    fn a_read_with_a_limit_stops_where_it_was_told() {
        assert_eq!(slice("one\ntwo\nthree\n", Some(1), Some(2)), "one\ntwo\n");
    }

    #[test]
    fn a_read_past_the_end_of_the_file_is_empty_not_an_error() {
        assert_eq!(slice("one\ntwo\n", Some(99), Some(10)), "");
    }

    #[test]
    fn a_read_preserves_the_authors_line_endings() {
        // Slicing must not normalise: the file is canonical, byte for byte.
        assert_eq!(slice("one\r\ntwo\r\n", Some(1), Some(1)), "one\r\n");
    }
}
