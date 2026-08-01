import type { ReactNode } from 'react'
import { X } from '@phosphor-icons/react'
import { cn } from '#/lib/cn'
import { IconButton } from './ui/icon-button'

export interface NoticeAction {
  label: string
  onClick: () => void
  /** The action the author most likely wants; at most one per notice. */
  primary?: boolean
}

/**
 * A quiet bar above the manuscript for the two things only the author can
 * decide: the file changed underneath you, and there is unsaved work from
 * last time. Deliberately not a modal — writing is never interrupted, and
 * nothing here is urgent, because both states are already safe on disk.
 */
export function Notice({
  children,
  actions,
  onDismiss,
}: {
  children: ReactNode
  actions: NoticeAction[]
  onDismiss?: () => void
}) {
  return (
    <div
      role="status"
      className={cn(
        'essay-pop flex items-center gap-3 border-b border-[var(--essay-border)]',
        'bg-[var(--essay-surface)] px-3 py-2 text-[12px] text-[var(--essay-text-muted)]',
      )}
    >
      <p className="min-w-0 flex-1">{children}</p>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.onClick}
          className={cn(
            'h-6 shrink-0 rounded-md px-2 text-[12px] font-[var(--essay-weight-medium)]',
            'transition-colors duration-100',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
            action.primary
              ? 'bg-[var(--essay-accent-tint)] text-[var(--essay-accent)] hover:brightness-125'
              : 'text-[var(--essay-text-muted)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]',
          )}
        >
          {action.label}
        </button>
      ))}
      {onDismiss && (
        <IconButton onClick={onDismiss} aria-label="Dismiss" className="h-6 w-6">
          <X size={13} />
        </IconButton>
      )}
    </div>
  )
}

/** The document's name, set in the UI font so it reads as a file not a word. */
export function DocName({ children }: { children: string }) {
  return (
    <span className="font-[var(--essay-weight-medium)] text-[var(--essay-text)]">
      {children}
    </span>
  )
}
