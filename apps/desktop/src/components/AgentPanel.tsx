import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  AcceptIcon,
  BusyIcon,
  CloseIcon,
  CollapseIcon,
  ConnectIcon,
  DocumentIcon,
  EditIcon,
  ErrorIcon,
  ExpandIcon,
  MoreIcon,
  OnDiskIcon,
  RejectIcon,
  RetryIcon,
  RevertIcon,
  SendIcon,
  StopIcon,
  ThinkingIcon,
  ToolIcon,
  TuneIcon,
  type Icon,
} from '#/lib/icons'
import { cn } from '#/lib/cn'
import {
  acceptChangeSet,
  baseName,
  cancelAgentTurn,
  listAgentSessions,
  listAgents,
  listChangeSets,
  onAgentEvent,
  onChangeSet,
  onPermissionRequest,
  rejectChangeSet,
  relativeTime,
  respondToPermission,
  listSkills,
  samePath,
  sendAgentPrompt,
  sessionOptions,
  setSessionOption,
  startAgentSession,
  stopAgentSession,
  type AgentCommand,
  type AgentEvent,
  type AgentInfo,
  type AppliedEdit,
  type ChangeSet,
  type PermissionRequest,
  type PlanEntry,
  type SessionOption,
  type SessionSummary,
  type Skill,
} from '#/lib/agents'
import { Select } from '@base-ui-components/react/select'
import { Check } from '@phosphor-icons/react'
import type { ReviewRequest } from './DiffReview'
import { IconButton } from './ui/icon-button'
import { Tip } from './ui/tooltip'

/**
 * The agent surface: pick an agent, ask it something, watch it work, and
 * decide what — if anything — reaches the manuscript.
 *
 * Two things about it are load-bearing rather than decorative.
 *
 * **Nothing is applied here.** Accepting opens the diff first, because a
 * proposal is the only moment the author still owns their phrasing. Rejecting
 * needs no review: declining costs nothing, since the file was never touched.
 *
 * **An agent's edit can arrive by two roads and they are not the same event.**
 * A `ChangeSet` is a proposal Essay intercepted — nothing on disk, accept
 * writes it. An `AppliedEdit` is an agent that ignored the protocol's
 * filesystem capability and wrote the file itself (opencode 1.17.8 does, see
 * `docs/research/agent-integration.md` §8.2); the bytes have landed and the
 * only decision left is whether to revert. The panel labels the two
 * differently and offers different verbs, because telling an author their
 * document is untouched when it is not is the one lie this feature cannot
 * afford.
 */
export interface AgentPanelProps {
  /** Whether the pane is showing. It stays mounted either way: a running turn,
      a transcript and a queue of proposals must survive the author shutting
      the pane to get the width back. */
  open: boolean
  /** Absolute path of the open document; null while it is untitled. An agent
      needs a real file — there is nothing to give it otherwise. */
  documentPath: string | null
  documentName: string
  /** Edits the watcher caught, attributed to a running session by the host. */
  appliedEdits: AppliedEdit[]
  /** Tells the host whether a session is live, so a watcher-caught edit can be
      attributed to the agent that was running when it landed. */
  onSessionChange: (agentName: string | null) => void
  /** How many decisions the panel is holding, so the chrome can say so while
      the pane is shut. */
  onWaitingChange: (count: number) => void
  /** Ask the workspace to show a diff over the manuscript. */
  onReview: (review: ReviewRequest) => void
  onCloseReview: () => void
  /** A proposal reached disk; the editor's buffer has to follow it there. */
  onAccepted: (change: ChangeSet, hash: string) => void
  /** The file moved under a proposal — the workspace owns that conversation. */
  onAcceptConflict: (diskHash: string, diskContents: string) => void
  onKeepApplied: (edit: AppliedEdit) => void
  onRevertApplied: (edit: AppliedEdit) => void
  /** Untitled drafts cannot start a filesystem agent. The empty state offers
      this direct route instead of presenting a disabled agent catalogue. */
  onSaveDocument: () => void
  onClose: () => void
  /** Hosted inside the companion, which already owns the close affordance. */
  embedded?: boolean
}

/** A transcript entry. Chunks are folded into these as they arrive, so a
    streaming reply grows one paragraph rather than stacking fragments. */
type Entry =
  | { id: number; kind: 'prompt'; text: string }
  | { id: number; kind: 'message'; text: string }
  | { id: number; kind: 'thought'; text: string }
  | {
      id: number
      kind: 'tool'
      toolCallId: string
      title: string
      status: string
      toolKind: string
      locations: string[]
    }
  | { id: number; kind: 'plan'; entries: PlanEntry[] }
  | { id: number; kind: 'note'; tone: 'quiet' | 'error'; text: string }

let entrySeq = 0
const nextId = () => (entrySeq += 1)

/** How close to the bottom still counts as "following along". Below this the
    author has scrolled back to read, and the transcript must stop moving. */
const STICK_SLACK = 32

/** The agent the author used last, so opening the panel can warm it up. */
const LAST_AGENT_KEY = 'essay.agent.v1'

/** Knobs the author has tuned, per agent: `{ agentId: { optionId: value } }`.
    An agent advertises its defaults fresh on every session, so a preference
    that is not written down is a preference the author re-enters daily. */
const TUNING_KEY = 'essay.agent.tune.v1'

type Tuning = Record<string, Record<string, string>>

/** Storage is shared with the author's own hands and with older builds, so
    nothing here trusts its shape — a corrupt blob loses a preference, which is
    one extra click, and must never take the panel down with it. */
