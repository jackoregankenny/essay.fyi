//! The session abstraction: what the app holds while an agent is running.
//!
//! A session is a live subprocess plus a command channel into the task that
//! owns its connection. Nothing here touches the protocol — `acp.rs` does that
//! — so the shapes in this file are the ones that cross to the WebView.

use crate::changeset::ChangeSet;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tokio::sync::oneshot;

/// What the frontend gets back when a session starts. Both ids are here on
/// purpose: Essay's is what commands take, the agent's is what appears in the
/// agent's own transcripts and logs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session_id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub acp_session_id: String,
    pub document: String,
}

/// One thing that happened in a session.
///
/// Tagged rather than several event names because the panel renders a single
/// ordered transcript: interleaving is the information, and separate channels
/// would lose it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AgentEvent {
    Started {
        session_id: String,
        agent_id: String,
        agent_name: String,
        acp_session_id: String,
        document: String,
    },
    /// The author's turn, echoed so the transcript reads as a conversation.
    Prompt {
        session_id: String,
        text: String,
    },
    /// A chunk of the agent's reply. Chunks arrive as the model produces them
    /// and are not sentence-aligned; the panel concatenates.
    Message {
        session_id: String,
        text: String,
    },
    /// Reasoning the agent chose to expose. Separate from `Message` because it
    /// is not part of the answer and should not read as if it were.
    Thought {
        session_id: String,
        text: String,
    },
    ToolCall {
        session_id: String,
        tool_call_id: String,
        title: String,
        /// `pending` | `in_progress` | `completed` | `failed`, as ACP reports it.
        status: String,
        /// ACP's tool kind — `read`, `edit`, `execute`, `think`, `other`…
        tool_kind: String,
        /// Files the call says it touched, for follow-along.
        locations: Vec<String>,
    },
    /// The agent's plan for a longer task.
    Plan {
        session_id: String,
        entries: Vec<PlanEntry>,
    },
    /// The knobs the agent exposes — mode, model, whatever else — sent whole
    /// on session start and again whenever any of them changes.
    Options {
        session_id: String,
        options: Vec<SessionOption>,
    },
    /// The slash-commands the agent accepts, sent whole whenever they change.
    Commands {
        session_id: String,
        commands: Vec<AgentCommand>,
    },
    /// The turn finished. `stop_reason` is ACP's: `end_turn`, `cancelled`,
    /// `refusal`, `max_tokens`, `max_turn_requests`.
    TurnEnded {
        session_id: String,
        stop_reason: String,
    },
    /// Something the author needs to know about but cannot act on. The session
    /// may still be alive; `Stopped` is the one that means it is not.
    Error {
        session_id: String,
        message: String,
    },
    Stopped {
        session_id: String,
    },
}

impl AgentEvent {
    pub fn session_id(&self) -> &str {
        match self {
            Self::Started { session_id, .. }
            | Self::Prompt { session_id, .. }
            | Self::Message { session_id, .. }
            | Self::Thought { session_id, .. }
            | Self::ToolCall { session_id, .. }
            | Self::Plan { session_id, .. }
            | Self::Options { session_id, .. }
            | Self::Commands { session_id, .. }
            | Self::TurnEnded { session_id, .. }
            | Self::Error { session_id, .. }
            | Self::Stopped { session_id } => session_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntry {
    pub content: String,
    pub priority: String,
    pub status: String,
}

/// One knob the agent exposes on a session — its mode, its model, whatever
/// else it chooses to advertise. ACP has two mechanisms (session modes and
/// config options); they are normalised into this one shape so the panel can
/// render every agent's knobs the same way without knowing any by name.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOption {
    /// [`MODE_OPTION_ID`](crate::acp::MODE_OPTION_ID) for the session mode;
    /// otherwise the agent's own config id (`model`, `thought-level`, …).
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// Semantic hint when the agent gives one — `model`, `mode`, … UX only.
    pub category: Option<String>,
    /// `select` or `toggle`. A toggle still carries two choices; the flag is
    /// for the host, which must send a boolean back rather than a value id.
    pub kind: String,
    pub current_value: String,
    pub choices: Vec<SessionChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionChoice {
    pub value: String,
    pub name: String,
    pub description: Option<String>,
    /// Group header when the agent groups its choices (providers, say).
    pub group: Option<String>,
}

/// A command the agent accepts as `/name` at the start of a prompt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommand {
    pub name: String,
    pub description: String,
    /// What the agent says should follow the command, if anything.
    pub input_hint: Option<String>,
}

/// A decision the agent is blocked on.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    /// Essay's id for this ask. The frontend hands it back to answer.
    pub request_id: String,
    pub session_id: String,
    pub agent_name: String,
    /// What the agent wants to do, in its own words.
    pub title: String,
    pub tool_call_id: Option<String>,
    pub options: Vec<PermissionOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub option_id: String,
    pub name: String,
    /// `allow_once` | `allow_always` | `reject_once` | `reject_always`.
    pub kind: String,
}

/// The author's answer. `Cancelled` is a real outcome in ACP, not a failure —
/// it is what a client must send when the turn is cancelled with asks
/// outstanding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PermissionDecision {
    Selected { option_id: String },
    Cancelled,
}

/// Holds the asks that are waiting on a human.
///
/// The ACP request stays open on the wire while its `oneshot` waits here.
/// Answering is a separate command from the frontend rather than a reply on
/// the same call, because the author may take minutes and nothing else in the
/// session should stop for that.
#[derive(Default)]
pub struct PermissionBroker {
    waiting: Mutex<HashMap<String, oneshot::Sender<PermissionDecision>>>,
    next_id: AtomicU64,
}

