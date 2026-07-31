import type { DocumentMark, OutlineItem } from '@essay/editor'
import { HighlighterCircle } from '@phosphor-icons/react'
import { OutlinePane } from './OutlinePane'

interface SidebarProps {
  outline: OutlineItem[]
  activePos: number | null
  marks: DocumentMark[]
  onSelectOutline: (item: OutlineItem) => void
  onSelectMark: (mark: DocumentMark) => void
}

/** Outline-first: the sidebar is about navigating THIS document. */
export function Sidebar({
  outline,
  activePos,
  marks,
  onSelectOutline,
  onSelectMark,
}: SidebarProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-[var(--essay-border)]">
      <OutlinePane
        outline={outline}
        activePos={activePos}
        onSelect={onSelectOutline}
      />
      {marks.length > 0 && <MarksPane marks={marks} onSelect={onSelectMark} />}
    </aside>
  )
}

/**
 * The author's ==come back to this== marks, surfaced. Stored as plain
 * `==...==` in the Markdown file — portable to any editor.
 */
function MarksPane({
  marks,
  onSelect,
}: {
  marks: DocumentMark[]
  onSelect: (mark: DocumentMark) => void
}) {
  return (
    <section className="flex max-h-[32%] min-h-0 flex-col border-t border-[var(--essay-border)]">
      <header className="flex items-center gap-1.5 px-3 pt-3 pb-1">
        <HighlighterCircle
          size={12}
          className="text-[var(--essay-text-faint)]"
        />
        <h2 className="text-[11px] font-[510] tracking-wider text-[var(--essay-text-faint)] uppercase">
          Marks
        </h2>
        <span className="text-[11px] tabular-nums text-[var(--essay-text-faint)]">
          {marks.length}
        </span>
      </header>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <ul>
          {marks.map((mark, i) => (
            <li key={`${mark.pos}-${i}`}>
              <button
                type="button"
                onClick={() => onSelect(mark)}
                className="w-full truncate rounded-md px-2 py-[3px] text-left text-[13px] text-[var(--essay-text-muted)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
              >
                <span className="mr-1.5 inline-block h-2 w-2 rounded-[2px] bg-[var(--essay-highlight)] align-baseline" />
                {mark.text}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  )
}
