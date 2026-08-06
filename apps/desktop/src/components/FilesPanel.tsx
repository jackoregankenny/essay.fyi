import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { IconClose, IconFolders } from './icons'
import { IconButton } from './ui/icon-button'
import { ExplorerContent, useExplorer } from './ExplorerPane'

/** How long the exit animation gets before the panel really unmounts. Must
    agree with `--essay-speed-quick` (0.1s) — the closing transition below
    uses that token, and a timeout shorter than it would cut the fade off. */
const CLOSE_MS = 100

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
 * The pop-out file manager: a centered floating card over a dim backdrop —
 * the command palette's posture, but for files. Not a page, not a rail;
 * browsing is a summoned act and Esc hands the manuscript back.
 *
 * Hand-rolled overlay rather than Base UI Dialog, deliberately: the rc.0
 * Root would have to be mounted conditionally anyway (its popup never
 * unmounts when a controlled `open` flips false), and its focus trap fights
 * the one thing the close path must guarantee — that focus returns to the
 * editor, which the caller does after `onClose`. A fixed div, a window-level
 * Escape listener and a backdrop click are the whole contract here; there is
 * no form inside to trap focus for.
 */
export function FilesPanel({ open, onClose, onOpenFile }: FilesPanelProps) {
  // Conditional mount, palette-style: the inner card runs `useExplorer`,
  // whose root watcher must live exactly as long as the panel is on screen.
  if (!open) return null
  return <FilesCard onClose={onClose} onOpenFile={onOpenFile} />
}

function FilesCard({
  onClose,
  onOpenFile,
}: {
  onClose: () => void
  onOpenFile: (absolutePath: string) => void
}) {
  const explorer = useExplorer()

  // Entrance/exit choreography, same shape as CommandPalette. A freshly
  // mounted card cannot CSS-transition its own arrival — the browser never
  // paints the "from" state — so `entered` flips true a double-rAF after
  // mount and the flip transitions to the final styles. `closing` mirrors it:
  // the exit plays while the card is still mounted, and `onClose` fires
  // CLOSE_MS later, at which point the parent's `open` flag unmounts us.
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
    // Double-rAF so the first paint lands on the initial styles — but raced
    // against a timeout, because rAF is not a promise the environment keeps:
    // an occluded window (macOS App Nap, an embedded webview) suspends it
    // entirely, and an entrance gated on a frame that never comes is a panel
    // that opens invisible. The timeout costs nothing when rAF wins and
    // saves the surface when it loses.
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
      a file must not repaint the manuscript under a panel that is still
      fading. A second close request during the window is dropped, so a
      double-click opens one file, once. */
  const requestClose = (after?: () => void) => {
    if (closing) return
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      onClose()
      after?.()
    }, CLOSE_MS)
  }

  // Window-level, not on the card: the tree lives in a shadow root and a
  // click into it moves focus somewhere a wrapper's onKeyDown may not hear.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      requestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // requestClose is stable enough here: `closing` only ever goes false→true
    // and the guard inside makes a stale closure harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const settled = entered && !closing
  const backdropStyle: CSSProperties = {
    opacity: settled ? 1 : 0,
    transition: 'opacity var(--essay-speed-quick) var(--essay-ease-out)',
  }
  // The inline transform carries the horizontal centring in every state — an
  // inline style always beats the `-translate-x-1/2` utility, so dropping it
  // from one branch would jump the card half its width.
  const cardStyle: CSSProperties = reduceMotion
    ? {
        opacity: settled ? 1 : 0,
        transform: 'translateX(-50%)',
        transition: 'opacity var(--essay-speed-quick) var(--essay-ease-out)',
      }
    : {
        opacity: settled ? 1 : 0,
        transform: closing
          ? 'translateX(-50%) translateY(-4px) scale(0.99)'
          : entered
            ? 'translateX(-50%)'
            : 'translateX(-50%) translateY(-10px) scale(0.97)',
        // Entrance is the slick pop the app's floating surfaces share:
        // ease-out-quint's emphatic settle, not the swift-spring the exit
        // still uses (that one is unchanged below).
        transition: closing
          ? 'opacity var(--essay-speed-quick) var(--essay-ease-out), transform var(--essay-speed-quick) var(--essay-ease-out)'
          : 'opacity 0.18s var(--essay-ease-out-quint), transform 0.18s var(--essay-ease-out-quint)',
      }

  const count = explorer.folders.length

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
        style={backdropStyle}
        onClick={() => requestClose()}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Files"
        style={cardStyle}
        className="fixed top-[14vh] left-1/2 z-50 flex max-h-[70vh] w-[640px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-[var(--essay-border)] bg-[var(--essay-surface)] shadow-[var(--essay-shadow-palette)] outline-none"
      >
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--essay-border)] px-3">
          <IconFolders size={16} className="text-[var(--essay-text-faint)]" />
          <h2 className="flex items-baseline gap-1.5 text-[13px] font-[510] text-[var(--essay-text)]">
            Files
            {count > 0 && (
              <span className="text-[12px] font-normal text-[var(--essay-text-faint)]">
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
              className="flex h-6 shrink-0 items-center rounded-md border border-[var(--essay-border)] px-2 text-[12px] text-[var(--essay-text-muted)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] disabled:pointer-events-none disabled:opacity-40"
            >
              Add folder
            </button>
            <IconButton
              className="h-6 w-6"
              aria-label="Close"
              onClick={() => requestClose()}
            >
              <IconClose size={14} />
            </IconButton>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <ExplorerContent
            explorer={explorer}
            onOpenFile={(path) => requestClose(() => onOpenFile(path))}
          />
        </div>
      </div>
    </>
  )
}