function readTuning(): Tuning {
  try {
    const raw = localStorage.getItem(TUNING_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const clean: Tuning = {}
    for (const [agentId, knobs] of Object.entries(parsed as object)) {
      if (!knobs || typeof knobs !== 'object' || Array.isArray(knobs)) continue
      clean[agentId] = Object.fromEntries(
        Object.entries(knobs as object).filter(
          ([, value]) => typeof value === 'string',
        ),
      ) as Record<string, string>
    }
    return clean
  } catch {
    return {}
  }
}

function writeTuning(tuning: Tuning) {
  try {
    localStorage.setItem(TUNING_KEY, JSON.stringify(tuning))
  } catch {
    // Forgetting a knob costs one adjustment next session.
  }
}

/**
 * Whether this machine is running on battery, best effort.
 *
 * Pre-warming spawns a subprocess the author has not asked for yet; on mains
 * that is free, on battery it is somebody's afternoon. Chromium's Battery
 * Status API answers where it exists; where it does not, assume mains —
 * the pre-warm is cheap and the author expressed intent by opening the panel.
 */
async function onBattery(): Promise<boolean> {
  try {
    const getBattery = (
      navigator as Navigator & {
        getBattery?: () => Promise<{ charging: boolean }>
      }
    ).getBattery
    if (!getBattery) return false
    const battery = await getBattery.call(navigator)
    return battery.charging === false
  } catch {
    return false
  }
}

export function AgentPanel({
  open,
  documentPath,
  documentName,
  appliedEdits,
  onSessionChange,
  onWaitingChange,
  onReview,
  onCloseReview,
  onAccepted,
  onAcceptConflict,
  onKeepApplied,
  onRevertApplied,
  onSaveDocument,
  onClose,
  embedded = false,
}: AgentPanelProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [session, setSession] = useState<SessionSummary | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [running, setRunning] = useState(false)
  const [changes, setChanges] = useState<ChangeSet[]>([])
  const [asks, setAsks] = useState<PermissionRequest[]>([])
  const [draft, setDraft] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  /** The agent's knobs — mode, model, whatever it advertises. Whole-state
      replaced on every `options` event; the stream is the source of truth. */
  const [options, setOptions] = useState<SessionOption[]>([])
  /** Session mechanics are available, not ambient. A conversation opens as a
      conversation; mode/model/effort appear when the author asks for them. */
  const [tuning, setTuning] = useState(false)
  const [commands, setCommands] = useState<AgentCommand[]>([])
  /** Preference skills switched on. The house skill is not in here: it is
      always sent, and offering to turn it off would be offering to tell the
      agent less about where it is. */
  const [chosen, setChosen] = useState<string[]>([])

  const transcriptRef = useRef<HTMLDivElement>(null)
  const stuckToBottom = useRef(true)
  /** The live session, for listeners registered once at mount. */
  const sessionRef = useRef<SessionSummary | null>(null)

  useEffect(() => {
    sessionRef.current = session
    onSessionChange(session?.agentName ?? null)
  }, [session, onSessionChange])

  /** The open document, for the mount-time probe below, which must not
      re-run every time the author switches files. */
  const documentRef = useRef(documentPath)
  documentRef.current = documentPath

  // What the host already knows: agents on this machine, proposals still in
  // the queue, and any session that outlived a WebView reload. Mount only —
  // a session outlives which file is on screen, and re-probing on every
  // document change would restart a transcript mid-conversation.
  useEffect(() => {
    const failed = (action: string, error: unknown) =>
      setFailure((current) =>
        current ?? `${action}: ${String(error).replace(/^Error:\s*/, '')}`,
      )
    void listAgents()
      .then(setAgents)
      .catch((error) => failed('Could not list agents', error))
    void listChangeSets()
      .then(setChanges)
      .catch((error) => failed('Could not load review changes', error))
    void listAgentSessions()
      .then((open) => {
        const mine =
          open.find((s) => samePath(s.document, documentRef.current)) ?? open[0]
        if (mine) {
          setSession(mine)
          void sessionOptions(mine.sessionId)
            .then(setOptions)
            .catch((error) => failed('Could not load ACP controls', error))
          setEntries([
            {
              id: nextId(),
              kind: 'note',
              tone: 'quiet',
              text: `Reattached to ${mine.agentName}.`,
            },
          ])
        }
      })
      .catch((error) => failed('Could not restore agent sessions', error))
  }, [])

  useEffect(() => {
    const disposers: Array<() => void> = []
    let cancelled = false
    const track = (pending: Promise<() => void>, label: string) =>
      void pending
        .then((dispose) =>
          cancelled ? dispose() : disposers.push(dispose),
        )
        .catch((error) => {
          if (!cancelled) {
            setFailure(
              `${label}: ${String(error).replace(/^Error:\s*/, '')}`,
            )
          }
        })

    track(
      onAgentEvent((event) => {
        // Events from a session the panel is not showing are still real, but
        // interleaving two transcripts would make neither readable.
        if (
          sessionRef.current &&
          event.sessionId !== sessionRef.current.sessionId
        ) {
          return
        }
        // Session state, not transcript: these replace rather than append.
        if (event.kind === 'options') {
          setOptions(event.options)
          return
        }
        if (event.kind === 'commands') {
          setCommands(event.commands)
          return
        }
        setEntries((current) => absorb(current, event))
        if (event.kind === 'prompt') setRunning(true)
        if (
          event.kind === 'turnEnded' ||
          event.kind === 'error' ||
          event.kind === 'stopped'
        ) {
          setRunning(false)
        }
        if (event.kind === 'stopped') {
          setSession(null)
          setOptions([])
          setCommands([])
        }
      }),
      'Could not listen to the agent transcript',
    )
    track(
      onChangeSet((change) =>
        setChanges((current) => [
          ...current.filter((entry) => entry.id !== change.id),
          change,
        ]),
      ),
      'Could not listen for proposed changes',
    )
    track(
      onPermissionRequest((request) =>
        setAsks((current) => [...current, request]),
      ),
      'Could not listen for permission requests',
    )

    return () => {
      cancelled = true
      disposers.forEach((dispose) => dispose())
    }
  }, [])

  // Follow the stream only while the author is already at the bottom. A
  // transcript that yanks itself down while they are reading back is the
  // single most common way a panel like this becomes unusable.
  useEffect(() => {
    const node = transcriptRef.current
    if (node && stuckToBottom.current) node.scrollTop = node.scrollHeight
  }, [entries])

  const start = useCallback(
    // `warmed` marks the session the panel started on its own. It changes
    // nothing about the connection and everything about how it reads: an
    // author who opened the pane and found an agent already connected is owed
    // a sentence saying why, or the panel looks like it started talking to
    // something on their behalf.
    async (agent: AgentInfo, warmed = false) => {
      if (!documentPath) return
      setFailure(null)
      setStarting(agent.id)
      try {
        const summary = await startAgentSession(agent.id, documentPath)
        setSession(summary)
        setEntries(
          warmed
            ? [
                {
                  id: nextId(),
                  kind: 'note',
                  tone: 'quiet',
                  text: `Warmed up ${agent.name} — your last agent, connected while you were composing.`,
                },
              ]
            : [],
        )
        try {
          localStorage.setItem(LAST_AGENT_KEY, agent.id)
        } catch {
          // Forgetting the preference costs one extra click next session.
        }
      } catch (error) {
        // No prefix: the host's errors already read "X could not start: …" /
        // "X is not installed: …", and stacking a second prefix on top was
        // exactly the doubled message this used to show.
        setFailure(String(error))
      } finally {
        setStarting(null)
      }
    },
    [documentPath],
  )

  /** One warm-up per panel lifetime: an author who ended a session has said
      no, and reopening the pane must not say yes for them. */
  const prewarmed = useRef(false)

  // Opening the pane is the intent signal: connect to the agent the author
  // used last, so the two-plus seconds an adapter takes to answer `initialize`
  // are spent while they are still deciding what to ask. An idle ACP session
  // costs nothing until a prompt is sent. Skipped on battery — a subprocess
  // nobody asked for yet is the wrong thing to spend a charge on.
  useEffect(() => {
    if (!open || session || starting || !documentPath || prewarmed.current)
      return
    if (agents.length === 0) return
    const last = (() => {
      try {
        return localStorage.getItem(LAST_AGENT_KEY)
      } catch {
        return null
      }
    })()
    const agent = agents.find((entry) => entry.id === last && entry.available)
    if (!agent) return
    prewarmed.current = true
    void onBattery().then((draining) => {
      if (!draining) void start(agent, true)
    })
  }, [open, session, starting, documentPath, agents, start])

  // Skills live beside the document, so they are re-read when it changes —
  // and an author who edits a skill file sees it on the next document switch
  // rather than having to restart Essay.
  useEffect(() => {
    if (!documentPath) {
      setSkills([])
      return
    }
    let current = true
    void listSkills(documentPath)
      .then((found) => {
        if (current) setSkills(found)
      })
      .catch((error) => {
        if (current) {
          setFailure(
            `Could not load agent instructions: ${String(error).replace(/^Error:\s*/, '')}`,
          )
        }
      })
    return () => {
      current = false
    }
  }, [documentPath])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!session || !text || running) return
    setDraft('')
    stuckToBottom.current = true
    try {
      await sendAgentPrompt(session.sessionId, text, chosen)
    } catch (error) {
      setFailure(String(error))
    }
  }, [draft, session, running, chosen])

  const interrupt = useCallback(() => {
    if (session) void cancelAgentTurn(session.sessionId).catch(() => {})
  }, [session])

  const endSession = useCallback(async () => {
    if (!session) return
    await stopAgentSession(session.sessionId).catch(() => {})
    setSession(null)
    setRunning(false)
    setAsks([])
    setOptions([])
    setCommands([])
    setTuning(false)
  }, [session])

  const tune = useCallback(
    (option: SessionOption, value: string) => {
      if (!session) return
      // Optimistic: the `options` event brings the agent's word shortly, but
      // a select that snaps back while the round trip runs reads as broken.
      setOptions((current) =>
        current.map((entry) =>
          entry.id === option.id ? { ...entry, currentValue: value } : entry,
        ),
      )
      // Per agent, not per session: choosing a model is a standing preference
      // about how the author works, and the agent forgets it every launch.
      const tuning = readTuning()
      writeTuning({
        ...tuning,
        [session.agentId]: { ...tuning[session.agentId], [option.id]: value },
      })
      void setSessionOption(session.sessionId, option.id, value).catch(
        (error) => setFailure(String(error)),
      )
    },
    [session],
  )

  /** The session whose knobs have already been re-applied. Once per session:
      the author is free to change their mind mid-conversation, and a panel
      that kept dragging them back to a remembered value would be fighting
      them. */
  const retuned = useRef<string | null>(null)

  // Put the author's remembered knobs back, the moment the agent has said what
  // it advertises. Deliberately not optimistic — the `options` event confirms
  // each one, so a value the agent quietly refuses shows the agent's answer
  // rather than ours.
  useEffect(() => {
    if (!session || options.length === 0) return
    if (retuned.current === session.sessionId) return
    retuned.current = session.sessionId

    const tuning = readTuning()
    const remembered = tuning[session.agentId]
    if (!remembered) return

    const stale: string[] = []
    for (const [optionId, value] of Object.entries(remembered)) {
      const option = options.find((entry) => entry.id === optionId)
      // A knob the agent no longer advertises, or a choice it has retired —
      // a model withdrawn between releases is the ordinary case. Drop it
      // rather than send it: the agent would only reject it, and the author
      // would be reading an error about a preference they set months ago.
      if (!option || !option.choices.some((choice) => choice.value === value)) {
        stale.push(optionId)
        continue
      }
      if (option.currentValue === value) continue
      void setSessionOption(session.sessionId, optionId, value).catch(() => {})
    }

    if (stale.length > 0) {
      const kept = Object.fromEntries(
        Object.entries(remembered).filter(([id]) => !stale.includes(id)),
      )
      writeTuning({ ...tuning, [session.agentId]: kept })
    }
  }, [session, options])

  const answer = useCallback(
    (request: PermissionRequest, optionId: string | null) => {
      setAsks((current) =>
        current.filter((ask) => ask.requestId !== request.requestId),
      )
      void respondToPermission(
        request.requestId,
        optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' },
      ).catch((error) => setFailure(String(error)))
    },
    [],
  )

  const accept = useCallback(
    async (change: ChangeSet) => {
      onCloseReview()
      try {
        const outcome = await acceptChangeSet(change.id)
        if (outcome.status === 'conflict') {
          onAcceptConflict(outcome.diskHash, outcome.diskContents)
          return
        }
        setChanges((current) =>
          current.map((entry) =>
            entry.id === change.id
              ? { ...entry, status: 'accepted' as const }
              : entry,
          ),
        )
        onAccepted(change, outcome.hash)
      } catch (error) {
        setFailure(String(error))
      }
    },
    [onAccepted, onAcceptConflict, onCloseReview],
  )

  const reject = useCallback(
    async (change: ChangeSet) => {
      onCloseReview()
      try {
        await rejectChangeSet(change.id)
        setChanges((current) =>
          current.map((entry) =>
            entry.id === change.id
              ? { ...entry, status: 'rejected' as const }
              : entry,
          ),
        )
      } catch (error) {
        setFailure(String(error))
      }
    },
    [onCloseReview],
  )

  const reviewChange = useCallback(
    (change: ChangeSet) => {
      onReview({
        diff: change.diff,
        title: baseName(change.file),
        provenance: `Proposed by ${change.provenance.agent} · ${
          change.provenance.promptExcerpt || 'no instruction recorded'
        } · ${relativeTime(change.provenance.timestampMillis)}`,
        oldLabel: 'On disk',
        newLabel: 'Proposed',
        actions: [
          { label: 'Accept', primary: true, onClick: () => void accept(change) },
          { label: 'Reject', onClick: () => void reject(change) },
        ],
      })
    },
    [accept, reject, onReview],
  )

  const reviewApplied = useCallback(
    (edit: AppliedEdit) => {
      if (!edit.diff) return
      onReview({
        diff: edit.diff,
        title: baseName(edit.file),
        // Past tense on purpose: this already happened.
        provenance: `${edit.agent} wrote this to disk itself · ${relativeTime(edit.at)}`,
        oldLabel: 'Yours',
        newLabel: 'On disk',
        actions: [
          {
            label: 'Revert',
            primary: true,
            onClick: () => {
              onCloseReview()
              onRevertApplied(edit)
            },
          },
          {
            label: 'Keep it',
            onClick: () => {
              onCloseReview()
              onKeepApplied(edit)
            },
          },
        ],
      })
    },
    [onReview, onCloseReview, onKeepApplied, onRevertApplied],
  )

  const pending = changes.filter((change) => change.status === 'pending')
  const unsettled = appliedEdits.filter((edit) => edit.settled === null)
  const settled = [
    ...changes.filter((change) => change.status !== 'pending'),
    ...appliedEdits.filter((edit) => edit.settled !== null),
  ]
  const waiting = pending.length + unsettled.length + asks.length

  useEffect(() => {
    onWaitingChange(waiting)
  }, [waiting, onWaitingChange])

  return (
    <aside
      aria-label="Agent"
      className={cn(
        'flex h-full min-h-0 flex-col',
        embedded
          ? 'bg-transparent'
          : 'border-l border-[var(--essay-border)] bg-[var(--essay-editor-bg)]',
        !open && 'hidden',
      )}
    >
      <header
        className={cn(
          'flex h-10 shrink-0 items-center gap-2 px-3',
          !embedded && 'border-b border-[var(--essay-border)]',
        )}
      >
        {/* 13px medium, not caps — this holds a proper noun (the agent's own
            name), and a tracked-caps treatment reads as a category label
            where this is closer to a document title. Matches the manuscript
            title's own 12.5px/510 in TopBar. */}
        <h2 className="text-[13px] font-[var(--essay-weight-medium)] text-[var(--essay-text)]">
          {session ? session.agentName : 'Agent'}
        </h2>
        {session && (
          <span
            aria-label={running ? 'Agent is working' : 'Agent is connected and idle'}
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              running
                ? 'bg-[var(--essay-accent)]'
                : 'bg-[var(--essay-diff-insert)]',
            )}
            title={running ? 'Working' : 'Idle'}
          />
        )}
        <span className="ml-auto" />
        {session && options.length > 0 && (
          <Tip
            label="Session options"
            side="bottom"
            trigger={
              <IconButton
                onClick={() => setTuning((on) => !on)}
                aria-label="Agent session options — mode, model, and effort"
                aria-expanded={tuning}
                className={cn(
                  'h-8 w-8 bg-transparent',
                  tuning
                    ? 'text-[var(--essay-accent)]'
                    : 'text-[var(--essay-text-muted)]',
                )}
              >
                <TuneIcon size={14} />
              </IconButton>
            }
          />
        )}
        {session && (
          <button
            type="button"
            onClick={() => void endSession()}
            className="h-8 shrink-0 rounded-md px-1.5 text-[10.5px] text-[var(--essay-text-faint)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
          >
            End session
          </button>
        )}
        {!embedded && (
          <IconButton onClick={onClose} aria-label="Close the agent panel">
            <CloseIcon size={14} />
          </IconButton>
        )}
      </header>

      {session && tuning && options.length > 0 && (
        <OptionsStrip options={options} onTune={tune} />
      )}

      <ChangesBlock
        pending={pending}
        applied={unsettled}
        settled={settled}
        onReviewChange={reviewChange}
        onRejectChange={(change) => void reject(change)}
        onReviewApplied={reviewApplied}
      />

      {session ? (
        <div
          ref={transcriptRef}
          onScroll={(event) => {
            const node = event.currentTarget
            stuckToBottom.current =
              node.scrollHeight - node.scrollTop - node.clientHeight <
              STICK_SLACK
          }}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto px-3 py-3',
            // Empty, the transcript is a full-height column with one sentence
            // stranded at the top and the composer far below it — the two
            // halves of the same invitation, as far apart as the panel allows.
            // Centring closes that gap so the opening reads as one thing. Only
            // while empty: the moment there is a transcript, it is a log and a
            // log starts at the top.
            entries.length === 0 && 'flex flex-col justify-center',
          )}
        >
          {entries.length === 0 && (
            // A sentence, not a placeholder graphic: left-aligned and in the
            // flow, the way the picker's own copy reads before a session
            // exists.
            <p className="px-1 py-1 text-[12px] leading-[1.55] text-[var(--essay-text-faint)]">
              {session.agentName} is ready. Ask about this draft or propose an
              edit.
            </p>
          )}
          <ol className="flex flex-col gap-2.5">
            {entries.map((entry) => (
              <TranscriptEntry key={entry.id} entry={entry} />
            ))}
          </ol>
        </div>
      ) : (
        <AgentPicker
          agents={agents}
          documentPath={documentPath}
          documentName={documentName}
          starting={starting}
          onSave={onSaveDocument}
          onStart={(agent) => void start(agent)}
        />
      )}

      {failure && (
        // The icon carries severity; a soft local surface keeps a long
        // adapter error readable without dividing the whole margin.
        <p
          role="alert"
          className="mx-2 shrink-0 rounded-lg bg-[color-mix(in_oklab,var(--essay-surface)_45%,transparent)] px-3 py-2 text-[11px] leading-[1.5] text-[var(--essay-text)]"
        >
          <ErrorIcon
            size={11}
            weight="bold"
            aria-hidden
            className="mr-1 inline-block align-[-1px] text-[var(--essay-diff-remove)]"
          />
          {failure}
        </p>
      )}

      {/* Above the composer rather than inside the transcript: an ask that
          scrolls out of sight is an agent blocked on nothing. */}
      {asks.map((ask) => (
        <PermissionCard
          key={ask.requestId}
          request={ask}
          onAnswer={(optionId) => answer(ask, optionId)}
        />
      ))}

      {session && commands.length > 0 && draft.startsWith('/') && (
        <CommandHints
          commands={commands}
          draft={draft}
          onPick={(name) => setDraft(`/${name} `)}
        />
      )}

      {session && (
        <SkillBar
          skills={skills}
          chosen={chosen}
          onToggle={(id) =>
            setChosen((on) =>
              on.includes(id) ? on.filter((x) => x !== id) : [...on, id],
            )
          }
        />
      )}

      {session && (
        <Composer
          value={draft}
          running={running}
          agentName={session.agentName}
          onChange={setDraft}
          onSend={() => void send()}
          onInterrupt={interrupt}
        />
      )}
    </aside>
  )
}

