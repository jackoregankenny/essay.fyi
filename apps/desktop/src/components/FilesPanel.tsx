import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { IconClose, IconFolders } from './icons'
import { IconButton } from './ui/icon-button'
import { ExplorerContent, useExplorer } from './ExplorerPane'
import { loadRecentFiles } from '#/lib/recents'

/** How long the exit animation gets before the panel really unmounts. Must
    agree with `--essay-speed-quick` (0.1s) — the closing transition below
    uses that token, and a timeout shorter than it would cut the fade off. */
const CLOSE_MS = 100

/**
 * The popover's two sizes: the everyday answer and the deep one. Recents is
 * a hand's-width list — the file you were just in, one click away. Browse
 * grows the same panel in place into a floating sidebar holding the full
 * workspace trees. The stage is remembered: an author who lives in the
 * trees reopens into them.
 */
type Stage = 'recents' | 'browse'

const STAGE_KEY = 'essay.files.stage.v1'

function loadStage(): Stage {
  try {
    return localStorage.getItem(STAGE_KEY) === 'browse' ? 'browse' : 'recents'
  } catch {
    return 'recents'
  }
}

function saveStage(stage: Stage): void {
  try {
    localStorage.setItem(STAGE_KEY, stage)
  } catch {
    // A popover that cannot remember its size is still a popover.
  }
}

export interface FilesPanelProps {
  open: boolean
  /** The panel has finished closing. The caller owns focus from here —
      `Workspace` should refocus the editor (`editor?.commands.focus()`),
      exactly as it does when the command palette hands the page back. */
  onClose: () => void
  /** Open a document by absolute path. Called at the moment the exit
      animation completes, so the manuscript never repaints under a
      still-visible panel. */
  onOpenFile: (absolutePath: string) => void
}

/**
 * Files, out of the button (Jack, 2026-08-07): an anchored popover that
 * grows from the folders control the way the Mac download stack grows from
 * its dock icon — not a centred modal, no dimmed screen. It opens small
 * (recent files), expands in place for deeper exploration, and closes on
 * Esc or a click anywhere else. The screen keeps its light throughout:
 * reaching for a file is a glance, not a mode.
 *
 * Hand-rolled rather than Base UI Dialog, deliberately: the rc.0 Root would
 * have to be mounted conditionally anyway (its popup never unmounts when a
 * controlled `open` flips false), and its focus trap fights the one thing
 * the close path must guarantee — that focus returns to the editor, which
 * the caller does after `onClose`.
 */
export function FilesPanel({ open, onClose, onOpenFile }: FilesPanelProps) {
  // Conditional mount: the browse stage runs `useExplorer`, whose root
  // watcher must live exactly as long as the trees are on screen.
  if (!open) return null
  return <FilesPopover onClose={onClose} onOpenFile={onOpenFile} />
}

function FilesPopover({
  onClose,
  onOpenFile,
}: {
  onClose: () => void
  onOpenFile: (absolutePath: string) => void
}) {
  const [stage, setStage] = useState<Stage>(loadStage)
  // Read once per summons: the list is already newest-first, and a file
  // opened from this very popover re-sorts it for the next open.
  const recents = useMemo(() => loadRecentFiles(), [])

  // Entrance/exit choreography, same shape as CommandPalette: a freshly
  // mounted popover cannot CSS-transition its own arrival, so `entered`
  // flips a double-rAF after mount — raced against a timeout, because a
  // suspended-rAF environment (occluded window, embedded webview) would
  // otherwise leave the panel permanently invisible.
  const [entered, setEntered] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)
  // Read once per summons, not subscribed: a preference toggled mid-open can
  // wait for the next open.
  const reduceMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  useEffect(() => {
    let inner: number | null = null
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true))
    })
    const fallback = window.setTimeout(() => setEntered(true), 50)
    return () => {
      cancelAnimationFrame(outer)
      if (inner !== null) cancelAnimationFrame(inner)
      clearTimeout(fallback)
      if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    }
  }, [])

  /** Play the exit, then tell the caller. `after` runs at the flip — opening
      a file must not repaint the manuscript under a panel still fading. A
      second close request during the window is dropped, so a double-click
      opens one file, once. */
  const requestClose = (after?: () => void) => {
    if (closing) return
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      onClose()
      after?.()
    }, CLOSE_MS)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      requestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // `closing` only ever goes false→true and the guard inside makes a
    // stale closure harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grow = (next: Stage) => {
    setStage(next)
    saveStage(next)
  }

  const settled = entered && !closing

  // The whole gesture: the panel grows out of the button. Origin top-left
  // (the button's corner), a small scale-and-rise on entry, and a stage
  // change animates width and height in place — the popover *becomes* the
  // floating sidebar rather than being replaced by one. Width/height are
  // layout properties, but this is a one-shot transition on a popover, not
  // per-frame work under typing.
  const panelStyle: CSSProperties = {
    transformOrigin: 'top left',
    width: stage === 'browse' ? 420 : 304,
    maxHeight: stage === 'browse' ? '72vh' : 420,
    ...(reduceMotion
      ? { opacity: settled ? 1 : 0 }
      : {
          opacity: settled ? 1 : 0,
          transform: closing
            ? 'scale(0.97) translateY(-4px)'
            : entered
              ? 'none'
              : 'scale(0.9) translateY(-8px)',
          transition: closing
            ? 'opacity var(--essay-speed-quick) var(--essay-ease-out), transform var(--essay-speed-quick) var(--essay-ease-out)'
            : 'opacity 0.18s var(--essay-ease-out-quint), transform 0.18s var(--essay-ease-out-quint), width 0.2s var(--essay-ease-out-quint), max-height 0.2s var(--essay-ease-out-quint)',
        }),
  }

  return (
    <>
      {/* Click-away, not a backdrop: the screen keeps its light. */}
      <div
        className="fixed inset-0 z-40"
        onMouseDown={() => requestClose()}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label="Files"
        style={panelStyle}
        className="fixed top-11 left-3 z-50 flex flex-col overflow-hidden rounded-xl border border-[var(--essay-border)] bg-[var(--essay-surface)] shadow-[var(--essay-shadow-palette)] outline-none"
      >
        {stage === 'recents' ? (
          <RecentsBody
            recents={recents}
            onOpen={(path) => requestClose(() => onOpenFile(path))}
            onBrowse={() => grow('browse')}
          />
        ) : (
          <BrowseBody
            onOpen={(path) => requestClose(() => onOpenFile(path))}
            onShrink={() => grow('recents')}
            onRequestClose={() => requestClose()}
          />
        )}
      </div>
    </>
  )
}