impl PermissionBroker {
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn open(&self) -> (String, oneshot::Receiver<PermissionDecision>) {
        let id = format!(
            "permission-{}",
            self.next_id.fetch_add(1, Ordering::Relaxed) + 1
        );
        let (tx, rx) = oneshot::channel();
        self.waiting.lock().unwrap().insert(id.clone(), tx);
        (id, rx)
    }

    /// Answer an outstanding ask. Unknown ids are an error rather than a
    /// silent no-op: it means the frontend and the host disagree about what is
    /// pending, which is worth surfacing.
    pub fn resolve(&self, request_id: &str, decision: PermissionDecision) -> Result<(), String> {
        let sender = self
            .waiting
            .lock()
            .unwrap()
            .remove(request_id)
            .ok_or_else(|| format!("no permission request {request_id}"))?;
        sender
            .send(decision)
            .map_err(|_| format!("permission request {request_id} is no longer waiting"))
    }

    /// Cancel every ask belonging to a session that is going away, so nothing
    /// is left blocked on a decision that can no longer be made.
    pub(crate) fn cancel_all(&self) {
        for (_, sender) in self.waiting.lock().unwrap().drain() {
            let _ = sender.send(PermissionDecision::Cancelled);
        }
    }
}

/// What the app wants to hear about. Implemented on the Tauri side, where each
/// method becomes an `essay://` event.
pub trait HostObserver: Send + Sync + 'static {
    fn agent_event(&self, event: AgentEvent);
    fn change_set(&self, change: &ChangeSet);
    fn permission_request(&self, request: &PermissionRequest);
}

pub(crate) enum SessionCommand {
    Prompt(String),
    /// Change one of the agent's exposed knobs. Legal mid-turn: switching
    /// mode while the agent works is the plan-mode workflow.
    SetOption { option_id: String, value: String },
    /// Interrupt the turn in progress; the session stays open.
    Cancel,
    /// End the session and the subprocess with it.
    Stop,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_answered_permission_reaches_whoever_was_waiting() {
        let broker = PermissionBroker::new();
        let (id, rx) = broker.open();

        broker
            .resolve(
                &id,
                PermissionDecision::Selected {
                    option_id: "allow".into(),
                },
            )
            .expect("resolve");

        match rx.await.expect("a decision") {
            PermissionDecision::Selected { option_id } => assert_eq!(option_id, "allow"),
            PermissionDecision::Cancelled => panic!("wrong decision"),
        }
    }

    #[tokio::test]
    async fn answering_an_ask_nobody_made_is_an_error() {
        let broker = PermissionBroker::new();
        assert!(broker
            .resolve("permission-99", PermissionDecision::Cancelled)
            .is_err());
    }

    #[tokio::test]
    async fn an_ask_can_only_be_answered_once() {
        let broker = PermissionBroker::new();
        let (id, _rx) = broker.open();
        broker.resolve(&id, PermissionDecision::Cancelled).expect("first");
        assert!(broker.resolve(&id, PermissionDecision::Cancelled).is_err());
    }

    #[tokio::test]
    async fn a_session_going_away_releases_everything_waiting_on_it() {
        let broker = PermissionBroker::new();
        let (_id, rx) = broker.open();

        broker.cancel_all();

        assert!(matches!(
            rx.await.expect("a decision"),
            PermissionDecision::Cancelled
        ));
    }

    #[test]
    fn agent_events_cross_to_the_webview_tagged_and_in_camel_case() {
        let event = AgentEvent::ToolCall {
            session_id: "session-1".into(),
            tool_call_id: "call_1".into(),
            title: "Edit essay.md".into(),
            status: "in_progress".into(),
            tool_kind: "edit".into(),
            locations: vec!["C:/essay.md".into()],
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({
                "kind": "toolCall",
                "sessionId": "session-1",
                "toolCallId": "call_1",
                "title": "Edit essay.md",
                "status": "in_progress",
                "toolKind": "edit",
                "locations": ["C:/essay.md"],
            })
        );
    }

    #[test]
    fn session_options_cross_to_the_webview_in_camel_case() {
        let event = AgentEvent::Options {
            session_id: "session-1".into(),
            options: vec![SessionOption {
                id: "model".into(),
                name: "Model".into(),
                description: None,
                category: Some("model".into()),
                kind: "select".into(),
                current_value: "sonnet".into(),
                choices: vec![SessionChoice {
                    value: "sonnet".into(),
                    name: "Sonnet".into(),
                    description: Some("Efficient".into()),
                    group: None,
                }],
            }],
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({
                "kind": "options",
                "sessionId": "session-1",
                "options": [{
                    "id": "model",
                    "name": "Model",
                    "description": null,
                    "category": "model",
                    "kind": "select",
                    "currentValue": "sonnet",
                    "choices": [{
                        "value": "sonnet",
                        "name": "Sonnet",
                        "description": "Efficient",
                        "group": null,
                    }],
                }],
            })
        );
    }

    #[test]
    fn a_permission_decision_arrives_from_the_webview_tagged() {
        let selected: PermissionDecision =
            serde_json::from_value(serde_json::json!({ "outcome": "selected", "optionId": "allow" }))
                .expect("parse");
        assert!(matches!(
            selected,
            PermissionDecision::Selected { option_id } if option_id == "allow"
        ));

        let cancelled: PermissionDecision =
            serde_json::from_value(serde_json::json!({ "outcome": "cancelled" })).expect("parse");
        assert!(matches!(cancelled, PermissionDecision::Cancelled));
    }
}
