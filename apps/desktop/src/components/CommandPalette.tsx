import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '@base-ui-components/react/dialog'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { listCommands } from '@essay/commands'
import type { OutlineItem } from '@essay/editor'
import { cn } from '#/lib/cn'

interface PaletteEntry {
  key: string
  title: string
  group: string
  shortcut?: string
  keywords?: string
  run: () => void | Promise<void>
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  outline: OutlineItem[]
  onJumpToSection: (item: OutlineItem) => void
}

export function CommandPalette({
  open,
  onOpenChange,
  outline,
  onJumpToSection,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

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

  const filtered = useMemo(() => filterEntries(entries, query), [entries, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [query])

  const runEntry = (entry: PaletteEntry) => {
    onOpenChange(false)
    void entry.run()
  }

  const moveActive = (delta: number) => {
    if (!filtered.length) return
    const next = Math.min(Math.max(active + delta, 0), filtered.length - 1)
    setActive(next)
    listRef.current
      ?.querySelector(`[data-index="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  // Mounted only while open: closing unmounts the whole Root, which
  // sidesteps Base UI rc.0 never unmounting its popup when the controlled
  // `open` prop flips false (its close path only runs for internal
  // triggers like Escape — which still works here via onOpenChange).
  if (!open) return null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/25 dark:bg-black/50" />
        <Dialog.Popup className="fixed top-[16vh] left-1/2 z-50 w-[560px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--essay-border)] bg-[var(--essay-surface)] shadow-[var(--essay-shadow-palette)] outline-none">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-[var(--essay-border)] px-3">
            <MagnifyingGlass
              size={15}
              className="shrink-0 text-[var(--essay-text-faint)]"
            />
            <input
              autoFocus
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
                }
              }}
              placeholder="Type a command or section…"
              className="h-11 w-full bg-transparent text-[14px] text-[var(--essay-text)] outline-none placeholder:text-[var(--essay-text-faint)]"
            />
          </div>
          <ul ref={listRef} className="max-h-[320px] overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <li className="px-2.5 py-4 text-center text-[13px] text-[var(--essay-text-faint)]">
                No matching commands
              </li>
            ) : (
              filtered.map((entry, index) => (
                <li key={entry.key}>
                  {(index === 0 || filtered[index - 1].group !== entry.group) && (
                    <div className="px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wider text-[var(--essay-text-faint)] uppercase">
                      {entry.group}
                    </div>
                  )}
                  <button
                    type="button"
                    data-index={index}
                    onMouseMove={() => setActive(index)}
                    onClick={() => runEntry(entry)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px]',
                      index === active
                        ? 'bg-[var(--essay-surface-hover)] text-[var(--essay-text)]'
                        : 'text-[var(--essay-text-muted)]',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                    {entry.shortcut && (
                      <kbd className="shrink-0 text-[10px] tracking-wide text-[var(--essay-text-faint)]">
                        {entry.shortcut}
                      </kbd>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
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
