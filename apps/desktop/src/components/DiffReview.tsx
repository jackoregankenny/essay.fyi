import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CloseIcon,
  CollapseIcon,
  ExpandIcon,
  MovedIcon,
  RewriteIcon,
} from '#/lib/icons'
import { cn } from '#/lib/cn'
import {
  changedSections,
  hasMoved,
  isPureReordering,
  looksLikeARewrite,
  type DiffLine,
  type DocumentDiff,
  type Hunk,
  type SectionChange,
  type SectionStatus,
} from '#/lib/diff'
import type { NoticeAction } from './Notice'
import { IconButton } from './ui/icon-button'

/**
 * Review surface for a change to the manuscript: what changed, section by
 * section, and then line by line.
 *
 * Section-first on purpose. A line diff of a restructured document is a wall
 * of deletions beside a wall of insertions, and the question an author
 * actually has — *did this edit my document or regenerate it?* — is only
 * answerable at the structural level. The line view is the second question,
 * asked once the first has an answer.
 *
 * Takes a `DocumentDiff` and nothing else about where it came from, so the
 * agent panel can hand it a ChangeSet's diff on the same terms as the
 * disk-conflict bar hands it the file's.
 */
export interface DiffReviewProps {
  diff: DocumentDiff
  /** What is being compared — usually the document's name. */
  title: string
  /** Where the other version came from: an agent, the file, a revision. */
  provenance?: ReactNode
  /** What the two sides are, for the diff legend. */
  oldLabel?: string
  newLabel?: string
  /** Decisions about the change; the agent panel will pass accept/reject. */
  actions?: NoticeAction[]
  onClose: () => void
  className?: string
}

/**
 * Everything a review needs except where it is mounted and how it closes —
 * the shape a caller hands over when it asks the workspace to show a diff.
 * Lets the agent panel compose its own review, actions and all, without the
 * workspace having to know what an agent is.
 */
export type ReviewRequest = Omit<DiffReviewProps, 'onClose' | 'className'>

/**
 * Lines of diff rendered before the surface stops and offers "show more".
 * A forty-page manuscript rewritten wholesale is thousands of lines, and
 * nobody reads those in one scroll — this keeps the DOM in the hundreds
 * without pretending the rest is not there.
 */
const LINE_BUDGET = 250

