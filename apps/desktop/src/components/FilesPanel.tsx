import { useState } from 'react'
import { Popover } from '@base-ui-components/react/popover'
import {
  FileArrowUp,
  FolderSimplePlus,
  MagnifyingGlass,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { IconFolders } from './icons'
import { ExplorerContent, useExplorer } from './ExplorerPane'
import { IconButton } from './ui/icon-button'
import { Tip } from './ui/tooltip'

export interface FilesPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPath: string | null
  onOpenDocument: () => void
  onOpenFile: (absolutePath: string) => void
}

/**
 * A lightweight, non-modal workspace menu anchored in the running head.
 * Files are navigation, not a persistent reading: the manuscript should not
 * recompose just because the author is choosing what to open next.
 */
export function FilesPanel({
  open,
  onOpenChange,
  currentPath,
  onOpenDocument,
  onOpenFile,
}: FilesPanelProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Popover.Trigger
        aria-label="Browse files"
        title="Files"
        className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--essay-text-muted)] transition-[color,background-color] duration-[var(--essay-speed-quick)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
      >
        <IconFolders size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={5} className="z-[var(--essay-z-float)]">
          <Popover.Popup
            id="essay-files-panel"
            aria-label="Files"
            initialFocus={(interaction) => interaction === 'keyboard'}
            className="essay-files-popover flex h-[min(32rem,calc(100vh-3.5rem))] w-[min(19rem,calc(100vw-1rem))] min-h-0 flex-col overflow-hidden rounded-xl"
          >
            <FilesReading
              currentPath={currentPath}
              onOpenDocument={() => {
                onOpenChange(false)
                onOpenDocument()
              }}
              onOpenFile={(path) => {
                onOpenChange(false)
                onOpenFile(path)
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function FilesReading({
  currentPath,
  onOpenDocument,
  onOpenFile,
}: Omit<FilesPanelProps, 'open' | 'onOpenChange'>) {
  const explorer = useExplorer()
  const [query, setQuery] = useState('')

  return (
    <aside
      aria-label="Files"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 px-3">
        <h2 className="text-[12px] font-[510] text-[var(--essay-text)]">
          Files
        </h2>
        <div className="ml-auto flex items-center gap-0.5">
          <Tip
            label="Open file"
            side="bottom"
            trigger={
              <IconButton
                className="h-8 w-8"
                aria-label="Open file"
                disabled={!explorer.desktop}
                onClick={onOpenDocument}
              >
                <FileArrowUp size={14} />
              </IconButton>
            }
          />
          <Tip
            label="Add folder"
            side="bottom"
            trigger={
              <IconButton
                className="h-8 w-8"
                aria-label="Add folder"
                disabled={!explorer.desktop}
                onClick={() => void explorer.addFolder()}
              >
                <FolderSimplePlus size={14} />
              </IconButton>
            }
          />
        </div>
      </header>

      <div className="shrink-0 px-2 pb-2">
        <label className="flex h-8 items-center gap-1.5 rounded-md bg-[var(--essay-surface-hover)] px-2 text-[var(--essay-text-muted)] focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-[var(--essay-accent)]">
          <MagnifyingGlass size={12} className="shrink-0" />
          <input
            type="text"
            inputMode="search"
            aria-label="Filter files"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter files"
            className="min-w-0 flex-1 bg-transparent text-[11.5px] text-[var(--essay-text)] outline-none placeholder:text-[var(--essay-text-faint)]"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear file filter"
              onClick={() => setQuery('')}
              className="rounded p-0.5 hover:text-[var(--essay-text)]"
            >
              <X size={11} />
            </button>
          )}
        </label>
      </div>

      {explorer.error && (
        <div
          role="alert"
          className="shrink-0 border-b border-[var(--essay-border)] px-3 py-2 text-[11px] leading-[1.45] text-[var(--essay-text-muted)]"
        >
          <div className="flex items-start gap-1.5">
            <WarningCircle
              size={13}
              weight="bold"
              className="mt-0.5 shrink-0 text-[var(--essay-diff-remove)]"
            />
            <span className="min-w-0 flex-1">{explorer.error}</span>
            <button
              type="button"
              onClick={explorer.clearError}
              aria-label="Dismiss explorer error"
              className="shrink-0 rounded p-0.5 text-[var(--essay-text-faint)] hover:text-[var(--essay-text)]"
            >
              <X size={11} />
            </button>
          </div>
          <button
            type="button"
            onClick={explorer.refresh}
            className="mt-1.5 ml-[19px] text-[10.5px] font-[var(--essay-weight-medium)] text-[var(--essay-accent)] hover:underline"
          >
            Retry folders
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <ExplorerContent
          explorer={explorer}
          currentPath={currentPath}
          query={query}
          onOpenFile={onOpenFile}
        />
      </div>
    </aside>
  )
}
