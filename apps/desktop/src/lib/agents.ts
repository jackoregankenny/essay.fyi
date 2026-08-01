// The app's half of the ACP host in `essay-agents`.
//
// Nothing here decides anything. An agent's edit arrives as a proposal, the
// author accepts or rejects it, and the file changes only on an accept — the
// invariant the whole feature exists to keep.
//
// The types below mirror the serde attributes on the Rust side exactly; those
// tests (`a_change_set_crosses_to_the_webview_in_camel_case`,
// `agent_events_cross_to_the_webview_tagged_and_in_camel_case`) are the only
// thing type-checking this boundary, so keep the two in step.
//
// Every call is a no-op outside the desktop shell, so the browser dev preview
// renders the panel's chrome without a Rust process behind it.

import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { DocumentDiff } from './diff'

/** An agent Essay knows how to launch, and whether this machine has it. */
export interface AgentInfo {
  id: string
  name: string
  /** The command line, for the "why is this greyed out?" line. */
  command: string
  available: boolean
}

export interface SessionSummary {
  sessionId: string
  agentId: string
  agentName: string
  /** The agent's own id, which is what appears in its logs. */
  acpSessionId: string
  document: string
}

export interface PlanEntry {
  content: string
  priority: string
  status: string
}

/** One knob the agent exposes — its mode, its model, whatever else. The panel
    renders these generically; `id` is what setting one sends back. */
export interface SessionOption {
  /** `mode` for the session mode, otherwise the agent's own config id. */
  id: string
  name: string
  description: string | null
  /** Semantic hint when the agent gives one: `model`, `mode`, … */
  category: string | null
  /** `select` | `toggle` — a toggle still carries On/Off choices. */
  kind: string
  currentValue: string
  choices: SessionChoice[]
}

export interface SessionChoice {
  value: string
  name: string
  description: string | null
  /** Group header when the agent groups its choices (providers, say). */
  group: string | null
}

/** A command the agent accepts as `/name` at the start of a prompt. */
export interface AgentCommand {
  name: string
  description: string
  inputHint: string | null
}

/** One thing that happened in a session, tagged by `kind`. */
export type AgentEvent =
  | {
      kind: 'started'
      sessionId: string
      agentId: string
      agentName: string
      acpSessionId: string
      document: string
    }
  | { kind: 'prompt'; sessionId: string; text: string }
  | { kind: 'message'; sessionId: string; text: string }
  | { kind: 'thought'; sessionId: string; text: string }
  | {
      kind: 'toolCall'
      sessionId: string
      toolCallId: string
      title: string
      /** `pending` | `in_progress` | `completed` | `failed`. */
      status: string
      /** `read` | `edit` | `execute` | `think` | `other`… */
      toolKind: string
      locations: string[]
    }
  | { kind: 'plan'; sessionId: string; entries: PlanEntry[] }
  | { kind: 'options'; sessionId: string; options: SessionOption[] }
  | { kind: 'commands'; sessionId: string; commands: AgentCommand[] }
  | { kind: 'turnEnded'; sessionId: string; stopReason: string }
  | { kind: 'error'; sessionId: string; message: string }
  | { kind: 'stopped'; sessionId: string }

/** Who asked for a change, and why. Recorded when the agent asked for the
    write, because none of it is recoverable afterwards. */
export interface Provenance {
  agent: string
  sessionId: string
  toolCallId: string | null
  promptExcerpt: string
  timestampMillis: number
}

export type ChangeStatus = 'pending' | 'accepted' | 'rejected'

/** One reviewable proposal against one file. Nothing is on disk yet. */
export interface ChangeSet {
  id: string
  file: string
  baseHash: string
  proposedContents: string
  diff: DocumentDiff
  /** Decided in Rust: the threshold is editorial policy. */
  looksLikeARewrite: boolean
  provenance: Provenance
  status: ChangeStatus
}

export type AcceptOutcome =
  | { status: 'written'; id: string; hash: string }
  | { status: 'conflict'; id: string; diskHash: string; diskContents: string }

export interface PermissionOption {
  optionId: string
  name: string
  /** `allow_once` | `allow_always` | `reject_once` | `reject_always`. */
  kind: string
}

export interface PermissionRequest {
  requestId: string
  sessionId: string
  agentName: string
  title: string
  toolCallId: string | null
  options: PermissionOption[]
}

export type PermissionDecision =
  | { outcome: 'selected'; optionId: string }
  | { outcome: 'cancelled' }

/**
 * An edit an agent made by writing the file itself rather than asking Essay
 * to write it — caught by the document watcher, attributed to whichever
 * session was running at the time.
 *
 * A different animal from a [`ChangeSet`] and the panel must say so: the bytes
 * are **already on disk**, so the decision in front of the author is whether
 * to revert, not whether to apply. opencode 1.17.8 acknowledges the protocol's
 * `fs` capability and then edits files with its own tools, so this is the
 * ordinary case rather than the exotic one.
 */
export interface AppliedEdit {
  id: string
  agent: string
  file: string
  /** Hash of what is on disk now — the guard a revert writes against. */
  hash: string
  /** What the author had before it landed. The editor's buffer is the only
      "before" that exists; the agent never told us what it replaced. */
  before: string
  contents: string
  /** Computed when the edit arrives, so the row can carry its size and the
      rewrite flag without the author opening it first. */
  diff: DocumentDiff | null
  looksLikeARewrite: boolean
  at: number
  /** `superseded` means another edit landed before the author answered. */
  settled: 'kept' | 'reverted' | 'superseded' | null
}

