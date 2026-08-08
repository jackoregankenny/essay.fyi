import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '#/lib/cn'
import type { DocumentMark, OutlineItem } from '@essay/editor'

/**
 * The gutter — the spine's answer to a real tension in the one-companion-slot
 * decision (docs/ui-overhaul.md). Navigation is *continuous* — an author wants
 * to know where they are all the time — but the outline should not therefore
 * win a permanent 232px pane over the page. So the always-open outline sidebar
 * becomes this: a ~14px semantic spine at the far left of the manuscript
 * column. Each section is a tick sized by its word count, the current section
 * is lit, and a dot marks a `==come back to this==` or a pending agent
 * proposal. It answers "where am I, how long is this, what is pending" for
 * free; when the answer needs words, the Structure companion is the expansion.
 *
 * A semantic spine, not a minimap: ticks are evenly stacked (one per section,
 * not proportional to length), because the author navigates by argument
 * structure, not by scroll geometry. Word weight lives in the tick's *width*
 * instead — sqrt-scaled, so one 4000-word section does not flatten every
 * other tick to the minimum.
 *
 * Hover decompresses it. The gutter is the outline with the words squeezed
 * out; pointing at it is the author asking for the words back — so the whole
 * outline fans out as floating labels, one beside each tick, not a lone
 * tooltip captioning whichever tick the pointer happened to graze. A tooltip
 * answers "what is this pixel"; the fan answers the question actually being
 * asked, "what is this document", and each label is a click target, so the
 * fan is the navigation surface the 232px pane used to be — rented for the
 * duration of a hover instead of owned permanently.
 *
 * Usage (the Workspace shell owns the data, same as OutlinePane did):
 *
 *   <Gutter
 *     outline={outline}
 *     marks={marks}
 *     activePos={activePos}
 *     pendingHeadings={pendingHeadings}
 *     onSelect={(item) => revealHeading(editor, item.pos)}
 *   />
 */

export interface GutterProps {
  outline: OutlineItem[]
  /** `==come back to this==` marks, in document order. */
  marks: DocumentMark[]
  /** Open comment threads' current editor ranges. A spanning comment touches
      every section it crosses; each touched section gets the same single
      unresolved-work dot as a mark — the gutter compresses, it does not
      classify (docs/long-form-materials.md). */
  commentSpans?: Array<{ from: number; to: number }>
  /** pos of the section the caret is inside, or null. */
  activePos: number | null
  /** Section headings with pending agent proposals (may be empty for now). */
  pendingHeadings?: string[]
  onSelect: (item: OutlineItem) => void
}

/** Full width of the strip; also the widest a tick can be. */
const STRIP_WIDTH = 14
const MIN_TICK = 4
/** Per-heading-level inset, so hierarchy is legible without labels. */
const LEVEL_INSET = 2

/* Fan timing. OPEN_INTENT keeps a pointer merely crossing the strip on its
 * way to the editor from flashing thirty labels; CLOSE_GRACE covers the 8px
 * gap between strip and label column, so moving onto a label does not read
 * as leaving. STAGGER_MS per index gives the fan its downward sweep;
 * STAGGER_CAP stops a 60-section document's tail arriving a second late —
 * past the cap the rest of the fan lands together, which is fine: the sweep
 * only needs to be legible at the top to read as motion, not assembly. */
const OPEN_INTENT_MS = 80
const CLOSE_GRACE_MS = 120
const STAGGER_MS = 14
const STAGGER_CAP_MS = 250
/** Matches --essay-speed-quick; how long the exit fade is given to finish. */
const EXIT_MS = 140

/* Fan geometry. A label row is ~26px tall (12px text, 8px padding, borders);
 * LABEL_GAP is that plus a hair of air, and LABEL_PAD keeps the first and
 * last rows clear of the nav's edges. Ticks sit ~11px apart, so labels
 * pinned to their ticks would overlap into an unreadable pile — see
 * `spreadPositions`. */
const LABEL_GAP = 28
const LABEL_PAD = 16

/** Sqrt scale: a 4000-word chapter reads as heavy without making every
 * ordinary section indistinguishable at the 4px floor. */
function tickWidth(words: number, maxWords: number, inset: number): number {
  const max = STRIP_WIDTH - inset
  if (maxWords <= 0) return MIN_TICK
  const t = Math.sqrt(words) / Math.sqrt(maxWords)
  return Math.max(MIN_TICK, Math.round(MIN_TICK + (max - MIN_TICK) * t))
}

