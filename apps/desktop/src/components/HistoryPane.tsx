import { useCallback, useEffect, useState } from 'react'
import { cn } from '#/lib/cn'
import {
  AgentIcon,
  CheckpointIcon,
  CollapseIcon,
  DocumentIcon,
  EditIcon,
  ExpandIcon,
  HistoryIcon,
  OnDiskIcon,
  RevertIcon,
  type Icon,
} from '#/lib/icons'
import {
  authorLabel,
  listRevisions,
  originLabel,
  revisionTime,
  type Revision,
  type RevisionOrigin,
} from '#/lib/revisions'

/**
 * The document's editorial history: what happened to this manuscript, in
 * order, with a way back to any of it.
 *
 * Distinct from undo, which answers "what did I type a few seconds ago?".
 * This answers "how did this document change over the last week, and who
 * changed it?" — the question that only has an answer because every save,
 * every agent patch and every edit made outside Essay has been snapshotted
 * since the file was first opened.
 *
 * Reading is free and restoring is guarded, so a row is safe to click: it
 * opens a diff against the document as it stands now, and putting the older
 * version back is a decision made from inside that review rather than from
 * the list.
 */
interface HistoryPaneProps {
  /** null for an untitled buffer, which has no folder to keep history in. */
  documentPath: string | null
  /** Bumped by the workspace when something happened that history should
      reflect — a save, a restore, an agent's patch landing. */
  version: number
  /** Content hash the editor believes is on disk, so the row holding it can
      say so. */
  currentHash: string | null
  onCompare: (revision: Revision) => void
  onCheckpoint: () => void
}

const OPEN_KEY = 'essay.history.open'

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

export function HistoryPane({
  documentPath,
  version,
  currentHash,
  onCompare,
  onCheckpoint,
}: HistoryPaneProps) {
  const [open, setOpen] = useState(loadOpen)
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [loaded, setLoaded] = useState(false)

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      const next = !wasOpen
      try {
        localStorage.setItem(OPEN_KEY, next ? '1' : '0')
      } catch {
        // A pane that cannot remember its own state is still a working pane.
      }
      return next
    })
  }, [])

  // Only while the pane is actually showing: a closed pane querying SQLite on
  // every keystroke-driven save would be work nobody asked for, and history
  // is not needed to answer any question the chrome asks while it is shut.
  useEffect(() => {
    if (!open || !documentPath) {
      setRevisions([])
      setLoaded(false)
      return
    }
    let live = true
    void listRevisions(documentPath).then((rows) => {
      if (!live) return
      setRevisions(rows)
      setLoaded(true)
    })
    return () => {
      live = false
    }
  }, [open, documentPath, version])

  return (
    <section
      className={cn(
        'flex min-h-0 flex-col',
        open && 'h-full flex-1',
      )}
    >
      <header className="flex items-center gap-1.5 px-3 pt-3 pb-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="-ml-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors duration-[var(--essay-speed-quick)] ease-[var(--essay-ease-out)] hover:bg-[var(--essay-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
        >
          {open ? (
            <CollapseIcon size={11} aria-hidden className="text-[var(--essay-text-faint)]" />
          ) : (
            <ExpandIcon size={11} aria-hidden className="text-[var(--essay-text-faint)]" />
          )}
          <HistoryIcon size={12} aria-hidden className="text-[var(--essay-text-faint)]" />
          <h2 className="text-[11px] font-[510] tracking-wider text-[var(--essay-text-faint)] uppercase">
            History
          </h2>
          {open && loaded && revisions.length > 0 && (
            <span className="text-[11px] tabular-nums text-[var(--essay-text-faint)]">
              {revisions.length}
            </span>
          )}
        </button>
        {open && documentPath && (
          <button
            type="button"
            onClick={onCheckpoint}
            title="Mark the document as it stands as a state worth keeping"
            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--essay-text-muted)] transition-colors duration-[var(--essay-speed-quick)] ease-[var(--essay-ease-out)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
          >
            <CheckpointIcon size={11} aria-hidden />
            Mark
          </button>
        )}
      </header>

      {open && (
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {!documentPath ? (
            <p className="px-2 py-1 text-[13px] leading-[1.45] text-[var(--essay-text-faint)]">
              Save this document to start keeping its history.
            </p>
          ) : !loaded ? null : revisions.length === 0 ? (
            <p className="px-2 py-1 text-[13px] text-[var(--essay-text-faint)]">
              Nothing recorded yet
            </p>
          ) : (
            <ul>
              {revisions.map((revision) => (
                <RevisionRow
                  key={revision.id}
                  revision={revision}
                  current={revision.sourceHash === currentHash}
                  onSelect={() => onCompare(revision)}
                />
              ))}
            </ul>
          )}
        </nav>
      )}
    </section>
  )
}

