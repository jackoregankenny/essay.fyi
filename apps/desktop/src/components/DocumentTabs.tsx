import { cn } from '#/lib/cn'
import type { DocumentRef } from '#/lib/documentFile'
import { IconClose } from './icons'

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
 *
 * There is no tab *content*: Essay holds one buffer and swaps it. A tab is a
 * bookmark to a path, which is why closing one is pure bookkeeping and why
 * only the document you are looking at can be dirty.
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
    <div
      role="tablist"
      aria-label="Open documents"
      className="pointer-events-auto flex min-w-0 items-center gap-0.5"
    >
      {tabs.map((tab) => {
        const key = tab.path ?? 'untitled'
        const active = key === activeKey
        return (
          <div
            key={key}
            className={cn(
              'group flex h-7 min-w-0 shrink items-center rounded-md',
              'transition-colors duration-[var(--essay-speed-quick)]',
              active
                ? 'bg-[var(--essay-surface-hover)]'
                : 'hover:bg-[color-mix(in_oklab,var(--essay-surface-hover)_60%,transparent)]',
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(tab)}
              title={tab.path ?? tab.name}
              className={cn(
                'flex h-7 min-w-0 items-center gap-1.5 rounded-md pl-2 pr-1 text-[12px] font-[510]',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
                active
                  ? 'text-[var(--essay-text)]'
                  : 'text-[var(--essay-text-muted)] hover:text-[var(--essay-text)]',
              )}
            >
              <span className="max-w-40 truncate">{tab.name}</span>
              {tab.dirty && (
                <span
                  aria-label="Unsaved"
                  className="size-[4px] shrink-0 rounded-full bg-[var(--essay-accent)]"
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
                'mr-1 flex size-4 shrink-0 items-center justify-center rounded-[3px]',
                'text-[var(--essay-text-faint)]',
                'transition-[color,background-color,opacity] duration-[var(--essay-speed-quick)]',
                'hover:bg-[var(--essay-bg)] hover:text-[var(--essay-text)]',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
                active
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              )}
            >
              <IconClose size={9} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
