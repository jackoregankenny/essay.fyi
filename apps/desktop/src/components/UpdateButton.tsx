// Auto-update, kept out of the author's way.
//
// Essay checks shortly after launch and hourly after that, fetches a new
// version in the background, and then waits. A writing tool that restarts
// itself mid-sentence has taken something no update is worth, so the restart
// is always the author's to press — and pressing it only restarts when the
// manuscript is on disk and no agent is mid-turn.
//
// Everything here is best effort. There is no updater at all in the browser
// dev preview, and a check that fails is a console line: an author who cannot
// reach GitHub still has a working editor, and telling them so in red over
// their paragraph would be the intrusive version of this feature.

import { useCallback, useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { ArrowsClockwise } from '@phosphor-icons/react'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { listAgentSessions } from '#/lib/agents'
import { cn } from '#/lib/cn'
import { IconButton } from './ui/icon-button'
import { Tip } from './ui/tooltip'

/** How long after launch the first check runs. Late enough that it never
    competes with the first paint or the author's first keystroke, soon enough
    that a version released overnight is found in the morning. */
const FIRST_CHECK_DELAY = 15_000

/** How often Essay looks again while it stays open. */
const CHECK_INTERVAL = 60 * 60 * 1000

/** How long "Up to date" stays on screen after a check the author asked for.
    A background check that finds nothing says nothing at all. */
const UP_TO_DATE_LINGER = 4_000

type Status =
  | { phase: 'idle' }
  | { phase: 'checking' }
  /** `percent` is null until the server has told us how big the download is. */
  | { phase: 'downloading'; percent: number | null }
  | { phase: 'ready'; version: string }
  | { phase: 'current' }

export function UpdateButton({ documentsSaved }: { documentsSaved: boolean }) {
  const [status, setStatus] = useState<Status>({ phase: 'idle' })
  const [agentsRunning, setAgentsRunning] = useState(false)

  /** The downloaded update, waiting on a restart. Held rather than installed
      so the bytes are fetched once, and so nothing touches the installed app
      until the author says now. */
  const readyRef = useRef<Update | null>(null)
  /** Single-flight: a focus event during the hourly poll must not start a
      second check on top of the first. */
  const checking = useRef(false)
  const lastCheck = useRef(0)

  const runCheck = useCallback(async (manual: boolean) => {
    if (!isTauri()) return
    // Once an update is downloaded there is nothing left to look for: this
    // process cannot become the new version, so further polling is only
    // traffic. The next launch starts the cycle again.
    if (checking.current || readyRef.current) return
    checking.current = true
    lastCheck.current = Date.now()
    if (manual) setStatus({ phase: 'checking' })

    try {
      const update = await check()
      if (!update) {
        setStatus(manual ? { phase: 'current' } : { phase: 'idle' })
        return
      }

      setStatus({ phase: 'downloading', percent: null })
      let received = 0
      let total: number | null = null
      let shown = -1
      await update.download((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? null
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength
          if (!total) return
          // Chunks arrive in the hundreds; only a changed whole percent is
          // worth a render.
          const percent = Math.min(99, Math.floor((received / total) * 100))
          if (percent === shown) return
          shown = percent
          setStatus({ phase: 'downloading', percent })
        }
      })

      readyRef.current = update
      setStatus({ phase: 'ready', version: update.version })
    } catch (error) {
      // No release yet, no network, a signature that does not verify — all
      // the same to someone in the middle of a paragraph.
      console.warn('[essay] update check failed', error)
      setStatus({ phase: 'idle' })
    } finally {
      checking.current = false
    }
  }, [])

  /** Whether restarting would interrupt an agent. Agents are subprocesses
      holding a turn; killing one loses whatever it was about to say. */
  const refreshAgents = useCallback(async () => {
    const sessions = await listAgentSessions().catch(() => [])
    const running = sessions.length > 0
    setAgentsRunning(running)
    return running
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    const first = setTimeout(() => void runCheck(false), FIRST_CHECK_DELAY)
    const poll = setInterval(() => void runCheck(false), CHECK_INTERVAL)
    // A laptop that slept through four polls fires none of them, and the
    // hour that matters is wall-clock rather than timer time — so coming back
    // to the window is its own trigger, when the last look is stale.
    const onFocus = () => {
      if (Date.now() - lastCheck.current >= CHECK_INTERVAL) void runCheck(false)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      clearTimeout(first)
      clearInterval(poll)
      window.removeEventListener('focus', onFocus)
    }
  }, [runCheck])

  // Whether the restart is on offer depends on what the agents are doing, so
  // the answer is refreshed while an update waits. The click re-asks anyway;
  // this is only so the label is not lying in the meantime.
  useEffect(() => {
    if (status.phase !== 'ready') return
    void refreshAgents()
    const onFocus = () => void refreshAgents()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [status.phase, refreshAgents])

  useEffect(() => {
    if (status.phase !== 'current') return
    const timer = setTimeout(() => setStatus({ phase: 'idle' }), UP_TO_DATE_LINGER)
    return () => clearTimeout(timer)
  }, [status.phase])

  const restart = useCallback(
    async (update: Update) => {
      // Asked again at the moment of the click: a session can have started,
      // or a save landed, since the label was drawn.
      const busy = await refreshAgents()
      if (busy || !documentsSaved) return
      try {
        // On Windows this hands over to the NSIS installer and the process
        // ends inside `install()` — the relaunch below is what applies the
        // update on the platforms where installing does return.
        await update.install()
        await relaunch()
      } catch (error) {
        console.warn('[essay] update install failed', error)
      }
    },
    [documentsSaved, refreshAgents],
  )

  if (status.phase === 'idle') {
    return (
      <Tip
        label="Check for updates"
        trigger={
          <IconButton
            onClick={() => void runCheck(true)}
            className="text-[var(--essay-text-faint)]"
          >
            <ArrowsClockwise size={14} />
          </IconButton>
        }
      />
    )
  }

  const update = readyRef.current
  const canRestart = status.phase === 'ready' && documentsSaved && !agentsRunning

  const label =
    status.phase === 'checking'
      ? 'Checking…'
      : status.phase === 'downloading'
        ? status.percent === null
          ? 'Downloading…'
          : `Downloading… ${status.percent}%`
        : status.phase === 'current'
          ? 'Up to date'
          : canRestart
            ? 'Restart to update'
            : 'Update ready — applies next launch'

  return (
    <button
      type="button"
      onClick={() => {
        if (status.phase === 'ready' && update) void restart(update)
        else if (status.phase !== 'downloading') void runCheck(true)
      }}
      // Why the restart is not on offer is the one thing worth spelling out:
      // "update ready" with nothing happening when you press it is how a
      // control teaches an author to stop pressing it.
      title={
        status.phase !== 'ready'
          ? undefined
          : canRestart
            ? `Essay ${status.version} is downloaded — restart to use it`
            : agentsRunning
              ? `Essay ${status.version} is downloaded. Waiting for the agent to finish.`
              : `Essay ${status.version} is downloaded. Waiting for your work to be saved.`
      }
      className={cn(
        'flex h-7 shrink-0 items-center rounded-md px-2 text-[11px] whitespace-nowrap',
        'text-[var(--essay-text-muted)] transition-colors duration-100',
        'hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]',
        // Coloured only when pressing it does something — the one state where
        // the chrome is asking for an answer rather than reporting.
        canRestart && 'text-[var(--essay-accent)]',
      )}
    >
      {label}
    </button>
  )
}