export function DiffReview({
  diff,
  title,
  provenance,
  oldLabel = 'Before',
  newLabel = 'After',
  actions = [],
  onClose,
  className,
}: DiffReviewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [pages, setPages] = useState(1)
  const [showUnchanged, setShowUnchanged] = useState(false)

  // The manuscript is still mounted underneath and still has focus; moving it
  // here is what stops keystrokes landing in a document the author cannot see.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const changed = useMemo(() => changedSections(diff), [diff])
  const unchanged = diff.sections.length - changed.length
  const reordering = isPureReordering(diff)
  const rewrite = looksLikeARewrite(diff)

  const visibleHunks = useMemo(() => {
    const budget = LINE_BUDGET * pages
    const out: Hunk[] = []
    let used = 0
    for (const hunk of diff.hunks) {
      if (out.length > 0 && used >= budget) break
      out.push(hunk)
      used += hunk.lines.length
    }
    return out
  }, [diff.hunks, pages])

  const rows = diff.sections.filter((section) => showUnchanged || section.status !== 'unchanged')

  return (
    <section
      aria-label={`Review changes to ${title}`}
      className={cn(
        'essay-pop flex min-h-0 flex-col bg-[var(--essay-editor-bg)]',
        className,
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--essay-border)] px-3">
        <div className="min-w-0 flex-1">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="truncate text-[13px] font-[var(--essay-weight-medium)] text-[var(--essay-text)] outline-none"
          >
            {title}
          </h2>
          {provenance && (
            <p className="truncate text-[11px] text-[var(--essay-text-faint)]">
              {provenance}
            </p>
          )}
        </div>
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
        <IconButton
          onClick={onClose}
          aria-label="Close review and return to writing"
          title="Back to writing (Esc)"
        >
          <CloseIcon size={14} />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[64rem] px-5 py-5">
          <Summary diff={diff} changed={changed.length} reordering={reordering} />
          {rewrite && <RewriteCallout churn={diff.churn} />}

          {diff.sections.length > 0 && (
            <>
              <PaneHeading count={changed.length} label="Changed sections">
                {unchanged > 0 && (
                  <button
                    type="button"
                    aria-expanded={showUnchanged}
                    onClick={() => setShowUnchanged((on) => !on)}
                    className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-[var(--essay-weight-medium)] tracking-normal normal-case text-[var(--essay-text-muted)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
                  >
                    {showUnchanged
                      ? 'Hide unchanged'
                      : `Show ${unchanged} unchanged`}
                  </button>
                )}
              </PaneHeading>
              <ul className="mb-7">
                {rows.map((section, index) => (
                  <SectionRow
                    key={`${section.heading ?? 'preamble'}-${section.oldIndex}-${section.newIndex}-${index}`}
                    section={section}
                  />
                ))}
                {rows.length === 0 && (
                  <li className="px-2 py-3 text-[13px] text-[var(--essay-text-faint)]">
                    No sections changed.
                  </li>
                )}
              </ul>
            </>
          )}

          {diff.hunks.length > 0 && (
            <>
              <PaneHeading count={diff.hunks.length} label="Line changes">
                <Legend oldLabel={oldLabel} newLabel={newLabel} />
              </PaneHeading>
              <div className="flex flex-col gap-2">
                {visibleHunks.map((hunk, index) => (
                  <HunkBlock
                    key={`${hunk.oldStart}-${hunk.newStart}-${index}`}
                    hunk={hunk}
                  />
                ))}
              </div>
              {visibleHunks.length < diff.hunks.length && (
                <button
                  type="button"
                  onClick={() => setPages((n) => n + 1)}
                  className="mt-2 w-full rounded-lg border border-dashed border-[var(--essay-border)] py-2 text-[12px] text-[var(--essay-text-muted)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
                >
                  Show {diff.hunks.length - visibleHunks.length} more changed
                  passages
                </button>
              )}
            </>
          )}

          {diff.hunks.length === 0 && (
            <p className="py-6 text-center text-[13px] text-[var(--essay-text-faint)]">
              The two versions are identical.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * The one sentence the surface exists to say. A pure reordering is asked
 * about first: it still shows words on both sides of the *line* diff, and
 * reporting "+23/−23 words" about a move would be true and misleading.
 */
function Summary({
  diff,
  changed,
  reordering,
}: {
  diff: DocumentDiff
  changed: number
  reordering: boolean
}) {
  const total = diff.sections.length
  const headline = total
    ? `${changed} of ${total} section${total === 1 ? '' : 's'} ${reordering ? 'reordered' : 'changed'}`
    : `${diff.hunks.length} passage${diff.hunks.length === 1 ? '' : 's'} changed`

  return (
    <div className="mb-5">
      <p className="text-[15px] font-[var(--essay-weight-medium)] text-[var(--essay-text)]">
        {headline}
      </p>
      <p className="mt-0.5 text-[12px] text-[var(--essay-text-muted)] tabular-nums">
        {reordering ? (
          'No words written or deleted.'
        ) : (
          <>
            <Delta
              inserted={diff.stats.wordsInserted}
              removed={diff.stats.wordsRemoved}
              unit="words"
            />
            <span className="mx-1.5 text-[var(--essay-text-faint)]">·</span>
            <Delta
              inserted={diff.linesInserted}
              removed={diff.linesRemoved}
              unit="lines"
            />
          </>
        )}
      </p>
    </div>
  )
}

/**
 * The distinction this whole surface is for. Prominent, because an author who
 * misses it has lost a document's worth of their own phrasing; not alarming,
 * because a rewrite can be exactly what was asked for.
 */
function RewriteCallout({ churn }: { churn: number }) {
  return (
    <div className="mb-6 flex gap-3 rounded-xl bg-[var(--essay-accent-tint)] px-3.5 py-3">
      <RewriteIcon
        size={15}
        weight="bold"
        aria-hidden
        className="mt-[2px] shrink-0 text-[var(--essay-accent)]"
      />
      <div className="min-w-0">
        <p className="text-[13px] font-[var(--essay-weight-medium)] text-[var(--essay-text)]">
          This reads as a rewrite, not an edit
        </p>
        <p className="mt-0.5 text-[12px] leading-[1.5] text-[var(--essay-text-muted)]">
          {Math.round(churn * 100)}% of the sections changed. A targeted edit
          leaves the rest of the manuscript untouched; this version was
          largely regenerated, so wording you chose may have gone with it.
        </p>
      </div>
    </div>
  )
}

function PaneHeading({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children?: ReactNode
}) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <h3 className="text-[11px] font-[510] tracking-wider text-[var(--essay-text-faint)] uppercase">
        {label}
      </h3>
      <span className="text-[11px] tabular-nums text-[var(--essay-text-faint)]">
        {count}
      </span>
      {children}
    </div>
  )
}

function Legend({
  oldLabel,
  newLabel,
}: {
  oldLabel: string
  newLabel: string
}) {
  return (
    <p className="ml-auto flex items-center gap-3 font-(family-name:--essay-font-mono) text-[10px] text-[var(--essay-text-muted)]">
      <span>
        <span className="text-[var(--essay-diff-remove)]">−</span> {oldLabel}
      </span>
      <span>
        <span className="text-[var(--essay-diff-insert)]">+</span> {newLabel}
      </span>
    </p>
  )
}

const STATUS_LABEL: Record<SectionStatus, string> = {
  unchanged: 'unchanged',
  edited: 'edited',
  moved: 'moved',
  movedAndEdited: 'moved + edited',
  added: 'added',
  removed: 'removed',
}

function SectionRow({ section }: { section: SectionChange }) {
  const moved = hasMoved(section)
  const words = section.stats.wordsInserted + section.stats.wordsRemoved

  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-[7px] hover:bg-[var(--essay-surface-hover)]">
      <StatusPill status={section.status} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13px]',
          section.status === 'unchanged'
            ? 'text-[var(--essay-text-faint)]'
            : 'text-[var(--essay-text)]',
          section.heading === null && 'italic',
        )}
        // Heading depth, so a reader can see where in the document they are.
        style={{ paddingLeft: Math.max(section.depth - 1, 0) * 12 }}
      >
        {section.heading ?? 'Before the first heading'}
      </span>
      {/* A move is not an edit, so it reports a position and no word delta —
          the single most misread thing in a prose diff. */}
      {moved && section.oldIndex !== null && section.newIndex !== null && (
        <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-[var(--essay-text-muted)]">
          <MovedIcon size={11} aria-hidden />
          position {section.oldIndex + 1} → {section.newIndex + 1}
        </span>
      )}
      {words > 0 && (
        <Delta
          inserted={section.stats.wordsInserted}
          removed={section.stats.wordsRemoved}
          className="shrink-0 text-[11px]"
        />
      )}
    </li>
  )
}

