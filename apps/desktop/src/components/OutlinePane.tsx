import type { OutlineItem } from '@essay/editor'

interface OutlinePaneProps {
  outline: OutlineItem[]
  onSelect: (item: OutlineItem) => void
}

export function OutlinePane({ outline, onSelect }: OutlinePaneProps) {
  return (
    <section className="flex max-h-[45%] min-h-0 flex-col border-t border-[var(--essay-border)]">
      <header className="px-3 pt-3 pb-1">
        <h2 className="text-[11px] font-medium tracking-wider text-[var(--essay-text-faint)] uppercase">
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
            {outline.map((item, i) => (
              <li key={`${item.pos}-${i}`}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="group flex w-full items-baseline gap-2 rounded-md px-2 py-[3px] text-left text-[13px] text-[var(--essay-text-muted)] transition-colors duration-100 hover:bg-[color-mix(in_oklab,var(--essay-text)_7%,transparent)] hover:text-[var(--essay-text)]"
                  style={{ paddingLeft: `${0.5 + (item.level - 1) * 0.7}rem` }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {item.text || 'Untitled'}
                  </span>
                  <span className="text-[10px] tabular-nums text-[var(--essay-text-faint)] opacity-0 transition-opacity group-hover:opacity-100">
                    {item.words}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </section>
  )
}
