import type { DocumentMark, OutlineItem } from '@essay/editor'
import { IconMark } from './icons'
import { OutlinePane } from './OutlinePane'

interface SidebarProps {
  outline: OutlineItem[]
  activePos: number | null
  marks: DocumentMark[]
  onSelectOutline: (item: OutlineItem) => void
  onSelectMark: (mark: DocumentMark) => void
}

/**
 * The Structure tenant of the companion slot (docs/ui-overhaul.md): where the
 * sections are and what the author flagged to come back to. History used to
 * live here too; it is a companion tenant of its own now — a timeline was
 * never comfortable in a third of a 232px column. The overhaul's step 2 grows
 * this into the brief's full STRUCTURE pane (page weight, change activity,
 * pending proposals); today it is the outline and the marks, unchanged.
 *
 * No border of its own: the companion column draws the frame, and a tenant
 * that brought one would double it.
 */
export function Sidebar({
  outline,
  activePos,
  marks,
  onSelectOutline,
  onSelectMark,
}: SidebarProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col">
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
        <IconMark size={12} className="text-[var(--essay-text-faint)]" />
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
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-[3px] text-left text-[13px] text-[var(--essay-text-muted)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
              >
                {/* A swatch, not a bullet: it stands for the highlight itself,
                    so it keeps the mark's own colour rather than borrowing the
                    row's. shrink-0 in a flex row so a long line truncates the
                    text and never the swatch. */}
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-[3px] bg-[var(--essay-highlight)]"
                />
                <span className="min-w-0 flex-1 truncate">{mark.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  )
}
