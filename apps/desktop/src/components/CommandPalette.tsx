import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Dialog } from '@base-ui-components/react/dialog'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { listCommands } from '@essay/commands'
import type { OutlineItem } from '@essay/editor'
import { cn } from '#/lib/cn'
import { fileName } from '#/lib/documentFile'
import type { SearchOptions } from '#/lib/search'
import { loadRecentFiles } from '#/lib/recents'
import {
  joinPath,
  listMarkdownTree,
  loadWorkspaceFolders,
} from '#/lib/workspace'

interface PaletteEntry {
  key: string
  title: string
  group: string
  shortcut?: string
  keywords?: string
  /** Where the entry came from — a line number, a file. Shown to its right. */
  hint?: string
  run: () => void | Promise<void>
}

/** A match found in the manuscript or the workspace folders. */
export type SearchEntry = Omit<PaletteEntry, 'shortcut' | 'keywords'>

/** A file the palette can open: a recent, or one found in a workspace tree. */
interface QuickOpenFile {
  /** Absolute path on disk. */
  path: string
  /** Basename, shown prominent. */
  name: string
}

/** Shortest query worth walking every folder for. */
const MIN_QUERY = 2

/** Recents shown on an empty query. The store keeps 12; eight rows leave the
    command groups visible below without scrolling. */
const MAX_RECENT_ROWS = 8

/** File matches shown for a query. More than this and the full-text results
    below them stop being reachable without a scroll. */
const MAX_FILE_ROWS = 10

/** Long enough that a typist is not searching after every letter, short
    enough that a reader who has stopped typing does not notice waiting. */
const SEARCH_DELAY = 180

/** How long the exit animation gets before the Root really unmounts. Must
    agree with `--essay-speed-quick` (0.1s) — the closing transition below
    uses that token, and a timeout shorter than it would cut the fade off. */
const CLOSE_MS = 100

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  outline: OutlineItem[]
  onJumpToSection: (item: OutlineItem) => void
  /** Open a document by absolute path — how a recent file is reopened. */
  onOpenFile?: (path: string) => void
  /** Absolute path of the open document, so quick-open never offers the
      author the file they are already in. */
  currentPath?: string | null
  /** Runs the query through `essay-search`. The palette never matches text
      itself — it only asks, and renders what comes back. `options` carries the
      case/whole-word toggles; a caller that ignores it still typechecks. */
  onSearch?: (query: string, options?: SearchOptions) => Promise<SearchEntry[]>
}