/**
 * The agent's knobs — mode, model, whatever else it advertised — rendered
 * generically from what ACP handed over, so a new agent with new knobs needs
 * no new UI. They stay behind the faders button so transport and model
 * mechanics never lead the conversation.
 */
function OptionsStrip({
  options,
  onTune,
}: {
  options: SessionOption[]
  onTune: (option: SessionOption, value: string) => void
}) {
  return (
    // A hairline, not a tinted band: surface is spent on the cards that
    // hold a decision (the changes queue, the plan), not on chrome that
    // merely separates one region from the next.
    <section
      aria-label="Agent session options"
      className="mx-2 mb-1 shrink-0 rounded-lg bg-[color-mix(in_oklab,var(--essay-surface)_58%,transparent)] px-3 py-2"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <TuneIcon size={11} className="text-[var(--essay-text-faint)]" />
        <h3 className="text-[10px] font-[var(--essay-weight-semibold)] tracking-wider text-[var(--essay-text-faint)] uppercase">
          Session options
        </h3>
      </div>
      {options.map((option) => (
        <div key={option.id} className="flex h-7 items-center gap-2">
          <span
            className="w-[72px] shrink-0 truncate text-[11px] text-[var(--essay-text-muted)]"
            title={option.description ?? undefined}
          >
            {option.name}
          </span>
          <OptionSelect option={option} onTune={onTune} />
        </div>
      ))}
    </section>
  )
}

