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
        'text-[var(--essay-text-muted)] transition-colors duration-100',
        'hover:bg-[color-mix(in_oklab,var(--essay-text)_8%,transparent)] hover:text-[var(--essay-text)]',
        'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--essay-accent)]',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
}
