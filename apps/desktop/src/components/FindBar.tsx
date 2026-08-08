import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  ArrowDown,
  ArrowUp,
  CaretDown,
  CaretRight,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react'
import { FindController, type Editor, type FindState } from '@essay/editor'
import { cn } from '#/lib/cn'
import { IconButton } from './ui/icon-button'

/**
 * The in-manuscript find strip (docs/authoring-backlog.md item 1).
 *
 * A row in flow above the manuscript, like the Notice bar — never a floating
 * card over the words (docs/ui-overhaul.md rule 8: opening tools claim real
 * layout space, reflowing the manuscript once). The editor stays mounted
 * underneath with its selection and scroll intact; closing hands focus back
 * and the controller takes its highlights down on unmount.
 *
 * Matching happens entirely in memory (@essay/editor's find.ts) — typing in
 * the query never calls Rust. Project-wide search stays in the palette.
 */
export function FindBar({
  editor,
  summon = 0,
  onClose,
}: {
  editor: Editor
  /** Bumped when Ctrl+F is pressed while the strip is already open: focus
      returns to the query, re-seeded from a fresh selection. */
  summon?: number
  onClose: () => void
}) {
  const controllerRef = useRef<FindController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<FindState | null>(null)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replacement, setReplacement] = useState('')
  /** What the last Replace all did — cleared the moment the query moves on. */
  const [replacedNote, setReplacedNote] = useState<string | null>(null)

  useEffect(() => {
    const controller = new FindController(editor, (next) => {
      setState(next)
      if (next.cause === 'query') setReplacedNote(null)
    })
    controllerRef.current = controller
    return () => {
      controller.destroy()
      controllerRef.current = null
    }
  }, [editor])

  /** Seed from the selection when it reads as a phrase: non-empty, one
      block, no giant sweep — an author who selected a word and hit Ctrl+F
      means "find this". A multi-block selection is a different gesture. */
  const seedFromSelection = useCallback(() => {
    const { from, to, empty, $from, $to } = editor.state.selection
    if (empty || !$from.sameParent($to)) return
    const seed = editor.state.doc.textBetween(from, to)
    if (seed.trim() && seed.length <= 200) controllerRef.current?.setQuery(seed)
  }, [editor])

  // On open and on every re-summon: seed, then focus without scrolling — the
  // strip is at the top of the column and the author's place in the
  // manuscript must not move when it opens. (Runs after the controller
  // effect above; declaration order is the guarantee.)
  useEffect(() => {
    seedFromSelection()
    inputRef.current?.focus({ preventScroll: true })
    inputRef.current?.select()
  }, [summon, seedFromSelection])

  const matches = state?.matches ?? []
  const activeIndex = state?.activeIndex ?? -1
  const active = matches[activeIndex] ?? null
  const query = state?.query ?? ''
  const caseSensitive = state?.options.caseSensitive ?? false
  const wholeWord = state?.options.wholeWord ?? false

  // The active match glides into view — for navigation, a fresh query, or a
  // replacement, never for a doc-driven recompute: the author typing in the
  // manuscript with the strip open must not have their scroll yanked back
  // to a match. Scrolls the block, steals no focus.
  useEffect(() => {
    if (!state || state.activeIndex < 0) return
    if (state.cause !== 'navigate' && state.cause !== 'query' && state.cause !== 'replace')
      return
    const match = state.matches[state.activeIndex]
    try {
      const dom = editor.view.domAtPos(match.from).node
      const el = dom instanceof HTMLElement ? dom : dom.parentElement
      el?.scrollIntoView({ block: 'center' })
    } catch {
      // A stale position between recomputes resolves nowhere; the next
      // recompute paints and scrolls correctly.
    }
  }, [state, editor])

  const setQuery = useCallback((value: string) => {
    controllerRef.current?.setQuery(value)
  }, [])

  const replaceOne = useCallback(() => {
    const controller = controllerRef.current
    if (!controller) return
    if (controller.replaceActive(replacement)) setReplacedNote(null)
  }, [replacement])

  const replaceAll = useCallback(() => {
    const controller = controllerRef.current
    if (!controller) return
    const total = controller.state().matches.length
    const replaced = controller.replaceAll(replacement)
    const skipped = total - replaced
    setReplacedNote(
      replaced === 0
        ? 'Nothing replaced'
        : skipped > 0
          ? `Replaced ${replaced}, skipped ${skipped} across blocks`
          : `Replaced ${replaced}`,
    )
  }, [replacement])

  const onQueryKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        if (event.shiftKey) controllerRef.current?.previous()
        else controllerRef.current?.next()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (
        // `code`, not `key`: on macOS Alt+C arrives as 'ç'. Same convention
        // as the palette's search toggles.
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (event.code === 'KeyC' || event.code === 'KeyW')
      ) {
        event.preventDefault()
        const controller = controllerRef.current
        if (!controller) return
        if (event.code === 'KeyC') controller.setOptions({ caseSensitive: !caseSensitive })
        else controller.setOptions({ wholeWord: !wholeWord })
      }
    },
    [onClose, caseSensitive, wholeWord],
  )

  const count =
    query.length === 0
      ? ''
      : matches.length === 0
        ? 'No matches'
        : `${activeIndex + 1} of ${matches.length}`

  const replaceDisabledWhy =
    matches.length === 0
      ? 'No match to replace'
      : active && !active.replaceable
        ? 'This match crosses a block boundary and cannot be replaced in place'
        : undefined

  return (
    <div
      role="search"
      aria-label="Find in document"
      className={cn(
        // Same arrival as the Notice bar: a strip settling in from under the
        // header, transform + opacity only. Reduced motion keeps the fade.
        'motion-safe:animate-[essay-pop_var(--essay-speed-regular)_var(--essay-ease-swift)_both]',
        'motion-reduce:animate-[essay-fade_var(--essay-speed-regular)_var(--essay-ease-out)_both]',
        'border-b border-[var(--essay-border)] bg-[var(--essay-surface)]',
        'text-[12px] text-[var(--essay-text-muted)]',
      )}
    >
      <div className="flex items-center gap-2 py-1.5 pr-2 pl-3.5">
        <MagnifyingGlass size={14} className="shrink-0 text-[var(--essay-text-faint)]" />
        <input
          ref={inputRef}
          value={query}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onQueryKeyDown}
          placeholder="Find in document…"
          aria-label="Find"
          className="h-6 w-full min-w-0 flex-1 bg-transparent text-[12px] text-[var(--essay-text)] outline-none placeholder:text-[var(--essay-text-faint)]"
        />
        <span
          aria-live="polite"
          className={cn(
            'shrink-0 tabular-nums',
            query && matches.length === 0
              ? 'text-[var(--essay-text-muted)]'
              : 'text-[var(--essay-text-faint)]',
          )}
        >
          {count}
        </span>
        <TogglePill
          label="Aa"
          title="Match case (Alt+C)"
          on={caseSensitive}
          onToggle={() => controllerRef.current?.setOptions({ caseSensitive: !caseSensitive })}
        />
        <TogglePill
          label="Word"
          title="Whole word (Alt+W)"
          on={wholeWord}
          onToggle={() => controllerRef.current?.setOptions({ wholeWord: !wholeWord })}
        />
        <IconButton
          aria-label="Previous match (Shift+Enter)"
          title="Previous match (Shift+Enter)"
          disabled={matches.length === 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => controllerRef.current?.previous()}
          className="h-6 w-6"
        >
          <ArrowUp size={13} />
        </IconButton>
        <IconButton
          aria-label="Next match (Enter)"
          title="Next match (Enter)"
          disabled={matches.length === 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => controllerRef.current?.next()}
          className="h-6 w-6"
        >
          <ArrowDown size={13} />
        </IconButton>
        <button
          type="button"
          aria-expanded={replaceOpen}
          onClick={() => setReplaceOpen((open) => !open)}
          className={cn(
            'flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px]',
            'transition-colors duration-[var(--essay-speed-quick)] ease-[var(--essay-ease-out)]',
            replaceOpen
              ? 'text-[var(--essay-text)]'
              : 'text-[var(--essay-text-faint)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]',
          )}
        >
          {replaceOpen ? (
            <CaretDown size={10} aria-hidden />
          ) : (
            <CaretRight size={10} aria-hidden />
          )}
          Replace
        </button>
        <IconButton aria-label="Close find (Esc)" onClick={onClose} className="h-6 w-6">
          <X size={13} />
        </IconButton>
      </div>
      {replaceOpen && (
        <div className="flex items-center gap-2 border-t border-[var(--essay-border)] py-1.5 pr-2 pl-3.5">
          {/* Indent under the query text, past the icon. */}
          <span aria-hidden className="w-[14px] shrink-0" />
          <input
            value={replacement}
            spellCheck={false}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                replaceOne()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              }
            }}
            placeholder="Replace with…"
            aria-label="Replace with"
            className="h-6 w-full min-w-0 flex-1 bg-transparent text-[12px] text-[var(--essay-text)] outline-none placeholder:text-[var(--essay-text-faint)]"
          />
          {replacedNote && (
            <span className="shrink-0 text-[11px] text-[var(--essay-text-faint)]">
              {replacedNote}
            </span>
          )}
          <BarButton
            disabled={Boolean(replaceDisabledWhy)}
            title={replaceDisabledWhy ?? 'Replace the active match (Enter)'}
            onClick={replaceOne}
          >
            Replace
          </BarButton>
          <BarButton
            disabled={matches.length === 0}
            title={
              matches.length === 0
                ? 'No matches to replace'
                : 'Replace every match — one undo step'
            }
            onClick={replaceAll}
          >
            Replace all
          </BarButton>
        </div>
      )}
    </div>
  )
}

/** The Notice bar's quiet action button, sized for the strip. */
function BarButton({
  children,
  disabled,
  title,
  onClick,
}: {
  children: string
  disabled?: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'h-6 shrink-0 rounded-md px-2 text-[11px] font-[var(--essay-weight-medium)]',
        'transition-colors duration-[var(--essay-speed-quick)] ease-[var(--essay-ease-out)]',
        'text-[var(--essay-text-muted)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]',
        'disabled:pointer-events-none disabled:opacity-40',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
      )}
    >
      {children}
    </button>
  )
}

/** Case/whole-word toggle, the palette's pill restated for the strip.
    `onMouseDown` is prevented so a click never steals focus from the input. */
function TogglePill({
  label,
  title,
  on,
  onToggle,
}: {
  label: string
  title: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
      className={cn(
        'shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] leading-none',
        'transition-colors duration-[var(--essay-speed-quick)] ease-[var(--essay-ease-out)]',
        on
          ? 'border-[var(--essay-border)] bg-[var(--essay-surface-hover)] text-[var(--essay-text)]'
          : 'border-transparent text-[var(--essay-text-faint)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text-muted)]',
      )}
    >
      {label}
    </button>
  )
}
