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
          <p className="px-2 py-1 text-[13px] text-[var(--essay-text-faint)]">
            No headings yet
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
                      'group flex w-full items-baseline gap-2 rounded-md px-2 py-[3px] text-left text-[13px] transition-colors duration-100',
                      active
                        ? 'bg-[var(--essay-surface-hover)] text-[var(--essay-text)]'
                        : 'text-[var(--essay-text-muted)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]',
                    )}
                    style={{ paddingLeft: `${0.5 + (item.level - 1) * 0.7}rem` }}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {item.text || 'Untitled'}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] tabular-nums text-[var(--essay-text-faint)] transition-opacity',
                        active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
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
