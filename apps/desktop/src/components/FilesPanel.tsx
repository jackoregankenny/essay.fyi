import { FolderSimplePlus } from '@phosphor-icons/react'
import { IconClose, IconFolders } from './icons'
import { ExplorerContent, useExplorer } from './ExplorerPane'
import { IconButton } from './ui/icon-button'

export interface FilesPanelProps {
  open: boolean
  onClose: () => void
  onOpenFile: (absolutePath: string) => void
}

/**
 * The workspace's file reading.
 *
 * This is a real layout column, not a popover pretending to be a sidebar.
 * It shares the manuscript canvas exactly — no border, card fill, shadow, or
 * viewport-relative anchoring — so it cannot clip offscreen or cover the top
 * of the document. `Workspace` gives the column its width and closes the
 * right-hand document reading before this one opens.
 */
export function FilesPanel({ open, onClose, onOpenFile }: FilesPanelProps) {
  if (!open) return null
  return <FilesReading onClose={onClose} onOpenFile={onOpenFile} />
}

function FilesReading({
  onClose,
  onOpenFile,
}: Omit<FilesPanelProps, 'open'>) {
  const explorer = useExplorer()
  const folderCount = explorer.folders.length

  return (
    <aside
      aria-label="Files"
      className="essay-files-column essay-panel-enter flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--essay-editor-bg)]"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 px-3">
        <IconFolders size={14} className="text-[var(--essay-text-faint)]" />
        <h2 className="text-[12px] font-[510] text-[var(--essay-text)]">
          Files
        </h2>
        {folderCount > 0 && (
          <span className="text-[10.5px] text-[var(--essay-text-faint)]">
            {folderCount === 1 ? '1 folder' : `${folderCount} folders`}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            className="h-6 w-6"
            disabled={!explorer.desktop}
            title={
              explorer.desktop
                ? 'Add folder to workspace'
                : 'Available in the desktop app'
            }
            onClick={() => void explorer.addFolder()}
          >
            <FolderSimplePlus size={14} />
          </IconButton>
          <IconButton
            className="h-6 w-6"
            aria-label="Close files"
            onClick={onClose}
          >
            <IconClose size={13} />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <ExplorerContent explorer={explorer} onOpenFile={onOpenFile} />
      </div>
    </aside>
  )
}