export function CommandPalette({
  open,
  onOpenChange,
  outline,
  onJumpToSection,
  onOpenFile,
  currentPath,
  onSearch,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // Held as full palette entries: a result has no shortcut and no keywords,
  // and the two optional fields are what let it sit in the same list.
  const [results, setResults] = useState<PaletteEntry[]>([])
  const [searching, setSearching] = useState(false)
  // Session-only, deliberately never persisted: a half-remembered phrase is
  // not remembered in case (the crate's own doc says the same), so both
  // toggles default off every launch. Reset when the palette is summoned.
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  // Every markdown file under the workspace roots, walked once per palette
  // session. Quick-open lives here rather than in `essay-search` because the
  // frontend already holds these lists — the explorer renders exactly this
  // walk — and matching a filename needs no Rust: no index that can go stale
  // when an agent rewrites a folder behind Essay's back, just the listing,
  // asked for at the moment the palette opens.
  const [workspaceFiles, setWorkspaceFiles] = useState<QuickOpenFile[]>([])
  const listRef = useRef<HTMLUListElement>(null)

  // Entrance/exit choreography. The Root is mounted conditionally (the rc.0
  // unmount gotcha below), so a freshly mounted popup cannot CSS-transition
  // its own arrival — the browser never paints the "from" state. `entered`
  // flips true a double-rAF after mount (same pattern as the Gutter's hover
  // label): first paint lands with the initial styles, the flip transitions
  // to the final ones. `closing` is the mirror image: the exit plays while
  // the Root is still mounted, and a timeout flips the real `open` flag
  // CLOSE_MS later — so the Root still fully unmounts shortly after close,
  // which is what keeps the gotcha satisfied.
  const [entered, setEntered] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)
  // Read once per summons, not subscribed: a preference toggled mid-open can
  // wait for the next open.
  const reduceMotion = useMemo(
    () =>
      open &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [open],
  )

  useEffect(() => {
    if (!open) {
      setEntered(false)
      setClosing(false)
      if (closeTimer.current !== null) {
        clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
      return
    }
    // Double-rAF so the first paint lands on the initial styles — but raced
    // against a timeout, because rAF is not a promise the environment keeps:
    // an occluded window (macOS App Nap, an embedded webview) suspends it
    // entirely, and an entrance gated on a frame that never comes is a
    // palette that opens invisible while holding the focus trap. The timeout
    // costs nothing when rAF wins and saves the surface when it loses.
    let inner: number | null = null
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true))
    })
    const fallback = window.setTimeout(() => setEntered(true), 50)
    return () => {
      cancelAnimationFrame(outer)
      if (inner !== null) cancelAnimationFrame(inner)
      clearTimeout(fallback)
    }
  }, [open])

  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    },
    [],
  )

  /** Play the exit, then flip the real flag. `after` runs at the flip — an
      entry that moves focus (jump-to-section) must not fight the dialog's
      focus trap, which holds until the Root unmounts. A second close request
      during the window is dropped, so double-Enter runs one entry, once. */
  const requestClose = (after?: () => void | Promise<void>) => {
    if (closing) return
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      onOpenChange(false)
      if (after) void after()
    }, CLOSE_MS)
  }

  const entries = useMemo<PaletteEntry[]>(() => {
    if (!open) return []
    const commands = listCommands().map((command) => ({
      key: command.id,
      title: command.title,
      group: command.group ?? 'Commands',
      shortcut: command.shortcut,
      keywords: command.keywords,
      run: command.run,
    }))
    const sections = outline.map((item, i) => ({
      key: `section-${item.pos}-${i}`,
      title: item.text || 'Untitled',
      group: 'Jump to section',
      keywords: 'section heading go jump',
      run: () => onJumpToSection(item),
    }))
    return [...commands, ...sections]
  }, [open, outline, onJumpToSection])

  // Read here rather than held in state: `open` is in the dependency list,
  // so the list is re-read every time the palette is summoned and a file
  // opened a moment ago is already at the top of it. With tabs and the files
  // popover gone this list is how the author moves between documents, so on
  // an empty query it sits above the commands, not below them.
  const recents = useMemo<QuickOpenFile[]>(() => {
    if (!open || !onOpenFile) return []
    return loadRecentFiles()
      .filter((recent) => recent.path !== currentPath)
      .map((recent) => ({ path: recent.path, name: recent.name }))
  }, [open, onOpenFile, currentPath])

  // The trees are walked when the palette opens, not when the author starts
  // typing: a keystroke should only ever match against a list that is already
  // here. One walk per summons is also the freshness story — no cache to
  // invalidate, just a listing no older than the palette itself.
  useEffect(() => {
    if (!open || !onOpenFile) return
    let live = true
    void Promise.all(
      loadWorkspaceFolders().map(async (folder) => {
        try {
          const paths = await listMarkdownTree(folder.path)
          return paths
            .filter((rel) => !rel.endsWith('/'))
            .map((rel) => {
              const path = joinPath(folder.path, rel)
              return { path, name: fileName(path) }
            })
        } catch {
          // A root that fails to list (moved, unmounted, or no desktop shell
          // at all) costs its files a place in quick-open, nothing else.
          return []
        }
      }),
    ).then((trees) => {
      if (live) setWorkspaceFiles(trees.flat())
    })
    return () => {
      live = false
    }
  }, [open, onOpenFile])

  // Filename matches for the query, recents first, deduplicated by path. A
  // plain case-insensitive substring, not the command scorer: a filename is
  // not prose, and "notes" should find `meeting-notes.md` without a word
  // boundary's help. The path is matched too, so typing a folder name finds
  // a document whose own name does not contain it — which is how you tell
  // two `notes.md` apart.
  const fileMatches = useMemo<PaletteEntry[]>(() => {
    const q = query.trim().toLowerCase()
    if (!open || !onOpenFile || q.length < MIN_QUERY) return []
    const seen = new Set<string>()
    const matched: PaletteEntry[] = []
    for (const file of [...recents, ...workspaceFiles]) {
      if (file.path === currentPath || seen.has(file.path)) continue
      const name = file.name.toLowerCase()
      if (!name.includes(q) && !file.path.toLowerCase().includes(q)) continue
      seen.add(file.path)
      matched.push({
        key: `file-${file.path}`,
        title: file.name,
        group: 'Files',
        hint: parentLabel(file.path),
        run: () => onOpenFile(file.path),
      })
      if (matched.length >= MAX_FILE_ROWS) break
    }
    // Name hits before path-only hits; within each, the recents-first,
    // tree-walk order already ranks them.
    return matched.sort(
      (a, b) =>
        Number(b.title.toLowerCase().includes(q)) -
        Number(a.title.toLowerCase().includes(q)),
    )
  }, [open, onOpenFile, query, recents, workspaceFiles, currentPath])

  const recentEntries = useMemo<PaletteEntry[]>(() => {
    if (!onOpenFile) return []
    return recents.slice(0, MAX_RECENT_ROWS).map((file) => ({
      key: `recent-${file.path}`,
      title: file.name,
      group: 'Recent',
      hint: parentLabel(file.path),
      run: () => onOpenFile(file.path),
    }))
  }, [recents, onOpenFile])

  // Search results are appended rather than filtered: they were selected by
  // the query already, and running them back through the command scorer would
  // drop the ones whose excerpt happens not to repeat the words — every
  // case-insensitive or whole-word hit, which is most of them. File matches
  // sit between the two for the same reason, already selected by the query —
  // above the text hits because a filename match is almost always the more
  // deliberate ask.
  const filtered = useMemo(
    () =>
      query.trim()
        ? [...filterEntries(entries, query), ...fileMatches, ...results]
        : [...recentEntries, ...entries],
    [entries, query, recentEntries, fileMatches, results],
  )

  // Which group header is the Nth in the list, for the entrance stagger.
  // Headers remount when the entry that leads their group changes key, so the
  // fade replays when a result set actually changes — not when the highlight
  // moves. Delay is capped so the whole cascade stays within 60ms.
  const headerOrdinals = useMemo(() => {
    const ordinals = new Map<number, number>()
    let n = 0
    filtered.forEach((entry, index) => {
      if (index === 0 || filtered[index - 1].group !== entry.group) {
        ordinals.set(index, n)
        n += 1
      }
    })
    return ordinals
  }, [filtered])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      setResults([])
      setCaseSensitive(false)
      setWholeWord(false)
    }
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    const wanted = query.trim()
    if (!open || !onSearch || wanted.length < MIN_QUERY) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    // Stale results are dropped rather than raced: a folder walk for "riv" can
    // outlive the one for "river", and the author is reading the newer query.
    let live = true
    const timer = setTimeout(() => {
      void onSearch(wanted, { caseSensitive, wholeWord }).then((found) => {
        if (!live) return
        setResults(found)
        setSearching(false)
      })
    }, SEARCH_DELAY)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // A toggle re-runs the same query with the new options — same debounce,
    // 180ms is under what a click-then-read notices.
  }, [open, query, onSearch, caseSensitive, wholeWord])

  const runEntry = (entry: PaletteEntry) => {
    requestClose(() => entry.run())
  }

  const moveActive = (delta: number) => {
    if (!filtered.length) return
    const next = Math.min(Math.max(active + delta, 0), filtered.length - 1)
    setActive(next)
    listRef.current
      ?.querySelector(`[data-index="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  // The toggles belong to the search results, not the palette as a whole, so
  // they render as a slim row directly above the first search group rather
  // than as an adjunct on its header — the group labels are the caller's (and
  // there can be several), and an independent row also stays on screen when
  // the search found nothing, which is exactly when a stuck toggle needs
  // turning off. Not in `filtered`, so arrow keys skip straight over it.
  const showSearchOptions =
    Boolean(onSearch) && query.trim().length >= MIN_QUERY
  const firstResultKey = results[0]?.key
  const searchOptionsRow = showSearchOptions ? (
    <li className="flex items-center justify-between gap-2 px-2.5 pt-2 pb-1">
      <span className="text-[10px] font-medium tracking-wider text-[var(--essay-text-faint)] uppercase">
        Find in text
      </span>
      <div className="flex items-center gap-1">
        <SearchTogglePill
          label="Aa"
          title="Match case (Alt+C)"
          on={caseSensitive}
          onToggle={() => setCaseSensitive((on) => !on)}
        />
        <SearchTogglePill
          label="Word"
          title="Whole word (Alt+W)"
          on={wholeWord}
          onToggle={() => setWholeWord((on) => !on)}
        />
      </div>
    </li>
  ) : null

  // Mounted only while open: closing unmounts the whole Root, which
  // sidesteps Base UI rc.0 never unmounting its popup when the controlled
  // `open` prop flips false (its close path only runs for internal
  // triggers like Escape — which still works here via onOpenChange).
  if (!open) return null

  const settled = entered && !closing
  const backdropStyle: CSSProperties = {
    opacity: settled ? 1 : 0,
    transition: 'opacity var(--essay-speed-quick) var(--essay-ease-out)',
  }
  // The inline transform replaces the `-translate-x-1/2` utility: an inline
  // style always wins, so the horizontal centring must ride along in every
  // state or the panel would jump half its width on arrival.
  const popupStyle: CSSProperties = reduceMotion
    ? {
        opacity: settled ? 1 : 0,
        transform: 'translateX(-50%)',
        transition: 'opacity var(--essay-speed-quick) var(--essay-ease-out)',
      }
    : {
        opacity: settled ? 1 : 0,
        transform: closing
          ? 'translateX(-50%) translateY(-4px) scale(0.99)'
          : entered
            ? 'translateX(-50%)'
            : 'translateX(-50%) translateY(-10px) scale(0.97)',
        // Arrival is deliberately quicker and steeper than the exit: this is
        // the one popover appearing at a fixed, cursor-adjacent point rather
        // than a layer sliding in, so it gets ease-out-quint's emphatic
        // settle instead of ease-swift's spring — a pop, not a glide. The
        // exit stays on the slower curve; only entrance was re-tuned.
        transition: closing
          ? 'opacity var(--essay-speed-quick) var(--essay-ease-out), transform var(--essay-speed-quick) var(--essay-ease-out)'
          : 'opacity 0.18s var(--essay-ease-out-quint), transform 0.18s var(--essay-ease-out-quint)',
      }
  const rowStyle: CSSProperties | undefined = reduceMotion
    ? undefined
    : {
        transition:
          'background-color var(--essay-speed-quick) var(--essay-ease-out), color var(--essay-speed-quick) var(--essay-ease-out)',
      }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // Escape and backdrop clicks land here. Held open until the exit has
        // played; requestClose flips the real flag CLOSE_MS later.
        if (!next) requestClose()
      }}
    >
      <Dialog.Portal>
        {/* Scoped here because this is the palette's only file: headers are
            fresh nodes when a result set changes, so they need an animation
            (fill: both), not a transition, to fade in. */}
        <style>{`
          @keyframes essay-palette-header-in { from { opacity: 0 } to { opacity: 1 } }
          .essay-palette-header {
            animation: essay-palette-header-in var(--essay-speed-quick) var(--essay-ease-out) both;
          }
          @media (prefers-reduced-motion: reduce) {
            .essay-palette-header { animation: none; }
          }
        `}</style>
        {/* 2px is the ceiling, not a starting point — any more and the
            webview is compositing a blur behind a compositor-driven
            transform every frame the popup is animating. */}
        <Dialog.Backdrop
          className="fixed inset-0 z-[var(--essay-z-float)] bg-black/20 backdrop-blur-[2px]"
          style={backdropStyle}
        />
        <Dialog.Popup
          style={popupStyle}
          className="essay-floating fixed top-[16vh] left-1/2 w-[560px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--essay-radius-12)] outline-none"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-[var(--essay-border)] px-3">
            <MagnifyingGlass
              size={15}
              className="shrink-0 text-[var(--essay-text-faint)]"
            />
            <input
              autoFocus
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  moveActive(1)
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  moveActive(-1)
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  const entry = filtered[active]
                  if (entry) runEntry(entry)
                } else if (
                  // `code`, not `key`: on macOS Alt+C is 'ç' by the time it
                  // reaches `key`. Plain typing is untouched — Alt is held.
                  event.altKey &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  (event.code === 'KeyC' || event.code === 'KeyW')
                ) {
                  event.preventDefault()
                  if (event.code === 'KeyC') setCaseSensitive((on) => !on)
                  else setWholeWord((on) => !on)
                }
              }}
              placeholder="Type a command, a section, or a phrase to find…"
              className="h-11 w-full bg-transparent text-[14px] text-[var(--essay-text)] outline-none placeholder:text-[var(--essay-text-faint)]"
            />
          </div>
          <ul ref={listRef} className="max-h-[320px] overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <>
                {searchOptionsRow}
                <li className="px-2.5 py-4 text-center text-[13px] text-[var(--essay-text-faint)]">
                  {searching ? 'Searching…' : 'Nothing found'}
                </li>
              </>
            ) : (
              filtered.map((entry, index) => (
                <Fragment key={entry.key}>
                  {entry.key === firstResultKey && searchOptionsRow}
                  <li>
                  {(index === 0 || filtered[index - 1].group !== entry.group) && (
                    <div
                      className="essay-palette-header px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wider text-[var(--essay-text-faint)] uppercase"
                      style={{
                        animationDelay: `${Math.min(headerOrdinals.get(index) ?? 0, 2) * 30}ms`,
                      }}
                    >
                      {entry.group}
                    </div>
                  )}
                  <button
                    type="button"
                    data-index={index}
                    onMouseMove={() => setActive(index)}
                    onClick={() => runEntry(entry)}
                    style={rowStyle}
                    className={cn(
                      'relative flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px]',
                      index === active
                        ? 'bg-[var(--essay-surface-hover)] text-[var(--essay-text)]'
                        : 'text-[var(--essay-text-muted)]',
                    )}
                  >
                    {/* Absolute, not a flex child with its own width — an
                        accent bar that claimed layout space would nudge the
                        title a pixel on every hover; this one only ever
                        changes opacity. */}
                    <span
                      aria-hidden
                      className="absolute inset-y-1 left-0.5 w-0.5 rounded-full bg-[var(--essay-accent)]"
                      style={{
                        opacity: index === active ? 1 : 0,
                        transition: 'opacity var(--essay-speed-quick) var(--essay-ease-out)',
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                    {entry.hint && (
                      <span className="shrink-0 text-[11px] text-[var(--essay-text-faint)]">
                        {entry.hint}
                      </span>
                    )}
                    {entry.shortcut && (
                      <kbd className="shrink-0 text-[10px] tracking-wide text-[var(--essay-text-faint)]">
                        {entry.shortcut}
                      </kbd>
                    )}
                  </button>
                  </li>
                </Fragment>
              ))
            )}
            {/* Search returned nothing (or is still out) while commands or
                files matched: the row still needs a home at the list's end. */}
            {filtered.length > 0 && !firstResultKey && searchOptionsRow}
          </ul>
          {/* Quiet footer, always present — the palette's own affordance
              list rather than tooltip-only discovery, the Raycast/Linear
              move that makes a dropdown read as a keyboard-first surface.
              Alt+C/Alt+W ride along here once a query is long enough to
              show the search toggles, instead of living in hover text
              alone. */}
          <div className="flex h-7 shrink-0 items-center justify-between border-t border-[var(--essay-border)] px-3">
            <div className="flex items-center gap-3">
              <HintChip keys="↑↓" label="navigate" />
              <HintChip keys="↵" label="run" />
              <HintChip keys="esc" label="dismiss" />
            </div>
            {showSearchOptions && (
              <div className="flex items-center gap-3">
                <HintChip keys="Alt+C" label="match case" />
                <HintChip keys="Alt+W" label="whole word" />
              </div>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** One search-option toggle. `onMouseDown` is prevented so a click never
    steals focus from the input — the author is mid-query. */
function SearchTogglePill({
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
        'rounded-md border px-1.5 py-0.5 text-[11px] leading-none',
        on
          ? 'border-[var(--essay-border)] bg-[var(--essay-surface-hover)] text-[var(--essay-text)]'
          : 'border-transparent text-[var(--essay-text-faint)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text-muted)]',
      )}
    >
      {label}
    </button>
  )
}

/** One footer hint: a borderless kbd chip plus its plain-text meaning. Quiet
    on purpose — this is a reminder for someone who already knows the
    palette, not an onboarding callout. */
function HintChip({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-[var(--essay-text-faint)]">
      <kbd className="rounded bg-[var(--essay-surface-hover)] px-1 py-0.5 leading-none">
        {keys}
      </kbd>
      {label}
    </span>
  )
}

/** The folder a document sits in, for the right-hand hint. The full path is
    too long for the row and the basename is already the title. */
function parentLabel(path: string): string {
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 2] ?? ''
}

function filterEntries(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, q) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((scored) => scored.entry)
}

function scoreEntry(entry: PaletteEntry, q: string): number {
  const title = entry.title.toLowerCase()
  if (title.startsWith(q)) return 100
  if (title.split(/\s+/).some((word) => word.startsWith(q))) return 80
  if (title.includes(q)) return 60
  const haystack = `${entry.keywords ?? ''} ${entry.group}`.toLowerCase()
  if (haystack.includes(q)) return 30
  return 0
}
