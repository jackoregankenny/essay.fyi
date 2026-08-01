import { useState } from 'react'
import { Popover } from '@base-ui-components/react/popover'
import { CaretDown } from '@phosphor-icons/react'
import { ExplorerPane } from './ExplorerPane'

interface FilesPopoverProps {
  docName: string
  dirty: boolean
  onOpenFile: (absolutePath: string) => void
  /** Drop the document's name from the trigger. Set when the tab strip is
      showing, which already says which document is open — twice would be
      noise, and the caret alone still reads as "browse files". */
  nameless?: boolean
}

/**
 * The document switcher: file browsing lives in a popover off the current
 * document's name, not a permanent pane — switching files is occasional,
 * the outline is constant.
 */
export function FilesPopover({
  docName,
  dirty,
  onOpenFile,
  nameless = false,
}: FilesPopoverProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={nameless ? 'Browse files' : undefined}
        title={nameless ? 'Browse files' : undefined}
        className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-[510] text-[var(--essay-text)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)]"
      >
        {!nameless && <span className="truncate">{docName}</span>}
        {!nameless && dirty && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--essay-accent)]"
            title="Unsaved changes"
          />
        )}
        <CaretDown
          size={11}
          className="shrink-0 text-[var(--essay-text-faint)]"
        />
      </Popover.Trigger>
      {/* Conditional mount: Base UI rc.0 popups don't unmount when the
          controlled open prop flips false (same gotcha as CommandPalette). */}
      {open && (
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={6}>
            <Popover.Popup className="essay-pop z-50 flex h-[380px] w-[300px] flex-col overflow-hidden rounded-xl border border-[var(--essay-border)] bg-[var(--essay-surface)] shadow-[var(--essay-shadow-palette)] outline-none">
              <ExplorerPane
                onOpenFile={(path) => {
                  setOpen(false)
                  onOpenFile(path)
                }}
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      )}
    </Popover.Root>
  )
}
