import { CaretRight, CaretUpDown } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { commandKey, isMac, TRAFFIC_LIGHT_INSET } from '#/lib/platform'
import { UpdateButton } from './UpdateButton'
import { WindowControls } from './ui/window-controls'

export interface TopBarProps {
  docName: string
  sectionName?: string | null
  dirty: boolean
  /** An unanswered disk conflict counts as unsaved work. */
  conflict: boolean
  files: ReactNode
  onOpenPalette: () => void
}

const PALETTE_KBD_LABEL = isMac ? `${commandKey}K` : `${commandKey} K`

/**
 * The reserved running head. It shares the canvas and has no bar material,
 * but it owns real height: manuscript text must never scroll beneath file,
 * update, or command controls.
 */
export function TopBar({
  docName,
  sectionName,
  dirty,
  conflict,
  files,
  onOpenPalette,
}: TopBarProps) {
  return (
    <header
      data-tauri-drag-region
      data-mac={isMac ? '' : undefined}
      className="essay-chrome pointer-events-none relative z-40 flex h-10 shrink-0 items-center bg-[var(--essay-editor-bg)] pr-2"
    >
      <div
        data-tauri-drag-region
        className="flex h-full min-w-0 flex-1 items-center gap-1"
        style={{
          paddingLeft: isMac ? TRAFFIC_LIGHT_INSET : 8,
        }}
      >
        <div className="pointer-events-auto shrink-0">{files}</div>
        <button
            type="button"
            onClick={onOpenPalette}
            title="Switch document"
            aria-label={`Switch document, current document: ${docName}`}
            aria-keyshortcuts="Control+K Meta+K"
            className="group pointer-events-auto flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-[510] text-[var(--essay-text-muted)] transition-[color,background-color] duration-[var(--essay-speed-quick)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
          >
            <span className="max-w-52 truncate text-[var(--essay-text)]">
              {docName}
            </span>
            {dirty && (
              <span
                aria-label="Unsaved"
                className="size-[4px] shrink-0 rounded-full bg-[var(--essay-accent)]"
              />
            )}
            {sectionName && (
              <>
                <CaretRight
                  size={10}
                  aria-hidden
                  className="shrink-0 text-[var(--essay-text-faint)]"
                />
                <span className="max-w-64 truncate text-[var(--essay-text-faint)] transition-colors duration-[var(--essay-speed-quick)] group-hover:text-[var(--essay-text-muted)]">
                  {sectionName}
                </span>
              </>
            )}
            <CaretUpDown
              size={10}
              aria-hidden
              className="ml-0.5 shrink-0 text-[var(--essay-text-faint)] opacity-0 transition-opacity duration-[var(--essay-speed-quick)] group-hover:opacity-100 group-focus-visible:opacity-100"
            />
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <UpdateButton documentsSaved={!dirty && !conflict} />
          <button
              type="button"
              onClick={onOpenPalette}
              title="Command palette"
              aria-label="Open command palette"
              aria-keyshortcuts="Control+K Meta+K"
              className="pointer-events-auto flex h-7 min-w-8 items-center justify-center rounded-md bg-[color-mix(in_oklab,var(--essay-surface)_62%,transparent)] px-1.5 font-(family-name:--essay-font-ui) text-[10.5px] font-[510] text-[var(--essay-text-muted)] transition-[color,background-color] duration-[var(--essay-speed-quick)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
            >
              {PALETTE_KBD_LABEL}
          </button>
        </div>
      </div>

      <div className="pointer-events-auto ml-1 shrink-0">
        <WindowControls />
      </div>
    </header>
  )
}