export function listAgents(): Promise<AgentInfo[]> {
  if (!isTauri()) return Promise.resolve([])
  return invoke<AgentInfo[]>('list_agents')
}

/** Launch an agent against the document on screen. Rejects — with the reason
    on the button the author pressed — when the agent cannot start. */
export function startAgentSession(
  agentId: string,
  documentPath: string,
): Promise<SessionSummary> {
  return invoke<SessionSummary>('start_agent_session', {
    agentId,
    documentPath,
  })
}

/** A standing instruction sent to the agent, not code that runs. */
export interface Skill {
  id: string
  name: string
  scope: 'section' | 'document'
  body: string
  path: string | null
  builtIn: boolean
}

/** Skills available beside a document: the built-in one, then the author's. */
export function listSkills(documentPath: string): Promise<Skill[]> {
  if (!isTauri()) return Promise.resolve([])
  return invoke<Skill[]>('list_skills', { documentPath })
}

/**
 * Exactly what will be sent for this turn, preamble included.
 *
 * The panel shows this rather than prefixing the author's words with
 * instructions they cannot read — it is their subscription paying for it.
 */
export function previewAgentPrompt(
  sessionId: string,
  prompt: string,
  skillIds: string[] = [],
): Promise<string> {
  if (!isTauri()) return Promise.resolve(prompt)
  return invoke<string>('preview_agent_prompt', { sessionId, prompt, skillIds })
}

/**
 * Returns as soon as the turn is queued; the reply arrives as events.
 *
 * `skillIds` are the author's preference skills. The house skill that tells
 * the agent it is editing a manuscript is always sent and is not listed here.
 */
export function sendAgentPrompt(
  sessionId: string,
  prompt: string,
  skillIds: string[] = [],
): Promise<void> {
  return invoke('send_agent_prompt', { sessionId, prompt, skillIds })
}

/** The knobs the agent exposes right now — how a reattaching panel catches
    up. Live changes arrive as `options` events. */
export function sessionOptions(sessionId: string): Promise<SessionOption[]> {
  if (!isTauri()) return Promise.resolve([])
  return invoke<SessionOption[]>('agent_session_options', { sessionId })
}

/** Change one of the agent's knobs. The new state comes back as an `options`
    event — the agent can change these on its own too, so the event stream is
    the single source of truth. */
export function setSessionOption(
  sessionId: string,
  optionId: string,
  value: string,
): Promise<void> {
  return invoke('set_agent_session_option', { sessionId, optionId, value })
}

/** Interrupt the turn in progress. The session survives it. */
export function cancelAgentTurn(sessionId: string): Promise<void> {
  return invoke('cancel_agent_turn', { sessionId })
}

export function stopAgentSession(sessionId: string): Promise<void> {
  return invoke('stop_agent_session', { sessionId })
}

/** Sessions the host still has running — how the panel finds its way back
    after a WebView reload. */
export function listAgentSessions(): Promise<SessionSummary[]> {
  if (!isTauri()) return Promise.resolve([])
  return invoke<SessionSummary[]>('list_agent_sessions')
}

/** The review queue, oldest first, including everything already settled. */
export function listChangeSets(): Promise<ChangeSet[]> {
  if (!isTauri()) return Promise.resolve([])
  return invoke<ChangeSet[]>('list_change_sets')
}

/** Apply a proposal, under the hash guard it was composed against. */
export function acceptChangeSet(id: string): Promise<AcceptOutcome> {
  return invoke<AcceptOutcome>('accept_change_set', { id })
}

/** Decline a proposal. The file was never touched; this is what takes it out
    of the queue and stops it shadowing the file for the agent. */
export function rejectChangeSet(id: string): Promise<ChangeSet> {
  return invoke<ChangeSet>('reject_change_set', { id })
}

export function respondToPermission(
  requestId: string,
  outcome: PermissionDecision,
): Promise<void> {
  return invoke('respond_to_permission', { requestId, outcome })
}

export function onAgentEvent(
  handler: (event: AgentEvent) => void,
): Promise<() => void> {
  return subscribe('essay://agent-event', handler)
}

export function onChangeSet(
  handler: (change: ChangeSet) => void,
): Promise<() => void> {
  return subscribe('essay://change-set', handler)
}

export function onPermissionRequest(
  handler: (request: PermissionRequest) => void,
): Promise<() => void> {
  return subscribe('essay://permission-request', handler)
}

async function subscribe<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {}
  return listen<T>(event, (message) => handler(message.payload))
}

/**
 * Whether two paths name the same file, as far as the WebView can tell.
 *
 * Agents build their own absolute paths, and on Windows those differ from
 * ours in case and separator often enough that `===` is not good enough. Rust
 * canonicalises; here a normalised compare is the best available, and it only
 * ever decides presentation.
 */
export function samePath(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const normalise = (path: string) =>
    path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  return normalise(a) === normalise(b)
}

/** Last path segment — what a review card should carry instead of a path
    that wraps over three lines. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/** "just now", "4m ago" — provenance the author reads at a glance. Anything
    older than a day is a date, because "31h ago" is not a fact anybody holds. */
export function relativeTime(millis: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - millis) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(millis).toLocaleDateString()
}
