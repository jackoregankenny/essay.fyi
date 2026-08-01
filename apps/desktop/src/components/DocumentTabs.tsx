import { X } from '@phosphor-icons/react'
import { cn } from '#/lib/cn'
import type { DocumentRef } from '#/lib/documentFile'

export interface OpenTab extends DocumentRef {
  /** Unsaved changes — only ever true for the active tab, since leaving a
      saved document writes it. */
  dirty: boolean
}

/**
 * The documents you have open, and nothing else.
 *
 * Deliberately not a tab system: no reordering, no pinning, no split view, no
 * overflow scroller. Writing two documents against each other — a draft and
 * its notes, an essay and the memo it came from — is an ordinary thing to want
 * and does not require an IDE. When there is only one document there are no
 * tabs at all, because a row of one is furniture.
 */
export function DocumentTabs({
  tabs,
  activeKey,
  onSelect,
  onClose,
}: {
  tabs: OpenTab[]
  /** Path, or the literal 'untitled' for a buffer with no file yet. */
  activeKey: string
  onSelect: (tab: OpenTab) => void
  onClose: (tab: OpenTab) => void
}) {
  if (tabs.length < 2) return null

  return (
    <div role="tablist" aria-label="Open documents" className="flex min-w-0 items-center gap-0.5">
      {tabs.map((tab) => {
        const key = tab.path ?? 'untitled'
        const active = key === activeKey
        return (
          <div
            key={key}
            className={cn(
              'group flex h-7 min-w-0 shrink items-center rounded-md transition-colors duration-100',
              active
                ? 'bg-[var(--essay-surface-hover)]'
                : 'hover:bg-[var(--essay-surface-hover)]',
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(tab)}
              title={tab.path ?? tab.name}
              className={cn(
                'flex h-7 min-w-0 items-center gap-1.5 rounded-md pl-2 pr-1 text-[12px]',
                active
                  ? 'font-(family-name:--essay-font-ui) text-[var(--essay-text)]'
                  : 'text-[var(--essay-text-muted)]',
              )}
            >
              <span className="truncate">{tab.name}</span>
              {tab.dirty && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--essay-accent)]"
                  title="Unsaved changes"
                />
              )}
            </button>
            <button
              type="button"
              onClick={() => onClose(tab)}
              aria-label={`Close ${tab.name}`}
              // Visible for the active tab, on hover for the rest: a row of
              // close buttons reads as clutter and invites misclicks.
              className={cn(
                'mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px]',
                'text-[var(--essay-text-faint)] transition-colors duration-100',
                'hover:bg-[var(--essay-bg)] hover:text-[var(--essay-text)]',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
                active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              )}
            >
              <X size={10} weight="bold" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
