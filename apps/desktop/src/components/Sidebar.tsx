import {
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { ArrowLeft, Books, ChatCircle, Plus } from '@phosphor-icons/react'
import type { DocumentMark, DocumentTask, OutlineItem } from '@essay/editor'
import type { CommentItem, CommentRange } from '#/lib/useComments'
import { truncateMiddle } from '#/lib/commentAnchors'
import { revisionTime } from '#/lib/revisions'
import { cn } from '#/lib/cn'
import { IconMark } from './icons'
import { OutlinePane } from './OutlinePane'

/** Everything the Structure slot needs to list and open comment threads.
    Workspace owns the controller; this is its reading of it. */
export interface SidebarComments {
  items: CommentItem[]
  rangeOf: (threadId: string) => CommentRange | null
  /** Thread open in the detail view — Structure replaced in place. */
  openId: string | null
  /** Whether the manuscript currently has a non-empty selection — what
      gates Reattach, which uses that selection as the new home. */
  selectionEmpty: boolean
  onOpen: (threadId: string) => void
  onBack: () => void
  onReply: (threadId: string, body: string) => Promise<boolean>
  onResolve: (threadId: string) => void
  onReopen: (threadId: string) => void
  onDelete: (threadId: string) => void
  onReattach: (threadId: string) => Promise<boolean>
}

/**
 * Making one of the things this pane lists, from the pane that lists them.
 *
 * Structure was read-only, and every way to put something *into* it was
 * somewhere else: a keyboard shortcut, a palette entry, the selection toolbar.
 * That is fine once you know, and invisible until you do — and the panes made
 * it worse by rendering only when non-empty, so an author with no tasks was
 * shown nothing at all about tasks. The one place you are certainly looking
 * when you think "where are my todos?" is the place that should be able to
 * make one.
 *
 * `selectionEmpty` gates the two that need a passage to attach to. Shown
 * disabled with the reason rather than hidden: a control that appears only
 * under conditions you have not worked out yet is the problem restated.
 */
export interface SidebarCreate {
  /** Mark the selection as `==come back to this==`. */
  onAddMark: () => void
  /** Open the comment composer on the selection. */
  onAddComment: () => void
  /** Nothing selected, so mark and comment have nothing to attach to. */
  selectionEmpty: boolean
}

interface SidebarProps {
  outline: OutlineItem[]
  activePos: number | null
  marks: DocumentMark[]
  tasks: DocumentTask[]
  comments?: SidebarComments
  citations: ReadonlyArray<{ key: string; count: number }>
  create?: SidebarCreate
  onSelectOutline: (item: OutlineItem) => void
  onSelectMark: (mark: DocumentMark) => void
  /** Show the Tasks tenant — Structure points at it rather than holding it. */
  onOpenTasks?: () => void
}

/**
 * The Structure tenant of the companion slot (docs/ui-overhaul.md): where the
 * sections are and what the author flagged to come back to. History used to
 * live here too; it is a companion tenant of its own now — a timeline was
 * never comfortable in a third of a 232px column. The overhaul's step 2 grows
 * this into the brief's full STRUCTURE pane (page weight, change activity,
 * pending proposals); today it is the outline, portable marks, task-list
 * items, and comment threads indexed live from the manuscript.
 *
 * Comments follow the work-map doctrine (docs/long-form-materials.md): a
 * thread opens *in* this slot, replacing the reading with a Back affordance —
 * no fifth tenant, no floating cards over the prose.
 *
 * No border or fill of its own: whitespace groups readings on the one canvas.
 */
export function Sidebar({
  outline,
  activePos,
  marks,
  tasks,
  comments,
  citations,
  create,
  onSelectOutline,
  onSelectMark,
  onOpenTasks,
}: SidebarProps) {
  const openItem = comments?.openId
    ? comments.items.find((item) => item.thread.id === comments.openId)
    : undefined
  if (comments && openItem) {
    return (
      <aside className="flex h-full min-h-0 flex-col">
        <ThreadDetail comments={comments} item={openItem} />
      </aside>
    )
  }

  const isBlank =
    outline.length === 0 &&
    marks.length === 0 &&
    tasks.length === 0 &&
    citations.length === 0 &&
    (!comments || comments.items.length === 0)

  if (isBlank) {
    return (
      <aside className="flex h-full min-h-0 flex-col px-4 pt-5">
        <h2 className="text-[10.5px] font-[590] tracking-[0.12em] text-[var(--essay-text-faint)] uppercase">
          Structure
        </h2>
        <p className="mt-3 max-w-56 text-[12px] leading-relaxed text-[var(--essay-text-faint)]">
          Headings, comments, tasks, marks, and citations will gather here as
          the document takes shape.
        </p>
      </aside>
    )
  }

  return (
    <aside className="flex h-full min-h-0 flex-col">
      <OutlinePane
        outline={outline}
        activePos={activePos}
        onSelect={onSelectOutline}
      />
      {/* Rendered whether or not they hold anything, which they did not used
          to be. An empty pane is not clutter here — it is the only thing on
          screen that says tasks and marks exist and how one is made. Comments
          already worked this way; the other two now agree. */}
      <MarksPane marks={marks} create={create} onSelect={onSelectMark} />
      {/* Tasks moved out to their own tenant (`TasksPanel`): Structure is the
          shape of the argument, and the state of the work is a different
          question that was never comfortable as a third of a shared column.
          The count stays here as a pointer, so opening Structure still tells
          you there is work outstanding — it just does not try to hold it. */}
      {tasks.length > 0 && (
        <TasksSummary
          open={tasks.filter((task) => !task.checked).length}
          onOpen={onOpenTasks}
        />
      )}
      {comments && (
        <CommentsPane comments={comments} outline={outline} create={create} />
      )}
      <CitationsPane citations={citations} />
    </aside>
  )
}

/**
 * The `+` at the end of a pane's header.
 *
 * Sized and coloured like the count beside it rather than like a button: the
 * pane is a reading first, and a filled control in every header would turn a
 * quiet column into a toolbar. It comes up to full strength on hover, which is
 * the same grammar the rows already use.
 *
 * A disabled one keeps its tooltip, and the tooltip is the whole point — it
 * says *why*, so "I can't mark anything" resolves to "because nothing is
 * selected" without the author having to guess.
 */
function AddButton({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string
  hint: string
  disabled?: boolean
  onClick?: () => void
}) {
  if (!onClick) return null
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={hint}
      className="ml-auto shrink-0 rounded p-0.5 text-[var(--essay-text-faint)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)] disabled:pointer-events-none disabled:opacity-40"
    >
      <Plus size={11} weight="bold" />
    </button>
  )
}