function OptionSelect({
  option,
  onTune,
}: {
  option: SessionOption
  onTune: (option: SessionOption, value: string) => void
}) {
  const label = (choice: SessionChoiceLike) =>
    choice.group ? `${choice.name} — ${choice.group}` : choice.name
  const current =
    option.choices.find((choice) => choice.value === option.currentValue) ??
    null

  return (
    <Select.Root
      value={option.currentValue}
      onValueChange={(next) => {
        if (next && next !== option.currentValue) onTune(option, next)
      }}
      items={option.choices.map((choice) => ({
        value: choice.value,
        label: label(choice),
      }))}
    >
      <Select.Trigger
        aria-label={option.name}
        className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-[11px] text-[var(--essay-text)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)] data-[popup-open]:bg-[var(--essay-surface-hover)]"
      >
        <span className="min-w-0 truncate">
          {current ? label(current) : option.currentValue}
        </span>
        <ExpandIcon
          size={9}
          aria-hidden
          className="ml-auto shrink-0 rotate-90 text-[var(--essay-text-faint)]"
        />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          alignItemWithTrigger={false}
          className="z-[var(--essay-z-float)]"
        >
          {/* A width, not just a floor. `min-w` alone let the content decide,
              and an agent catalogue's descriptions are a paragraph each — so
              the popup grew to the widest one, which on a wide monitor is the
              whole window, and the `truncate` below never engaged because
              there was nothing to truncate against. Same shape as the format
              select in `PrintPane`: a fixed comfortable width, capped at the
              viewport so it cannot overhang a narrow window. */}
          <Select.Popup className="essay-floating essay-pop max-h-[320px] w-[19rem] max-w-[calc(100vw-2rem)] overflow-y-auto p-1 outline-none">
            <Select.List>
              {option.choices.map((choice) => (
                <Select.Item
                  key={choice.value}
                  value={choice.value}
                  className="flex min-h-7 cursor-default select-none items-center gap-2 rounded-md px-2 py-1 text-[12px] text-[var(--essay-text-muted)] outline-none data-[highlighted]:bg-[var(--essay-surface-hover)] data-[highlighted]:text-[var(--essay-text)] data-[selected]:text-[var(--essay-text)]"
                >
                  <span className="flex w-3 shrink-0 justify-center">
                    <Select.ItemIndicator className="text-[var(--essay-accent)]">
                      <Check size={11} weight="bold" />
                    </Select.ItemIndicator>
                  </span>
                  <span className="min-w-0 flex-1">
                    <Select.ItemText className="block truncate">
                      {label(choice)}
                    </Select.ItemText>
                    {choice.description && (
                      <span className="block truncate text-[10px] text-[var(--essay-text-faint)]">
                        {choice.description}
                      </span>
                    )}
                  </span>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

type SessionChoiceLike = { name: string; group: string | null }

/**
 * The standing instructions going to the agent, above the box you type in.
 *
 * Sits here rather than behind a settings pane because it is spending the
 * author's own subscription and shaping every reply: a preamble you cannot
 * see is the intrusive version of this feature. Each chip opens to its full
 * text, so "what is it actually telling the thing?" is one click, not a
 * matter of trust.
 */
function SkillBar({
  skills,
  chosen,
  onToggle,
}: {
  skills: Skill[]
  chosen: string[]
  onToggle: (id: string) => void
}) {
  const [reading, setReading] = useState<string | null>(null)
  if (skills.length === 0) return null
  const open = skills.find((skill) => skill.id === reading)

  return (
    <div className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-1">
        {skills.map((skill) => {
          const on = skill.builtIn || chosen.includes(skill.id)
          return (
            <span key={skill.id} className="flex items-center">
              <button
                type="button"
                // The house skill is not a choice, so it is not a switch.
                onClick={() => !skill.builtIn && onToggle(skill.id)}
                aria-pressed={skill.builtIn ? undefined : on}
                disabled={skill.builtIn}
                title={
                  skill.builtIn
                    ? 'Always sent — tells the agent it is editing a manuscript'
                    : on
                      ? 'Sent with your next message'
                      : 'Not being sent'
                }
                className={cn(
                  'h-[22px] rounded-l-full rounded-r-none border py-0 pl-2 pr-1.5 text-[11px]',
                  'transition-colors duration-100',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
                  // On is a state, not a verb: raised ground, no accent. A row
                  // of skills all lit blue for being enabled spent the theme's
                  // one saturated element on a list of chips.
                  on
                    ? 'border-[var(--essay-surface-selected)] bg-[var(--essay-surface-selected)] text-[var(--essay-text)]'
                    : 'border-[var(--essay-border)] text-[var(--essay-text-muted)] hover:border-[var(--essay-border-strong)] hover:text-[var(--essay-text)]',
                  skill.builtIn && 'cursor-default',
                )}
              >
                {skill.name}
              </button>
              <button
                type="button"
                onClick={() => setReading(reading === skill.id ? null : skill.id)}
                aria-label={`What ${skill.name} says`}
                aria-expanded={reading === skill.id}
                className={cn(
                  'flex h-[22px] w-5 items-center justify-center rounded-r-full border border-l-0 text-[10px]',
                  'transition-colors duration-100',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
                  on
                    ? 'border-[var(--essay-surface-selected)] bg-[var(--essay-surface-selected)] text-[var(--essay-text-muted)] hover:text-[var(--essay-text)]'
                    : 'border-[var(--essay-border)] text-[var(--essay-text-faint)] hover:text-[var(--essay-text)]',
                )}
              >
                ?
              </button>
            </span>
          )
        })}
      </div>

      {open && (
        <div className="essay-pop mt-2 rounded-md border border-[var(--essay-border)] bg-[var(--essay-surface)] p-2">
          <p className="whitespace-pre-wrap text-[11px] leading-[1.5] text-[var(--essay-text-muted)]">
            {open.body}
          </p>
          {open.path && (
            <p className="mt-1.5 truncate font-(family-name:--essay-font-mono) text-[10px] text-[var(--essay-text-faint)]">
              {open.path}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Fold an event into the transcript.
 *
 * Message and thought chunks are appended to the entry they continue: ACP
 * chunks are not sentence-aligned, and rendering each as its own block turns a
 * paragraph into a stack of fragments that reflows on every token. Tool calls
 * are updated in place by id, so a call that goes pending → in progress →
 * completed stays one row instead of becoming three.
 */
function absorb(entries: Entry[], event: AgentEvent): Entry[] {
  const last = entries[entries.length - 1]

  switch (event.kind) {
    case 'prompt':
      return [...entries, { id: nextId(), kind: 'prompt', text: event.text }]
    case 'message':
      if (last?.kind === 'message') {
        return [
          ...entries.slice(0, -1),
          { ...last, text: last.text + event.text },
        ]
      }
      return [...entries, { id: nextId(), kind: 'message', text: event.text }]
    case 'thought':
      if (last?.kind === 'thought') {
        return [
          ...entries.slice(0, -1),
          { ...last, text: last.text + event.text },
        ]
      }
      return [...entries, { id: nextId(), kind: 'thought', text: event.text }]
    case 'toolCall': {
      const index = entries.findIndex(
        (entry) => entry.kind === 'tool' && entry.toolCallId === event.toolCallId,
      )
      const row: Entry = {
        id: index === -1 ? nextId() : entries[index].id,
        kind: 'tool',
        toolCallId: event.toolCallId,
        title: event.title,
        status: event.status,
        toolKind: event.toolKind,
        locations: event.locations,
      }
      if (index === -1) return [...entries, row]
      // An update carries only the fields that changed; a blank title would
      // otherwise wipe the one the author is reading.
      const before = entries[index]
      const merged: Entry =
        before.kind === 'tool'
          ? {
              ...row,
              title: event.title || before.title,
              locations: event.locations.length
                ? event.locations
                : before.locations,
            }
          : row
      return entries.map((entry, i) => (i === index ? merged : entry))
    }
    case 'plan': {
      const index = entries.findIndex((entry) => entry.kind === 'plan')
      const row: Entry = {
        id: index === -1 ? nextId() : entries[index].id,
        kind: 'plan',
        entries: event.entries,
      }
      return index === -1
        ? [...entries, row]
        : entries.map((entry, i) => (i === index ? row : entry))
    }
    case 'turnEnded':
      // An ordinary finish needs no line of its own; anything else does.
      if (event.stopReason === 'end_turn') return entries
      return [
        ...entries,
        {
          id: nextId(),
          kind: 'note',
          tone: 'quiet',
          text: STOP_REASON[event.stopReason] ?? `Turn ended: ${event.stopReason}`,
        },
      ]
    case 'error':
      return [
        ...entries,
        {
          id: nextId(),
          kind: 'note',
          tone: 'error',
          // The one failure an author can actually fix from here. The agent's
          // wording buries it in JSON; say what to do about it.
          text: /authenticat/i.test(event.message)
            ? `${event.message}\n\nThe agent's sign-in has lapsed. Run its CLI in a terminal (e.g. \`claude\`), sign in, then start a new session here.`
            : event.message,
        },
      ]
    case 'stopped':
      return [
        ...entries,
        { id: nextId(), kind: 'note', tone: 'quiet', text: 'Session ended.' },
      ]
    case 'started':
    // Session state, absorbed before the transcript; nothing to add here.
    case 'options':
    case 'commands':
      return entries
  }
}

const STOP_REASON: Record<string, string> = {
  cancelled: 'You stopped this turn.',
  refusal: 'The agent declined to answer.',
  max_tokens: 'The agent ran out of room to answer.',
  max_turn_requests: 'The agent hit its limit for one turn.',
}

// ——— Choosing an agent ———

function AgentPicker({
  agents,
  documentPath,
  documentName,
  starting,
  onSave,
  onStart,
}: {
  agents: AgentInfo[]
  documentPath: string | null
  documentName: string
  starting: string | null
  onSave: () => void
  onStart: (agent: AgentInfo) => void
}) {
  const ready = (agent: AgentInfo) => agent.available && documentPath !== null

  if (!documentPath) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-6">
        <h3 className="text-[15px] font-[var(--essay-weight-medium)] tracking-[-0.01em] text-[var(--essay-text)]">
          Save to start a chat.
        </h3>
        <p className="mt-1.5 max-w-72 text-[12px] leading-[1.55] text-[var(--essay-text-muted)]">
          Agents work on the Markdown file and return edits for review.
        </p>
        <button
          type="button"
          onClick={onSave}
          className="mt-4 flex h-8 items-center rounded-md bg-[var(--essay-text)] px-3 text-[12px] font-[var(--essay-weight-medium)] text-[var(--essay-bg)] transition-opacity duration-[var(--essay-speed-quick)] hover:opacity-88 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--essay-accent)]"
        >
          Save document
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-5">
      <h3 className="mb-1 px-1 text-[14px] font-[var(--essay-weight-medium)] text-[var(--essay-text)]">
        Choose an agent
      </h3>
      <p className="mb-3 px-1 text-[11.5px] leading-[1.55] text-[var(--essay-text-muted)]">
        Choose who writes alongside you in <DocumentChip>{documentName}</DocumentChip>.
      </p>
      <ul className="flex flex-col gap-1">
        {agents.map((agent) => (
          <li key={agent.id}>
            <button
              type="button"
              disabled={!ready(agent) || starting !== null}
              onClick={() => onStart(agent)}
              className={cn(
                'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
                'transition-colors duration-100',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
                ready(agent)
                  ? 'hover:bg-[var(--essay-surface-hover)]'
                  : 'cursor-default',
              )}
            >
              {starting === agent.id ? (
                <BusyIcon
                  size={14}
                  aria-hidden
                  className="shrink-0 text-[var(--essay-accent)] motion-safe:animate-spin"
                />
              ) : (
                <ConnectIcon
                  size={14}
                  aria-hidden
                  className={cn(
                    'shrink-0',
                    ready(agent)
                      ? 'text-[var(--essay-text-muted)]'
                      : 'text-[var(--essay-text-faint)]',
                  )}
                />
              )}
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-[13px] font-[var(--essay-weight-medium)]',
                    ready(agent)
                      ? 'text-[var(--essay-text)]'
                      : 'text-[var(--essay-text-muted)]',
                  )}
                >
                  {agent.name}
                </span>
                {/* The command is the answer to "why is this greyed out?" —
                    it names the thing that has to be on PATH. */}
                <span className="block truncate font-(family-name:--essay-font-mono) text-[10px] text-[var(--essay-text-muted)]">
                  {agent.available ? agent.command : `${agent.command} — not on PATH`}
                </span>
              </span>
              {ready(agent) && (
                <span className="shrink-0 text-[10px] font-[var(--essay-weight-medium)] text-[var(--essay-accent)]">
                  Start
                </span>
              )}
            </button>
          </li>
        ))}
        {agents.length === 0 && (
          // A sentence, not an empty-state card: nothing was expected to be
          // here yet, so there is nothing to frame.
          <li className="px-1 py-3 text-[12px] leading-[1.6] text-[var(--essay-text-muted)]">
            No local agent is ready. Essay looks for{' '}
            <code className="font-(family-name:--essay-font-mono) text-[var(--essay-text-muted)]">
              opencode
            </code>{' '}
            and{' '}
            <code className="font-(family-name:--essay-font-mono) text-[var(--essay-text-muted)]">
              claude
            </code>{' '}
            on your PATH.
          </li>
        )}
      </ul>
    </div>
  )
}

function DocumentChip({ children }: { children: ReactNode }) {
  return (
    <span className="font-[var(--essay-weight-medium)] text-[var(--essay-text)]">
      {children}
    </span>
  )
}

// ——— The queue ———

function ChangesBlock({
  pending,
  applied,
  settled,
  onReviewChange,
  onRejectChange,
  onReviewApplied,
}: {
  pending: ChangeSet[]
  applied: AppliedEdit[]
  settled: Array<ChangeSet | AppliedEdit>
  onReviewChange: (change: ChangeSet) => void
  onRejectChange: (change: ChangeSet) => void
  onReviewApplied: (edit: AppliedEdit) => void
}) {
  const [showSettled, setShowSettled] = useState(false)
  const waiting = pending.length + applied.length

  if (waiting === 0 && settled.length === 0) return null

  return (
    <section
      aria-label="Changes"
      // No fill here: each row below carries its own surface + hairline
      // card, and a tinted tray around them would be a box around boxes —
      // exactly the noise a calm queue can't afford.
      className="mx-2 max-h-[46%] shrink-0 overflow-y-auto rounded-lg bg-[color-mix(in_oklab,var(--essay-surface)_48%,transparent)] px-2 py-2"
    >
      <div className="mb-1 flex items-center gap-2 px-1">
        {/* 11px faint uppercase — the same micro-heading the outline pane and
            the diff surface already use, so the panel reads as part of the
            chrome rather than a visitor in it. */}
        <h3 className="text-[11px] font-[510] tracking-wider text-[var(--essay-text-muted)] uppercase">
          Review changes
        </h3>
        <span className="text-[11px] tabular-nums text-[var(--essay-text-faint)]">
          {waiting}
        </span>
        {settled.length > 0 && (
          <button
            type="button"
            aria-expanded={showSettled}
            onClick={() => setShowSettled((on) => !on)}
            className="ml-auto rounded-md px-1 py-0.5 text-[10px] text-[var(--essay-text-faint)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
          >
            {showSettled ? 'Hide settled' : `${settled.length} settled`}
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {applied.map((edit) => (
          <li key={edit.id}>
            <ChangeRow
              tone="applied"
              title={baseName(edit.file)}
              detail={`${edit.agent} wrote this itself · ${relativeTime(edit.at)}`}
              inserted={edit.diff?.stats.wordsInserted ?? 0}
              removed={edit.diff?.stats.wordsRemoved ?? 0}
              rewrite={edit.looksLikeARewrite}
              onOpen={() => onReviewApplied(edit)}
            />
          </li>
        ))}
        {pending.map((change) => (
          <li key={change.id}>
            <ChangeRow
              tone="proposal"
              title={baseName(change.file)}
              detail={`${change.provenance.agent} · ${relativeTime(change.provenance.timestampMillis)}`}
              inserted={change.diff.stats.wordsInserted}
              removed={change.diff.stats.wordsRemoved}
              rewrite={change.looksLikeARewrite}
              onOpen={() => onReviewChange(change)}
              // Declining needs no review — nothing was ever written.
              onDismiss={() => onRejectChange(change)}
            />
          </li>
        ))}
      </ul>

      {showSettled && (
        <ul className="mt-2 flex flex-col gap-0.5">
          {settled.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-2 px-1 py-1 text-[11px] text-[var(--essay-text-faint)]"
            >
              <span className="truncate">
                {baseName(entry.file)}
              </span>
              <span className="ml-auto shrink-0">
                {'status' in entry ? entry.status : entry.settled}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * One waiting decision.
 *
 * The pill is the whole point of the row: `proposal` means the file is
 * untouched and accepting is what writes it; `on disk` means an agent already
 * wrote it and the verb on offer is revert. Same list, because the author
 * wants one place to look — different words, because they are different facts.
 */
function ChangeRow({
  tone,
  title,
  detail,
  inserted,
  removed,
  rewrite,
  onOpen,
  onDismiss,
}: {
  tone: 'proposal' | 'applied'
  title: string
  detail: string
  inserted: number
  removed: number
  rewrite: boolean
  onOpen: () => void
  onDismiss?: () => void
}) {
  const applied = tone === 'applied'
  return (
    // One quiet row language for both arrival paths — soft surface and an
    // 8px radius — so a PROPOSAL and an ON DISK row read as the same *kind*
    // of thing (a decision waiting) and only the label and the words beneath
    // it say which kind. The old red-tinted fill for "on disk" made an
    // unreviewed write look like an error; it isn't one, it's a fact to act
    // on, and it does not need alarm colour to be taken seriously.
    <div
      className={cn(
        'essay-pop flex items-center gap-2 rounded-lg bg-[color-mix(in_oklab,var(--essay-surface)_66%,transparent)] px-2 py-1.5',
        'transition-colors duration-100 hover:bg-[var(--essay-surface-hover)]',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--essay-accent)]"
      >
        <span className="flex items-center gap-1.5">
          {/* Provenance as a tiny caps label in faint ink, not a chip: it
              only has to be legible, not shouted — the file name and the
              verb this row leads to (Accept/Reject or Revert/Keep it, once
              opened) carry the actual weight. */}
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[9px] font-[var(--essay-weight-semibold)] tracking-wide text-[var(--essay-text-faint)] uppercase">
            {applied ? <OnDiskIcon size={9} aria-hidden /> : null}
            {applied ? 'on disk' : 'proposal'}
          </span>
          <span className="min-w-0 truncate text-[12px] font-[var(--essay-weight-medium)] text-[var(--essay-text)]">
            {title}
          </span>
          {rewrite && (
            // Accent-tint, matching every other place Essay flags something
            // worth a second look — a rewrite is a bigger decision, not a
            // worse one, so it does not reach for alarm colour either.
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-[4px] bg-[var(--essay-accent-tint)] px-1 text-[9px] font-[var(--essay-weight-semibold)] tracking-wide text-[var(--essay-text)] uppercase"
              title="Most of the document changed — this reads as a rewrite, not an edit"
            >
              <RetryIcon size={9} weight="bold" aria-hidden />
              rewrite
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="min-w-0 truncate text-[10px] text-[var(--essay-text-muted)]">
            {detail}
          </span>
          <span
            className="ml-auto shrink-0 text-[10px] tabular-nums"
            aria-label={`${inserted} words added, ${removed} removed`}
          >
            <span className="text-[var(--essay-diff-insert)]">+{inserted}</span>
            <span className="text-[var(--essay-text-faint)]">/</span>
            <span className="text-[var(--essay-diff-remove)]">−{removed}</span>
          </span>
        </span>
        <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-[var(--essay-weight-medium)] text-[var(--essay-accent)]">
          Review diff
          <ExpandIcon size={9} aria-hidden />
        </span>
      </button>
      {onDismiss ? (
        <IconButton
          onClick={onDismiss}
          aria-label={`Reject the proposal for ${title}`}
          title="Reject — the file was never touched"
          className="h-6 w-6"
        >
          <CloseIcon size={12} />
        </IconButton>
      ) : (
        // Decorative only — reverting happens inside the review this row
        // opens, not from the glyph itself — so it stays as quiet as the
        // label beside it rather than borrowing the danger colour a live
        // revert control would have earned.
        <RevertIcon
          size={12}
          aria-hidden
          className="shrink-0 text-[var(--essay-text-faint)]"
        />
      )}
    </div>
  )
}

// ——— Transcript ———

function TranscriptEntry({ entry }: { entry: Entry }) {
  switch (entry.kind) {
    case 'prompt':
      // Same size and leading as the agent's own replies. The quieter ink is
      // enough to distinguish the author's line without introducing a rule,
      // bubble, or chat-app chrome into the margin.
      return (
        <li className="text-[13px] leading-[1.6] font-[var(--essay-weight-medium)] whitespace-pre-wrap text-[var(--essay-text-muted)]">
          {entry.text}
        </li>
      )
    case 'message':
      return (
        <li className="text-[13px] leading-[1.6] whitespace-pre-wrap text-[var(--essay-text)]">
          {entry.text}
        </li>
      )
    case 'thought':
      return <Thought text={entry.text} />
    case 'tool':
      return (
        <ToolRow
          title={entry.title}
          status={entry.status}
          toolKind={entry.toolKind}
          locations={entry.locations}
        />
      )
    case 'plan':
      return <Plan entries={entry.entries} />
    case 'note':
      // Notes remain typography. The error icon and ink supply the state;
      // neither voice needs a rule or bubble around it.
      return (
        <li
          className={cn(
            'py-0.5 text-[11px] leading-[1.5]',
            entry.tone === 'error'
              ? 'text-[var(--essay-text)]'
              : 'px-1 text-[var(--essay-text-muted)]',
          )}
        >
          {entry.tone === 'error' && (
            <ErrorIcon
              size={11}
              weight="bold"
              aria-hidden
              className="mr-1 inline-block align-[-1px] text-[var(--essay-diff-remove)]"
            />
          )}
          {entry.text}
        </li>
      )
  }
}

/**
 * Reasoning, kept subordinate to the answer: smaller, fainter, clamped to two
 * lines until asked for. It is how the agent got there, not what it said, and
 * a transcript where the two look alike reads as twice as much text.
 */
function Thought({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((on) => !on)}
        className="flex w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
      >
        <ThinkingIcon
          size={11}
          aria-hidden
          className="mt-[3px] shrink-0 text-[var(--essay-text-faint)]"
        />
        <span
          className={cn(
            // Muted rather than faint: it is several lines of reading, not a
            // label, and faint ink measures 3.4:1 at this size. Italic, 11px
            // and a clamp are what keep it subordinate to the answer.
            'min-w-0 flex-1 text-[11px] leading-[1.5] whitespace-pre-wrap text-[var(--essay-text-muted)] italic',
            !open && 'line-clamp-2',
          )}
        >
          {text}
        </span>
      </button>
    </li>
  )
}

const TOOL_ICON: Record<string, Icon> = {
  read: DocumentIcon,
  edit: EditIcon,
  execute: ToolIcon,
  think: ThinkingIcon,
}

/** Compact enough to skim a dozen of them; never a wall of JSON. */
function ToolRow({
  title,
  status,
  toolKind,
  locations,
}: {
  title: string
  status: string
  toolKind: string
  locations: string[]
}) {
  const Glyph = TOOL_ICON[toolKind] ?? MoreIcon
  const failed = status === 'failed'
  const done = status === 'completed'
  const busy = status === 'in_progress' || status === 'pending'

  return (
    <li className="flex items-center gap-2 px-1 py-0.5">
      <Glyph
        size={11}
        aria-hidden
        className={cn(
          'shrink-0',
          failed
            ? 'text-[var(--essay-diff-remove)]'
            : 'text-[var(--essay-text-faint)]',
        )}
      />
      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--essay-text-muted)]">
        {title || toolKind}
        {locations.length > 0 && (
          <span className="ml-1.5 font-(family-name:--essay-font-mono) text-[10px] text-[var(--essay-text-faint)]">
            {locations.map(baseName).join(', ')}
          </span>
        )}
      </span>
      <span className="shrink-0" title={status}>
        {busy && (
          <BusyIcon
            size={11}
            aria-label="running"
            className="text-[var(--essay-text-faint)] motion-safe:animate-spin"
          />
        )}
        {done && (
          <AcceptIcon
            size={11}
            weight="fill"
            aria-label="done"
            className="text-[var(--essay-diff-insert)]"
          />
        )}
        {failed && (
          <RejectIcon
            size={11}
            weight="bold"
            aria-label="failed"
            className="text-[var(--essay-diff-remove)]"
          />
        )}
      </span>
    </li>
  )
}

function Plan({ entries }: { entries: PlanEntry[] }) {
  const [open, setOpen] = useState(true)
  const done = entries.filter((entry) => entry.status === 'completed').length
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((on) => !on)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--essay-accent)]"
      >
        {open ? (
          <CollapseIcon size={10} aria-hidden className="text-[var(--essay-text-faint)]" />
        ) : (
          <ExpandIcon size={10} aria-hidden className="text-[var(--essay-text-faint)]" />
        )}
        <span className="text-[10px] font-[510] tracking-wider text-[var(--essay-text-faint)] uppercase">
          Plan
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-[var(--essay-text-faint)]">
          {done}/{entries.length}
        </span>
      </button>
      {open && (
        <ul className="px-2 pb-1.5">
          {entries.map((entry, index) => (
            <li
              key={`${index}-${entry.content}`}
              className={cn(
                'flex items-start gap-1.5 py-[2px] text-[11px] leading-[1.45]',
                entry.status === 'completed'
                  ? 'text-[var(--essay-text-faint)] line-through'
                  : 'text-[var(--essay-text-muted)]',
              )}
            >
              <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-current" />
              {entry.content}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * The agent's slash-commands, shown while the draft starts with `/`.
 *
 * ACP sends these as data (`available_commands_update`) but they are typed as
 * text: picking one just completes the draft, and the agent parses it out of
 * the prompt like it would from any terminal.
 */
function CommandHints({
  commands,
  draft,
  onPick,
}: {
  commands: AgentCommand[]
  draft: string
  onPick: (name: string) => void
}) {
  const typed = draft.slice(1).split(/\s/, 1)[0].toLowerCase()
  const matches = commands
    .filter((command) => command.name.toLowerCase().startsWith(typed))
    .slice(0, 6)
  if (matches.length === 0) return null

  return (
    <div className="max-h-[180px] shrink-0 overflow-y-auto px-2 py-1">
      {matches.map((command) => (
        <button
          key={command.name}
          type="button"
          onClick={() => onPick(command.name)}
          className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--essay-accent)]"
        >
          <span className="shrink-0 font-(family-name:--essay-font-mono) text-[11px] text-[var(--essay-text)]">
            /{command.name}
          </span>
          {command.inputHint && (
            <span className="shrink-0 font-(family-name:--essay-font-mono) text-[10px] text-[var(--essay-text-faint)]">
              {command.inputHint}
            </span>
          )}
          <span className="min-w-0 truncate text-[11px] text-[var(--essay-text-muted)]">
            {command.description}
          </span>
        </button>
      ))}
    </div>
  )
}

// ——— Decisions and input ———

/**
 * A permission ask. Loud enough not to be missed and quiet enough not to be a
 * modal — the agent is blocked, the author is not.
 */
function PermissionCard({
  request,
  onAnswer,
}: {
  request: PermissionRequest
  onAnswer: (optionId: string | null) => void
}) {
  return (
    <section
      aria-label={`${request.agentName} needs a decision`}
      className="essay-pop mx-2 shrink-0 rounded-lg bg-[color-mix(in_oklab,var(--essay-surface)_58%,transparent)] px-3 py-2.5"
    >
      {/* The live region is the sentence, not the card: an alert wrapping
          buttons is announced as text and then fought over by the reader. */}
      <p role="status" className="text-[11px] text-[var(--essay-text-muted)]">
        {request.agentName} needs a decision
      </p>
      <p className="mt-0.5 text-[12px] leading-[1.5] text-[var(--essay-text)]">
        {request.title || 'No description given.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {request.options.map((option) => {
          const allows = option.kind.startsWith('allow')
          return (
            <button
              key={option.optionId}
              type="button"
              onClick={() => onAnswer(option.optionId)}
              className={cn(
                'h-6 rounded-md px-2 text-[11px] font-[var(--essay-weight-medium)]',
                'transition-colors duration-100',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
                allows
                  ? 'bg-[var(--essay-text)] text-[var(--essay-bg)] hover:opacity-88'
                  : 'text-[var(--essay-text-muted)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]',
              )}
            >
              {option.name}
            </button>
          )
        })}
        {request.options.length === 0 && (
          <button
            type="button"
            onClick={() => onAnswer(null)}
            className="h-6 rounded-md px-2 text-[11px] text-[var(--essay-text-muted)] hover:bg-[var(--essay-surface-hover)]"
          >
            Cancel
          </button>
        )}
      </div>
    </section>
  )
}

function Composer({
  value,
  running,
  agentName,
  onChange,
  onSend,
  onInterrupt,
}: {
  value: string
  running: boolean
  agentName: string
  onChange: (value: string) => void
  onSend: () => void
  onInterrupt: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Grow to fit, then scroll. Six lines is about as much instruction as
  // anybody types before they would rather be writing it in the manuscript.
  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 132)}px`
  }, [value])

  return (
    <div className="shrink-0 p-2">
      <div className="rounded-lg bg-[color-mix(in_oklab,var(--essay-surface)_42%,transparent)] transition-colors duration-100 focus-within:bg-[color-mix(in_oklab,var(--essay-surface)_68%,transparent)]">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSend()
            }
          }}
          placeholder={
            running ? `${agentName} is working…` : `Ask ${agentName} to…`
          }
          className="block max-h-[132px] w-full resize-none bg-transparent px-2.5 py-2 text-[12px] leading-[1.5] text-[var(--essay-text)] outline-none placeholder:text-[var(--essay-text-faint)]"
        />
        <div className="flex items-center gap-2 px-2 pb-1.5">
          <span className="text-[10px] text-[var(--essay-text-faint)]">
            Enter to send · Shift+Enter for a new line
          </span>
          {running ? (
            <button
              type="button"
              onClick={onInterrupt}
              className="ml-auto flex h-6 items-center gap-1 rounded-md bg-[var(--essay-surface-hover)] px-2 text-[11px] font-[var(--essay-weight-medium)] text-[var(--essay-text)] transition-colors duration-100 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
            >
              <StopIcon size={10} weight="fill" aria-hidden />
              Stop
            </button>
          ) : (
            <IconButton
              onClick={onSend}
              disabled={!value.trim()}
              aria-label={`Send to ${agentName}`}
              className="ml-auto h-6 w-6 text-[var(--essay-accent)]"
            >
              <SendIcon size={13} weight="fill" />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  )
}
