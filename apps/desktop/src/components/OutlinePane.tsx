import { cn } from '#/lib/cn'
import type { OutlineItem } from '@essay/editor'

interface OutlinePaneProps {
  outline: OutlineItem[]
  /** Position of the section the caret is currently inside (scroll-spy). */
  activePos: number | null
  onSelect: (item: OutlineItem) => void
}

export function OutlinePane({ outline, activePos, onSelect }: OutlinePaneProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="px-3 pt-3 pb-1">
        <h2 className="text-[11px] font-[510] tracking-wider text-[var(--essay-text-faint)] uppercase">
          Outline
        </h2>
      </header>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {outline.length === 0 ? (
          // An empty outline is a fact about the draft, not a failure of the
          // pane — say what will happen, not what is missing.
          <p className="px-2 py-1 text-[13px] leading-relaxed text-[var(--essay-text-faint)]">
            Headings gather here as the argument finds its shape.
          </p>
        ) : (
          <ul>
            {outline.map((item, i) => {
              const active = item.pos === activePos
              return (
                <li key={`${item.pos}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    className={cn(
                      'relative flex w-full items-baseline gap-2 rounded-md px-2 py-[3px] text-left text-[13px] transition-colors duration-100',
                      active
                        ? 'bg-[var(--essay-surface-hover)] text-[var(--essay-text)]'
                        : 'text-[var(--essay-text-muted)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]',
                    )}
                    style={{ paddingLeft: `${0.5 + (item.level - 1) * 0.7}rem` }}
                  >
                    {/* The gutter's current-section light, echoed at this zoom
                        level: a 2px bar riding the row's true left edge,
                        independent of the depth padding so it never shifts
                        with heading level. Opacity-only, so it needs no
                        reduced-motion guard (theme.css: that class of
                        feedback may keep moving). */}
                    <span
                      aria-hidden
                      className={cn(
                        'absolute inset-y-0.5 left-0 w-[2px] rounded-full bg-[var(--essay-accent)] transition-opacity duration-[var(--essay-speed-regular)] ease-[var(--essay-ease-out)]',
                        active ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {item.text || 'Untitled'}
                    </span>
                    {/* Always on, never bare: a word count that only appears
                        on hover is a pane that looks empty until touched.
                        Quiet by default, a shade firmer on the active row so
                        it still reads as secondary to the heading text. */}
                    <span
                      className={cn(
                        'text-right text-[10px] tabular-nums',
                        active
                          ? 'text-[var(--essay-text-muted)]'
                          : 'text-[var(--essay-text-faint)]',
                      )}
                    >
                      {item.words}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </nav>
    </section>
  )
}
