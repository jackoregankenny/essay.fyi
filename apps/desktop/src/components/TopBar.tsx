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
  /** The open-documents strip. Renders nothing below two documents, which is
      why `nameless` and not `tabs !== null` decides the chip. */
  tabs?: ReactNode
  /** Tabs are showing, so the active document already names itself here; the
      chip keeps only the section breadcrumb. */
  nameless?: boolean
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
  tabs,
  nameless = false,
  onOpenPalette,
}: TopBarProps) {
  return (
    <header
      data-tauri-drag-region
      data-mac={isMac ? '' : undefined}
      // `pointer-events-auto`, not `none`: the running head owns real height in
      // normal flow, so nothing sits under it to click through to — and a
      // drag region that cannot receive mousedown is not a drag region. The
      // same miss stopped `.essay-chrome:hover` from lifting the typing fade.
      className="essay-chrome pointer-events-auto relative z-[var(--essay-z-controls)] flex h-10 shrink-0 select-none items-center bg-[var(--essay-editor-bg)] pr-2"
    >
      <div
        data-tauri-drag-region
        className="flex h-full min-w-0 flex-1 items-center gap-1"
        style={{
          paddingLeft: isMac ? TRAFFIC_LIGHT_INSET : 8,
        }}
      >
        <div className="pointer-events-auto shrink-0">{files}</div>
        {tabs}
        {/* With tabs up, the active one already carries the name and the dot,
            so the chip narrows to the breadcrumb — and disappears entirely
            when there is no section to point at. */}
        {(!nameless || sectionName) && (
          <button
            type="button"
            onClick={onOpenPalette}
            title="Switch document"
            aria-label={`Switch document, current document: ${docName}`}
            aria-keyshortcuts="Control+K Meta+K"
            className="group pointer-events-auto flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-[510] text-[var(--essay-text-muted)] transition-[color,background-color] duration-[var(--essay-speed-quick)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
          >
            {!nameless && (
              <>
                <span className="max-w-52 truncate text-[var(--essay-text)]">
                  {docName}
                </span>
                {dirty && (
                  <span
                    aria-label="Unsaved"
                    className="size-[4px] shrink-0 rounded-full bg-[var(--essay-accent)]"
                  />
                )}
              </>
            )}
            {sectionName && (
              <>
                {!nameless && (
                  <CaretRight
                    size={10}
                    aria-hidden
                    className="shrink-0 text-[var(--essay-text-faint)]"
                  />
                )}
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
        )}

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