/** The one-line "nothing here yet, and here is how one is made" note. */
function PaneEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-1 text-[11.5px] leading-relaxed text-[var(--essay-text-faint)]">
      {children}
    </p>
  )
}

/**
 * The author's ==come back to this== marks, surfaced. Stored as plain
 * `==...==` in the Markdown file — portable to any editor.
 */
function MarksPane({
  marks,
  create,
  onSelect,
}: {
  marks: DocumentMark[]
  create?: SidebarCreate
  onSelect: (mark: DocumentMark) => void
}) {
  return (
    <section className="flex max-h-[30%] min-h-0 flex-col pt-2">
      <header className="flex items-center gap-1.5 px-3 pt-3 pb-1">
        <IconMark size={12} className="text-[var(--essay-text-faint)]" />
        <h2 className="text-[11px] font-[510] tracking-wider text-[var(--essay-text-faint)] uppercase">
          Marks
        </h2>
        <span className="text-[11px] tabular-nums text-[var(--essay-text-faint)]">
          {marks.length}
        </span>
        <AddButton
          label="Mark the selection"
          hint={
            create?.selectionEmpty
              ? 'Select a passage first, then mark it to come back to'
              : 'Mark the selection to come back to'
          }
          disabled={create?.selectionEmpty}
          onClick={create?.onAddMark}
        />
      </header>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {marks.length === 0 && (
          <PaneEmpty>
            Select a passage and mark it to come back to. Marks live in the file
            as plain <code>==text==</code>.
          </PaneEmpty>
        )}
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

/** A pointer to the Tasks tenant, not a second copy of it. One line, because
    two surfaces both listing the same checkboxes is how they drift. */
function TasksSummary({ open, onOpen }: { open: number; onOpen?: () => void }) {
  return (
    <section className="shrink-0 px-3 pt-3 pb-1">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="flex w-full items-center gap-1.5 rounded-md px-0 py-1 text-left text-[11px] tracking-wider text-[var(--essay-text-faint)] uppercase transition-colors duration-100 hover:text-[var(--essay-text)] disabled:pointer-events-none"
      >
        <span className="font-[510]">Tasks</span>
        <span className="tabular-nums normal-case">{open} open</span>
      </button>
    </section>
  )
}

// ——— Comments ———

interface CommentRow {
  item: CommentItem
  range: CommentRange | null
  /** ProseMirror pos of the section the range starts in, or null in the
      preamble — the grouping key. */
  sectionPos: number | null
  /** "through <section>" when the range crosses into another section. */
  through: string | null
}

/** The section owning a document position: the last heading at or before it. */
function sectionAt(outline: OutlineItem[], pos: number): OutlineItem | null {
  let owner: OutlineItem | null = null
  for (const item of outline) {
    if (item.pos <= pos) owner = item
    else break
  }
  return owner
}

/**
 * Threads under their starting section — one row per thread however many
 * sections it spans, per the doctrine: every touched section may signal in
 * the gutter, but the thread appears once, labelled "through …". Unplaced
 * threads are their own clearly-named group; resolved ones stay behind a
 * small toggle, in history rather than in the way.
 */
function CommentsPane({
  comments,
  outline,
  create,
}: {
  comments: SidebarComments
  outline: OutlineItem[]
  create?: SidebarCreate
}) {
  const [showResolved, setShowResolved] = useState(false)

  const { groups, unplaced, resolved } = useMemo(() => {
    const placedRows: CommentRow[] = []
    const unplaced: CommentRow[] = []
    const resolved: CommentRow[] = []
    for (const item of comments.items) {
      const range = comments.rangeOf(item.thread.id)
      const start = range ? sectionAt(outline, range.from) : null
      const end = range ? sectionAt(outline, Math.max(range.from, range.to - 1)) : null
      const row: CommentRow = {
        item,
        range,
        sectionPos: start?.pos ?? null,
        through: end && end !== start ? end.text || 'Untitled' : null,
      }
      if (item.thread.state === 'resolved') resolved.push(row)
      else if (!range) unplaced.push(row)
      else placedRows.push(row)
    }
    placedRows.sort((a, b) => (a.range?.from ?? 0) - (b.range?.from ?? 0))
    unplaced.sort((a, b) => a.item.thread.createdAt - b.item.thread.createdAt)
    resolved.sort((a, b) => a.item.thread.createdAt - b.item.thread.createdAt)
    // Group in document order; the preamble (no section) leads.
    const groups: Array<{ label: string | null; rows: CommentRow[] }> = []
    for (const row of placedRows) {
      const label =
        row.sectionPos === null
          ? null
          : sectionAt(outline, row.sectionPos)?.text || 'Untitled'
      const last = groups[groups.length - 1]
      if (last && last.label === label) last.rows.push(row)
      else groups.push({ label, rows: [row] })
    }
    return { groups, unplaced, resolved }
  }, [comments, outline])

  const openCount =
    groups.reduce((n, g) => n + g.rows.length, 0) + unplaced.length

  return (
    <section className="flex max-h-[40%] min-h-0 flex-col pt-2">
      <header className="flex items-center gap-1.5 px-3 pb-1">
        <ChatCircle size={12} className="text-[var(--essay-text-faint)]" />
        <h2 className="text-[11px] font-[510] tracking-wider text-[var(--essay-text-faint)] uppercase">
          Comments
        </h2>
        <span className="text-[11px] tabular-nums text-[var(--essay-text-faint)]">
          {openCount} open
        </span>
        <AddButton
          label="Comment on the selection"
          hint={
            create?.selectionEmpty
              ? 'Select a passage first, then comment on it'
              : 'Comment on the selection'
          }
          disabled={create?.selectionEmpty}
          onClick={create?.onAddComment}
        />
      </header>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {openCount === 0 && resolved.length === 0 && (
          <PaneEmpty>
            Select a passage and comment on it, from here or the selection
            tools.
          </PaneEmpty>
        )}
        {groups.map((group, i) => (
          <div key={`${group.label ?? '·preamble'}-${i}`}>
            <p className="truncate px-2 pt-1.5 pb-0.5 text-[10.5px] text-[var(--essay-text-faint)]">
              {group.label ?? 'Before the first heading'}
            </p>
            <ul>
              {group.rows.map((row) => (
                <CommentRowButton key={row.item.thread.id} row={row} comments={comments} />
              ))}
            </ul>
          </div>
        ))}
        {unplaced.length > 0 && (
          <div>
            <p className="truncate px-2 pt-1.5 pb-0.5 text-[10.5px] text-[var(--essay-text-faint)]">
              Unplaced — reattach from the text
            </p>
            <ul>
              {unplaced.map((row) => (
                <CommentRowButton key={row.item.thread.id} row={row} comments={comments} />
              ))}
            </ul>
          </div>
        )}
        {resolved.length > 0 && (
          <div className="pt-1.5">
            <button
              type="button"
              aria-expanded={showResolved}
              onClick={() => setShowResolved((on) => !on)}
              className="px-2 py-0.5 text-[10.5px] text-[var(--essay-text-faint)] transition-colors duration-100 hover:text-[var(--essay-text-muted)]"
            >
              {resolved.length} resolved
            </button>
            {showResolved && (
              <ul className="opacity-70">
                {resolved.map((row) => (
                  <CommentRowButton key={row.item.thread.id} row={row} comments={comments} />
                ))}
              </ul>
            )}
          </div>
        )}
      </nav>
    </section>
  )
}

// ——— Citations ———

/**
 * The live citation index. Citations are manuscript syntax, not sidecar
 * metadata, so this reading is derived directly from the Markdown buffer and
 * can never become stale. Bibliography editing comes later; this first surface
 * makes the keys and repeated uses visible where an author expects them.
 */
function CitationsPane({
  citations,
}: {
  citations: ReadonlyArray<{ key: string; count: number }>
}) {
  const uses = citations.reduce((total, citation) => total + citation.count, 0)
  return (
    <section className="flex max-h-[28%] min-h-0 flex-col border-t border-[var(--essay-border)] pt-2">
      <header className="flex items-center gap-1.5 px-3 pb-1">
        <Books size={12} className="text-[var(--essay-text-faint)]" />
        <h2 className="text-[11px] font-[510] tracking-wider text-[var(--essay-text-faint)] uppercase">
          Citations
        </h2>
        {uses > 0 && (
          <span className="text-[11px] tabular-nums text-[var(--essay-text-faint)]">
            {uses}
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {citations.length === 0 ? (
          <p className="px-2 py-1 text-[11.5px] leading-relaxed text-[var(--essay-text-faint)]">
            Cite with <code className="text-[var(--essay-text-muted)]">[@key]</code>.
            Essay resolves keys from a bibliography beside the document.
          </p>
        ) : (
          <ul>
            {citations.map((citation) => (
              <li
                key={citation.key}
                className="flex items-baseline gap-2 rounded-md px-2 py-[3px] text-[12.5px] text-[var(--essay-text-muted)]"
              >
                <code className="min-w-0 flex-1 truncate font-(family-name:--essay-font-mono)">
                  @{citation.key}
                </code>
                {citation.count > 1 && (
                  <span className="text-[10.5px] tabular-nums text-[var(--essay-text-faint)]">
                    {citation.count}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function CommentRowButton({
  row,
  comments,
}: {
  row: CommentRow
  comments: SidebarComments
}) {
  const { item, through } = row
  return (
    <li>
      <button
        type="button"
        onClick={() => comments.onOpen(item.thread.id)}
        className="flex w-full items-baseline gap-1.5 rounded-md px-2 py-[3px] text-left text-[12.5px] text-[var(--essay-text-muted)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
      >
        <span className="min-w-0 flex-1 truncate">
          {truncateMiddle(item.anchor.selectedText, 64) || '(empty selection)'}
        </span>
        {through && (
          <span className="max-w-[40%] shrink-0 truncate text-[10.5px] text-[var(--essay-text-faint)]">
            through {through}
          </span>
        )}
        {item.entries.length > 1 && (
          <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--essay-text-faint)]">
            {item.entries.length}
          </span>
        )}
      </button>
    </li>
  )
}

/** Who wrote an entry, in a single author's product: the person, or the
    agent by name. */
function actorLabel(entry: CommentItem['entries'][number]): string {
  if (entry.actorKind === 'agent') return entry.actorId ?? 'Agent'
  return entry.actorId ?? 'You'
}

/**
 * One thread, in the Structure slot it replaced — Back returns the reading.
 * Entries, a plain reply field, Resolve/Reopen (never a manuscript byte),
 * Delete, and for an unplaced thread the Reattach verb that needs a live
 * selection to point at.
 */
function ThreadDetail({
  comments,
  item,
}: {
  comments: SidebarComments
  item: CommentItem
}) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const range = comments.rangeOf(item.thread.id)
  const open = item.thread.state === 'open'

  // Other open threads sharing any of this range: the count shown at the
  // active location, one layer in the text, siblings one click away here.
  const overlapping = range
    ? comments.items.filter((other) => {
        if (other.thread.id === item.thread.id) return false
        if (other.thread.state !== 'open') return false
        const r = comments.rangeOf(other.thread.id)
        return r !== null && r.from < range.to && r.to > range.from
      })
    : []

  const sendReply = async () => {
    const body = reply.trim()
    if (!body || busy) return
    setBusy(true)
    const ok = await comments.onReply(item.thread.id, body)
    setBusy(false)
    if (ok) setReply('')
  }

  const onReplyKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendReply()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      comments.onBack()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-1.5 px-2 pt-3 pb-1">
        <button
          type="button"
          onClick={comments.onBack}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--essay-text-muted)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
        >
          <ArrowLeft size={11} aria-hidden />
          Structure
        </button>
        <span className="ml-auto pr-1 text-[10.5px] text-[var(--essay-text-faint)]">
          {open ? 'open' : 'resolved'}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        <blockquote className="mt-1 mb-2 border-l-2 border-[var(--essay-border-strong)] pl-2 text-[12px] leading-[1.5] text-[var(--essay-text-muted)] italic">
          {truncateMiddle(item.anchor.selectedText, 180) || '(empty selection)'}
        </blockquote>

        {!range && (
          <p className="mb-2 rounded-md bg-[var(--essay-surface)] px-2 py-1.5 text-[11.5px] leading-[1.5] text-[var(--essay-text-muted)]">
            This comment lost its place — the passage it described changed too
            much to find again. Select where it belongs and reattach it.
          </p>
        )}

        {overlapping.length > 0 && (
          <div className="mb-2">
            <p className="text-[10.5px] text-[var(--essay-text-faint)]">
              {overlapping.length + 1} comments on this passage
            </p>
            <ul>
              {overlapping.map((other) => (
                <li key={other.thread.id}>
                  <button
                    type="button"
                    onClick={() => comments.onOpen(other.thread.id)}
                    className="w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11.5px] text-[var(--essay-text-faint)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text-muted)]"
                  >
                    {truncateMiddle(other.entries[0]?.body ?? '', 56)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {item.entries.map((entry) => (
            <li key={entry.id}>
              <p className="text-[10.5px] text-[var(--essay-text-faint)]">
                {actorLabel(entry)} · {revisionTime(entry.createdAt)}
              </p>
              <p className="text-[12.5px] leading-[1.5] whitespace-pre-wrap text-[var(--essay-text)]">
                {entry.body}
              </p>
            </li>
          ))}
        </ul>

        <textarea
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={onReplyKeys}
          rows={2}
          placeholder="Reply…"
          aria-label="Reply"
          spellCheck
          className="mt-2 w-full resize-none rounded-md bg-[var(--essay-surface)] px-2 py-1.5 text-[12.5px] leading-[1.5] text-[var(--essay-text)] outline-none placeholder:text-[var(--essay-text-faint)] focus-visible:outline-1 focus-visible:outline-[var(--essay-border-strong)]"
        />
      </div>

      <footer className="flex shrink-0 items-center gap-1 px-3 pt-1 pb-3">
        {open ? (
          <DetailButton onClick={() => comments.onResolve(item.thread.id)}>
            Resolve
          </DetailButton>
        ) : (
          <DetailButton onClick={() => comments.onReopen(item.thread.id)}>
            Reopen
          </DetailButton>
        )}
        {!range && open && (
          <DetailButton
            disabled={comments.selectionEmpty}
            title={
              comments.selectionEmpty
                ? 'Select the passage this comment belongs to first'
                : 'Attach this comment to the current selection'
            }
            onClick={() => void comments.onReattach(item.thread.id)}
          >
            Reattach
          </DetailButton>
        )}
        <DetailButton
          className="ml-auto"
          onClick={() => {
            if (window.confirm('Delete this comment thread?')) {
              comments.onDelete(item.thread.id)
            }
          }}
        >
          Delete
        </DetailButton>
      </footer>
    </div>
  )
}

function DetailButton({
  children,
  disabled,
  title,
  className,
  onClick,
}: {
  children: string
  disabled?: boolean
  title?: string
  className?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'h-6 shrink-0 rounded-md px-2 text-[11px] font-[var(--essay-weight-medium)]',
        'transition-colors duration-[var(--essay-speed-quick)] ease-[var(--essay-ease-out)]',
        'text-[var(--essay-text-muted)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]',
        'disabled:opacity-40 disabled:hover:bg-transparent',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
        className,
      )}
    >
      {children}
    </button>
  )
}
