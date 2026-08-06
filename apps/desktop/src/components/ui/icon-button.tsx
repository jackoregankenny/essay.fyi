import type { ButtonHTMLAttributes } from 'react'
import { cn } from '#/lib/cn'

/** Quiet 28px icon button — the workhorse of the chrome. */
export function IconButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
        'text-[var(--essay-text-muted)]',
        // Colour and the press scale share one transition at quick/ease-out so
        // the release eases back out instead of snapping — and both stay on
        // the compositor.
        'transition-[color,background-color,transform] duration-[var(--essay-speed-quick)] ease-[var(--essay-ease-out)]',
        'hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]',
        // Press feedback. Scale is a transform, so per theme.css it is gated
        // on motion-safe; colour feedback carries the pressed state without it.
        'motion-safe:active:scale-[0.96]',
        // The ring sits outside the button (offset 1) rather than inset: a
        // 28px hit target loses too much of its glyph to an inset ring.
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
}
