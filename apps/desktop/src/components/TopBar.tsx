import { CaretRight, CaretUpDown } from '@phosphor-icons/react'
import { commandKey, isMac } from '#/lib/platform'
import { IconFolders } from './icons'
import { UpdateButton } from './UpdateButton'
import { IconButton } from './ui/icon-button'
import { Tip } from './ui/tooltip'
import { WindowControls } from './ui/window-controls'

export interface TopBarProps {
  docName: string
  sectionName?: string | null
  dirty: boolean
  /** An unanswered disk conflict counts as unsaved work. */
  conflict: boolean
  filesOpen: boolean
  onToggleFiles: () => void
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
  filesOpen,
  onToggleFiles,
  onOpenPalette,
}: TopBarProps) {
  return (
    <header
      data-tauri-drag-region
      className="essay-shell-track-grid essay-chrome pointer-events-none relative z-30 h-12 shrink-0 bg-[var(--essay-editor-bg)]"
    >
      <div
        data-tauri-drag-region
        className="essay-shell-center h-full"
      >
        <div
          data-tauri-drag-region
          className="essay-manuscript-orbit mx-auto flex h-full items-center gap-2"
        >
        <Tip
          label="Files"
          trigger={
            <IconButton
              onClick={onToggleFiles}
              data-files-trigger
              aria-label="Files"
              aria-pressed={filesOpen}
              className={`pointer-events-auto -ml-1 ${
                filesOpen ? 'text-[var(--essay-accent)]' : ''
              }`}
            >
              <IconFolders size={16} />
            </IconButton>
          }
        />

        <button
          type="button"
          onClick={onOpenPalette}
          title="Switch document"
          className="group pointer-events-auto flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-[510] text-[var(--essay-text-muted)] transition-[color,background-color] duration-[var(--essay-speed-quick)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
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
            className="ml-0.5 shrink-0 text-[var(--essay-text-faint)] opacity-0 transition-opacity duration-[var(--essay-speed-quick)] group-hover:opacity-100"
          />
        </button>

        <div className="ml-auto flex items-center gap-2">
          <UpdateButton documentsSaved={!dirty && !conflict} />
          <button
            type="button"
            onClick={onOpenPalette}
            title="Command palette"
            className="pointer-events-auto flex h-6 items-center rounded-md px-1.5 font-(family-name:--essay-font-ui) text-[10.5px] font-[510] text-[var(--essay-text-faint)] transition-[color,background-color] duration-[var(--essay-speed-quick)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
          >
            {PALETTE_KBD_LABEL}
          </button>
        </div>
        </div>
      </div>

      <div className="pointer-events-auto absolute top-1 right-1">
        <WindowControls />
      </div>
    </header>
  )
}