/** Nondecreasing least-squares fit (pool adjacent violators): the classic
 * answer to "keep every point as close to where it wants to be as it can
 * get without breaking order". */
function isotonic(values: number[]): number[] {
  const blocks: { sum: number; count: number }[] = []
  for (const value of values) {
    let block = { sum: value, count: 1 }
    while (
      blocks.length > 0 &&
      blocks[blocks.length - 1].sum / blocks[blocks.length - 1].count >
        block.sum / block.count
    ) {
      const previous = blocks.pop()!
      block = {
        sum: previous.sum + block.sum,
        count: previous.count + block.count,
      }
    }
    blocks.push(block)
  }
  const out: number[] = []
  for (const block of blocks) {
    const mean = block.sum / block.count
    for (let i = 0; i < block.count; i++) out.push(mean)
  }
  return out
}

/**
 * Where the fan's labels actually sit: anchored to their ticks, but never
 * closer than `gap` — ticks pack ~11px apart while a label row is ~26px
 * tall, so pinning labels to tick centres stacks them into an unreadable
 * pile. Substituting z_i = y_i − i·gap turns "labels must not overlap"
 * into "z must be nondecreasing", which isotonic regression solves
 * optimally: each label as near its tick as the others allow, no
 * iteration, the same answer every open. A fan that fits inside [lo, hi]
 * is nudged back within it; one taller than the strip stays anchored and
 * overflows — compressed rows would defeat the whole fix.
 */
function spreadPositions(
  anchors: number[],
  gap: number,
  lo: number,
  hi: number,
): number[] {
  if (anchors.length === 0) return []
  const fitted = isotonic(anchors.map((a, i) => a - i * gap)).map(
    (z, i) => z + i * gap,
  )
  const first = fitted[0]
  const last = fitted[fitted.length - 1]
  if (last - first <= hi - lo) {
    const shift = first < lo ? lo - first : last > hi ? hi - last : 0
    if (shift !== 0) return fitted.map((y) => y + shift)
  }
  return fitted
}