/** Stage one: the last few documents, then the door to the trees. */
function RecentsBody({
  recents,
  onOpen,
  onBrowse,
}: {
  recents: ReturnType<typeof loadRecentFiles>
  onOpen: (path: string) => void
  onBrowse: () => void
}) {
  return (
    <>
      <div className="flex h-8 shrink-0 items-center px-3">
        <span className="text-[10px] font-[510] tracking-wider text-[var(--essay-text-faint)] uppercase">
          Recent
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1">
        {recents.length === 0 ? (
          <p className="px-2 py-2 text-[13px] leading-relaxed text-[var(--essay-text-faint)]">
            Documents you open gather here.
          </p>
        ) : (
          recents.slice(0, 8).map((recent) => (
            <button
              key={recent.path}
              type="button"
              title={recent.path}
              onClick={() => onOpen(recent.path)}
              className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-[var(--essay-text-muted)] transition-colors duration-[var(--essay-speed-quick)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
            >
              <span className="min-w-0 flex-1 truncate">{recent.name}</span>
              <span className="shrink-0 text-[11px] text-[var(--essay-text-faint)]">
                {parentLabel(recent.path)}
              </span>
            </button>
          ))
        )}
      </div>
      <button
        type="button"
        onClick={onBrowse}
        className="flex h-9 shrink-0 items-center gap-2 border-t border-[var(--essay-border)] px-3 text-[12px] text-[var(--essay-text-muted)] transition-colors duration-[var(--essay-speed-quick)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
      >
        <IconFolders size={14} className="text-[var(--essay-text-faint)]" />
        Browse folders
        <span aria-hidden className="ml-auto text-[var(--essay-text-faint)]">
          ⌄
        </span>
      </button>
    </>
  )
}

/**
 * Stage two: the floating sidebar. Mounted only while browsing, so the
 * explorer's root watcher lives exactly as long as the trees are visible.
 */
function BrowseBody({
  onOpen,
  onShrink,
  onRequestClose,
}: {
  onOpen: (path: string) => void
  onShrink: () => void
  onRequestClose: () => void
}) {
  const explorer = useExplorer()
  const count = explorer.folders.length

  return (
    <>
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--essay-border)] px-3">
        <IconFolders size={14} className="text-[var(--essay-text-faint)]" />
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-[510] text-[var(--essay-text)]">
          Files
          {count > 0 && (
            <span className="text-[11px] font-normal text-[var(--essay-text-faint)]">
              · {count === 1 ? '1 folder' : `${count} folders`}
            </span>
          )}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={!explorer.desktop}
            title={
              explorer.desktop ? undefined : 'Available in the desktop app'
            }
            onClick={() => void explorer.addFolder()}
            className="flex h-6 items-center rounded-md border border-[var(--essay-border)] px-2 text-[12px] text-[var(--essay-text-muted)] transition-colors duration-[var(--essay-speed-quick)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] disabled:pointer-events-none disabled:opacity-40"
          >
            Add folder
          </button>
          <IconButton
            className="h-6 w-6"
            title="Back to recents"
            onClick={onShrink}
          >
            <span aria-hidden className="text-[12px] leading-none">
              ⌃
            </span>
          </IconButton>
          <IconButton
            className="h-6 w-6"
            aria-label="Close"
            onClick={onRequestClose}
          >
            <IconClose size={13} />
          </IconButton>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <ExplorerContent explorer={explorer} onOpenFile={onOpen} />
      </div>
    </>
  )
}

/** The folder a document sits in — the row's quiet answer to "which one". */
function parentLabel(path: string): string {
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 2] ?? ''
}