/**
 * The hue tints the chip, the word says what happened, and the ink stays at
 * body contrast. Tinted ink on a tinted chip is the prettier version and it
 * measured 4.2:1 for `edited` in the light theme — under AA for a 10px label,
 * which is exactly the size nobody can afford to squint at.
 */
function StatusPill({ status }: { status: SectionStatus }) {
  const tone: Record<SectionStatus, string> = {
    unchanged:
      'bg-[var(--essay-surface-hover)] text-[var(--essay-text-muted)]',
    edited: 'bg-[var(--essay-accent-tint)] text-[var(--essay-text)]',
    moved: 'bg-[var(--essay-surface-hover)] text-[var(--essay-text)]',
    movedAndEdited: 'bg-[var(--essay-accent-tint)] text-[var(--essay-text)]',
    added: 'bg-[var(--essay-diff-insert-bg)] text-[var(--essay-text)]',
    removed: 'bg-[var(--essay-diff-remove-bg)] text-[var(--essay-text)]',
  }
  return (
    <span
      className={cn(
        'inline-flex h-[18px] w-[86px] shrink-0 items-center justify-center rounded-[5px]',
        'text-[10px] font-[var(--essay-weight-semibold)] tracking-wide',
        tone[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

/** "+9/−17". Colour carries the sense, the signs carry it again. */
function Delta({
  inserted,
  removed,
  unit,
  className,
}: {
  inserted: number
  removed: number
  unit?: string
  className?: string
}) {
  return (
    <span
      className={cn('tabular-nums', className)}
      aria-label={`${inserted} ${unit ?? 'words'} added, ${removed} removed`}
    >
      <span className="text-[var(--essay-diff-insert)]">+{inserted}</span>
      <span className="text-[var(--essay-text-faint)]">/</span>
      <span className="text-[var(--essay-diff-remove)]">−{removed}</span>
      {unit && <span className="text-[var(--essay-text-muted)]"> {unit}</span>}
    </span>
  )
}

function HunkBlock({ hunk }: { hunk: Hunk }) {
  const [open, setOpen] = useState(true)
  const oldEnd = hunk.oldStart + Math.max(hunk.oldLines - 1, 0)
  const newEnd = hunk.newStart + Math.max(hunk.newLines - 1, 0)
  const range = `Lines ${hunk.oldStart}–${oldEnd} → ${hunk.newStart}–${newEnd}`
  const inserted = hunk.lines.filter((line) => line.tag === 'insert').length
  const removed = hunk.lines.filter((line) => line.tag === 'delete').length

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--essay-border)]">
      <h4>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((on) => !on)}
          className="flex w-full items-center gap-1.5 bg-[var(--essay-surface)] px-2 py-1.5 text-left transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--essay-accent)]"
        >
          {open ? (
            <CollapseIcon size={11} aria-hidden className="text-[var(--essay-text-faint)]" />
          ) : (
            <ExpandIcon size={11} aria-hidden className="text-[var(--essay-text-faint)]" />
          )}
          <span className="font-(family-name:--essay-font-mono) text-[11px] tabular-nums text-[var(--essay-text-muted)]">
            {range}
          </span>
          <Delta
            inserted={inserted}
            removed={removed}
            className="ml-auto text-[11px]"
          />
        </button>
      </h4>
      {open && (
        <table className="w-full border-collapse font-(family-name:--essay-font-mono) text-[12px] leading-[1.55]">
          <caption className="sr-only">
            {range}. Columns: line number before, line number after, change,
            text.
          </caption>
          <tbody>
            {hunk.lines.map((line, index) => (
              <DiffRow key={index} line={line} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const SIGN: Record<DiffLine['tag'], string> = {
  context: ' ',
  insert: '+',
  delete: '−',
}

function DiffRow({ line }: { line: DiffLine }) {
  const tint =
    line.tag === 'insert'
      ? 'bg-[var(--essay-diff-insert-bg)]'
      : line.tag === 'delete'
        ? 'bg-[var(--essay-diff-remove-bg)]'
        : ''
  const ink =
    line.tag === 'insert'
      ? 'text-[var(--essay-diff-insert)]'
      : line.tag === 'delete'
        ? 'text-[var(--essay-diff-remove)]'
        : 'text-[var(--essay-text-faint)]'

  // The tint starts at the sign column: line numbers stay on the panel
  // background, where faint ink is the contrast the rest of the app already
  // ships. Over a tint it measured 3.2:1, which is not a number to put a
  // 10px numeral on.
  return (
    <tr>
      <td className="w-9 select-none border-r border-[var(--essay-border)] px-1 text-right align-top text-[10px] tabular-nums text-[var(--essay-text-muted)]">
        {line.oldLine ?? ''}
      </td>
      <td className="w-9 select-none border-r border-[var(--essay-border)] px-1 text-right align-top text-[10px] tabular-nums text-[var(--essay-text-muted)]">
        {line.newLine ?? ''}
      </td>
      {/* The sign, not the tint, is what makes this readable without colour. */}
      <td className={cn('w-4 select-none text-center align-top', tint, ink)}>
        {SIGN[line.tag]}
      </td>
      <td
        className={cn(
          'w-full py-[1px] pr-2 pl-1 align-top break-words whitespace-pre-wrap',
          tint,
          line.tag === 'context'
            ? 'text-[var(--essay-text-muted)]'
            : 'text-[var(--essay-text)]',
        )}
      >
        {line.text || ' '}
      </td>
    </tr>
  )
}