/** The theme's motion tokens deliberately do not zero themselves under
 * reduced motion (see theme.css); JS-driven choreography checks for itself.
 * Under reduce the fan appears and leaves by opacity alone: no slide, no
 * stagger. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export function Gutter({
  outline,
  marks,
  commentSpans,
  activePos,
  pendingHeadings,
  onSelect,
}: GutterProps) {
  const navRef = useRef<HTMLElement>(null)
  const tickRefs = useRef<(HTMLButtonElement | null)[]>([])
  const reducedMotion = usePrefersReducedMotion()

  // Fan lifecycle is two booleans, not one: `mounted` keeps the labels in the
  // DOM, `shown` drives the transition. Entering flips them a frame apart
  // (a freshly mounted element cannot CSS-transition its own entrance);
  // leaving flips `shown` first so the exit fade is visible, then unmounts
  // after EXIT_MS. Exit is everyone at once, no stagger — a staggered exit
  // reads as the UI being slow to obey, where a staggered entrance reads as
  // the UI arriving.
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  /** Vertical centre of each tick, in nav space, measured at open. */
  const [tops, setTops] = useState<number[]>([])
  /** pos of the tick/label under the pointer; falls back to activePos. */
  const [hoverPos, setHoverPos] = useState<number | null>(null)

  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  const unmountTimer = useRef<number | null>(null)

  const clearTimers = () => {
    for (const t of [openTimer, closeTimer, unmountTimer]) {
      if (t.current !== null) {
        window.clearTimeout(t.current)
        t.current = null
      }
    }
  }
  useEffect(() => clearTimers, [])

  // Rects, not offsetTop: the ticks live inside a scroll container while the
  // labels position against the nav, so "centre of the tick, in nav space"
  // must account for scroll. Measured once at open and again on scroll while
  // open — event-driven, never a rAF loop; the fan is hover-only chrome and
  // must cost nothing while idle. Tick centres are only the *anchors*; the
  // stored tops are the spread positions (see `spreadPositions`).
  const measure = useCallback(() => {
    const nav = navRef.current
    if (!nav) return
    const navRect = nav.getBoundingClientRect()
    const anchors = tickRefs.current.slice(0, outline.length).map((el) => {
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      return rect.top - navRect.top + rect.height / 2
    })
    setTops(
      spreadPositions(anchors, LABEL_GAP, LABEL_PAD, navRect.height - LABEL_PAD),
    )
  }, [outline.length])

  const openFan = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    if (unmountTimer.current !== null) {
      window.clearTimeout(unmountTimer.current)
      unmountTimer.current = null
    }
    // Re-entering during the exit fade resumes rather than restarts.
    if (mounted) {
      setShown(true)
      return
    }
    if (openTimer.current !== null) return
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null
      measure()
      setMounted(true)
    }, OPEN_INTENT_MS)
  }

  const closeFan = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (closeTimer.current !== null) return
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setShown(false)
      setHoverPos(null)
      unmountTimer.current = window.setTimeout(() => {
        unmountTimer.current = null
        setMounted(false)
      }, EXIT_MS)
    }, CLOSE_GRACE_MS)
  }

  // The entrance flip: first frame commits the off-stage style (faded,
  // slid left), the rAF pair flips it so every label transitions in. Raced
  // against a timeout because a suspended-rAF environment (occluded window,
  // embedded webview) would otherwise leave the fan permanently invisible.
  useEffect(() => {
    if (!mounted || shown) return
    let inner: number | null = null
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(true))
    })
    const fallback = window.setTimeout(() => setShown(true), 50)
    return () => {
      cancelAnimationFrame(outer)
      if (inner !== null) cancelAnimationFrame(inner)
      clearTimeout(fallback)
    }
  }, [mounted, shown])

  // Outline changed while the fan is out (agent edit, autosave re-weigh):
  // re-measure so labels track their ticks rather than the old geometry.
  useEffect(() => {
    if (mounted) measure()
  }, [mounted, measure])

  const maxWords = outline.reduce((m, item) => Math.max(m, item.words), 0)
  const pending = new Set(pendingHeadings ?? [])

  // A mark belongs to the last section whose heading sits at or before it.
  // Marks in the preamble (before any heading) have no tick to sit beside,
  // which is honest: the gutter maps sections, and they are in none.
  const markedSections = new Set<number>()
  for (const mark of marks) {
    let owner: number | null = null
    for (const item of outline) {
      if (item.pos <= mark.pos) owner = item.pos
      else break
    }
    if (owner !== null) markedSections.add(owner)
  }
  // An open comment marks every section its range crosses — same dot, no new
  // colour, one signal meaning "unresolved author work" whatever its kind or
  // count. The thread itself appears once in Structure.
  for (const span of commentSpans ?? []) {
    for (let i = 0; i < outline.length; i++) {
      const start = outline[i].pos
      const end = i + 1 < outline.length ? outline[i + 1].pos : Infinity
      if (span.from < end && span.to > start) markedSections.add(start)
    }
  }

  // The label the author is "on": the tick under the pointer, or the active
  // section when the pointer is between ticks — the fan should always have
  // exactly one emphasised row, because that row is the answer to "where am
  // I" the strip was already giving.
  const emphasisPos = hoverPos ?? activePos

  return (
    // Relative, so the fan positions off the strip itself. Enter/leave live
    // on the nav: the labels are DOM descendants, so DOM containment (not
    // geometry) keeps the fan open while the pointer is on a label, and
    // CLOSE_GRACE covers the gap in between.
    <nav
      ref={navRef}
      aria-label="Sections"
      className="relative h-full"
      style={{ width: STRIP_WIDTH }}
      onMouseEnter={openFan}
      onMouseLeave={closeFan}
    >
      {/* Overflow, honestly: the stack used to `justify-center`, which
          overflows symmetrically — the first and last sections fall off both
          ends with no way to reach them past ~40 sections. Instead the
          scroller + `min-h-full`/`justify-center` stack below centres when it fits and
          top-aligns + scrolls (scrollbar hidden — 14px has no room for
          chrome) when it does not. Chosen over shrinking the gap via clamp():
          a gap thin enough to fit a 60-section document turns ticks into
          moiré and hover targets into pixel hunting; every section staying
          reachable beats every section staying visible. The labels live
          outside the scroller because `overflow-y: auto` forces horizontal
          clipping too, and the fan hangs off the strip's right edge. */}
      <div
        className="h-full w-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={() => {
          if (mounted) measure()
        }}
      >
        <div className="flex min-h-full w-full flex-col items-start justify-center gap-[7px]">
          {outline.map((item, i) => {
            const active = item.pos === activePos
            const inset = Math.min((item.level - 1) * LEVEL_INSET, STRIP_WIDTH - MIN_TICK)
            const width = tickWidth(item.words, maxWords, inset)
            const marked = markedSections.has(item.pos)
            const isPending = pending.has(item.text)
            return (
              <button
                key={`${item.pos}-${i}`}
                ref={(el) => {
                  tickRefs.current[i] = el
                }}
                type="button"
                onClick={() => onSelect(item)}
                onMouseEnter={() => setHoverPos(item.pos)}
                // The button is the hit target (full strip width, taller than the
                // tick); the visible bar is the child, so a 2px line is not a
                // 2px click.
                className="group relative flex w-full items-center py-[2px]"
                aria-label={item.text || 'Untitled'}
                aria-current={active ? 'true' : undefined}
              >
                {/* The travelling light: when activePos moves, the old tick's
                    accent drains and the new one's fills over the same regular
                    beat, so the light reads as gliding down the spine rather
                    than teleporting. Width/height are in the transition list
                    because the active tick thickens and the outline re-weighs
                    ticks as sections grow — a 14px-wide bar reflows nothing
                    but itself, so the transform-only rule is not at stake. */}
                <span
                  className={cn(
                    'block rounded-full transition-[width,height,background-color,opacity] duration-[var(--essay-speed-regular)] ease-[var(--essay-ease-out)] motion-reduce:transition-none',
                    active
                      ? 'h-[3px] bg-[var(--essay-accent)]'
                      : 'h-[2px] bg-[var(--essay-text-faint)] opacity-55 group-hover:opacity-90',
                  )}
                  style={{ width, marginLeft: inset }}
                />
                {(marked || isPending) && (
                  <span
                    className={cn(
                      'absolute top-1/2 right-0 size-[3px] -translate-y-1/2 rounded-full',
                      // Pending wins: a proposal is actionable, a mark is a note.
                      isPending
                        ? 'bg-[var(--essay-accent)]'
                        : 'bg-[var(--essay-highlight)]',
                    )}
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>
      {/* The fan. Every label mounts at once and enters on a stagger —
          sliding out of the strip (translateX) with the swift ease, the
          spine visibly decompressing downwards. Labels are real click
          targets (the fan is a nav surface, not a caption) but tabIndex -1
          and aria-hidden: keyboard and AT users already have the tick
          buttons, and thirty duplicate tab stops that exist only mid-hover
          would be noise, not access. */}
      {mounted && outline.length > 0 && (
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-full z-40">
          {outline.map((item, i) => {
            const top = tops[i] ?? 0
            const inset = Math.min((item.level - 1) * LEVEL_INSET, STRIP_WIDTH - MIN_TICK)
            const emphasised = item.pos === emphasisPos
            // Entrance sweeps top-to-bottom; the exit is one flip with no
            // delay, so the fan collapses as a single surface.
            const delay =
              shown && !reducedMotion ? Math.min(i * STAGGER_MS, STAGGER_CAP_MS) : 0
            return (
              <button
                key={`label-${item.pos}-${i}`}
                type="button"
                tabIndex={-1}
                onClick={() => onSelect(item)}
                onMouseEnter={() => setHoverPos(item.pos)}
                className={cn(
                  'pointer-events-auto absolute flex origin-left items-baseline gap-1.5 rounded-full border border-[var(--essay-border)] bg-[var(--essay-bg)] px-2.5 py-1 whitespace-nowrap shadow-[var(--essay-shadow-low)]',
                  shown
                    ? 'transition-[opacity,transform] duration-[var(--essay-speed-regular)] ease-[var(--essay-ease-swift)]'
                    : 'transition-opacity duration-[var(--essay-speed-quick)] ease-[var(--essay-ease-out)]',
                )}
                style={{
                  top,
                  // Level indent echoes the tick inset, so the fan keeps the
                  // outline's hierarchy without rendering tree lines.
                  marginLeft: 8 + inset * 2,
                  opacity: shown ? (emphasised ? 1 : 0.85) : 0,
                  transform: shown
                    ? `translateY(-50%)${emphasised ? ' scale(1.03)' : ''}`
                    : reducedMotion
                      ? 'translateY(-50%)'
                      : 'translateY(-50%) translateX(-6px)',
                  transitionDelay: `${delay}ms`,
                }}
              >
                <span
                  className={cn(
                    'text-xs',
                    emphasised
                      ? 'text-[var(--essay-text)]'
                      : 'text-[var(--essay-text-muted)]',
                  )}
                >
                  {item.text || 'Untitled'}
                </span>
                <span className="text-[10px] tabular-nums text-[var(--essay-text-faint)]">
                  {item.words}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </nav>
  )
}