/**
 * What kind of event this was, at a glance.
 *
 * The distinction the column exists for is *who*: an agent's patch and an
 * edit that arrived from outside Essay read differently from the author's own
 * typing, and a timeline that rendered all three the same would bury the only
 * rows anybody scans for.
 */
const ORIGIN_ICON: Record<RevisionOrigin, Icon> = {
  humanSession: EditIcon,
  agentPatch: AgentIcon,
  externalEdit: OnDiskIcon,
  import: DocumentIcon,
  checkpoint: CheckpointIcon,
  restore: RevertIcon,
}

function RevisionRow({
  revision,
  current,
  onSelect,
}: {
  revision: Revision
  current: boolean
  onSelect: () => void
}) {
  const OriginIcon = ORIGIN_ICON[revision.origin]
  const words = revision.wordsInserted + revision.wordsRemoved
  // A checkpoint is the author saying "this one matters", so it is the one
  // row that keeps its weight when the eye scans past.
  const marked = revision.origin === 'checkpoint'

  return (
    <li>
      {/* min-h rather than a fixed height: every row is the same two-line
          shape, so this pins the rhythm while never clipping a tall glyph. */}
      <button
        type="button"
        onClick={onSelect}
        title={`Compare with the document now — ${originLabel(revision.origin)} by ${authorLabel(revision.author)}`}
        className="group flex min-h-[44px] w-full items-center gap-2 rounded-md px-2 py-[5px] text-left transition-colors duration-[var(--essay-speed-quick)] ease-[var(--essay-ease-out)] hover:bg-[var(--essay-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--essay-accent)]"
      >
        <OriginIcon
          size={12}
          weight={marked ? 'fill' : 'regular'}
          aria-hidden
          className={cn(
            'shrink-0',
            marked
              ? 'text-[var(--essay-accent)]'
              : 'text-[var(--essay-text-faint)]',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            {/* The origin as a quiet chip, not a sentence: the timeline is
                scanned by kind, and a bordered tab reads as a category where
                running text reads as a message. Border on surface, not the
                hover token as fill — a surface-hover chip would vanish into
                the row's own hover. */}
            <span
              className={cn(
                'shrink-0 rounded-[4px] border border-[var(--essay-border)] bg-[var(--essay-surface)] px-1.5 py-px text-[10.5px] leading-[1.5]',
                marked
                  ? 'text-[var(--essay-accent)]'
                  : current
                    ? 'text-[var(--essay-text)]'
                    : 'text-[var(--essay-text-muted)]',
              )}
            >
              {originLabel(revision.origin)}
            </span>
            {revision.author.kind === 'agent' && (
              <span
                className={cn(
                  'truncate text-[12px]',
                  current
                    ? 'text-[var(--essay-text)]'
                    : 'text-[var(--essay-text-muted)] group-hover:text-[var(--essay-text)]',
                )}
              >
                {revision.author.name}
              </span>
            )}
          </span>
          <span className="mt-px block truncate text-[11px] text-[var(--essay-text-faint)] tabular-nums">
            {revisionTime(revision.createdAt)}
            {current && ' · current'}
            {words > 0 && (
              <>
                {' · '}
                <span className="text-[var(--essay-diff-insert)]">
                  +{revision.wordsInserted}
                </span>
                <span className="text-[var(--essay-diff-remove)]">
                  /−{revision.wordsRemoved}
                </span>
              </>
            )}
          </span>
        </span>
        {current && (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-[var(--essay-accent)]"
          />
        )}
      </button>
    </li>
  )
}
