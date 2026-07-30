import type { OutlineItem } from '#/lib/outline'

interface StructurePaneProps {
  outline: OutlineItem[]
  onSelect: (item: OutlineItem) => void
}

export function StructurePane({ outline, onSelect }: StructurePaneProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-[var(--essay-border)] bg-[var(--essay-surface)]">
      <div className="px-4 pt-4 pb-2 text-xs font-medium tracking-wide text-[var(--essay-text-faint)] uppercase">
        Structure
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {outline.length === 0 ? (
          <p className="px-2 py-1 text-sm text-[var(--essay-text-faint)]">
            No headings yet
          </p>
        ) : (
          <ul>
            {outline.map((item, i) => (
              <li key={`${item.line}-${i}`}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="w-full truncate rounded px-2 py-1 text-left text-sm text-[var(--essay-text-muted)] hover:bg-[var(--essay-border)] hover:text-[var(--essay-text)]"
                  style={{ paddingLeft: `${0.5 + (item.level - 1) * 0.75}rem` }}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </aside>
  )
}
