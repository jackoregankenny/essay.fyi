import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
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
 * The fan opens into room that was reserved for it, not into the page. The
 * strip is set out from the prose column by the fan's own width (styles.css),
 * so the labels land in the manuscript's left margin — the fan never had to
 * change direction, it had to stop being parked against the text. How much
 * room that actually is depends on the window, so the labels' ceiling is
 * measured against the live position of the prose rather than assumed.
 *
 * Motion is liquid, and deliberately so: the labels do not fade in beside the
 * ticks, they are extruded out of the spine — scaled down and pulled back into
 * it, then springing out past their resting place and settling. A goo filter
 * (blur + alpha contrast, the metaball trick) is applied to a shadow copy of
 * the fan that carries the pill shapes with the text made invisible, so the
 * pills merge into one body while they are still stacked at the spine and
 * separate as they travel. Text renders on top, unfiltered and sharp; the
 * duplicate markup is what buys the pills their widths without measuring.
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
const CLOSE_GRACE_MS = 140
const STAGGER_MS = 20
const STAGGER_CAP_MS = 300
/** How long the exit is given to finish before the fan leaves the DOM. */
const EXIT_MS = 180

/* The spring. `ARRIVE` overshoots — a label travels past its resting place and
 * comes back, which is what separates "a panel appeared" from "something was
 * pulled out of the rail". It is only usable on transform and opacity; on a
 * layout property an overshoot is a reflow past the target and back.
 * `SETTLE` has no overshoot and is for the emphasis swap under a moving
 * pointer, where a bounce per row would read as the fan being nervous. */
const ARRIVE = 'cubic-bezier(0.34, 1.42, 0.5, 1)'
const SETTLE = 'cubic-bezier(0.22, 0.9, 0.28, 1)'
const ARRIVE_MS = 380

/* The goo. Blur radius sets how far apart two pills can be and still read as
 * one body; contrast is how hard the resulting edge is. 6/18 is the pairing
 * the liquid-gooey playground settles on and it holds here: at LABEL_GAP the
 * resting fan is clearly separate shapes, and at the closed position — every
 * pill stacked on its own tick, ~11px apart — they are one. */
const GOO_BLUR = 6
const GOO_CONTRAST = 18

/* The two layers render the same box; only the ink differs. Shared rather
 * than duplicated because a divergence between them is a shape that does not
 * fit its own text, and nothing in the rendering would say so. */
/* No `will-change`: a 60-section document would hand the compositor 120
 * promoted layers for a hover ornament, which is the documented way to make
 * `will-change` cost more than it saves. The goo layer is promoted anyway by
 * having a filter, and the label layer animates transform and opacity only. */
const PILL =
  'absolute flex items-baseline gap-1.5 rounded-full px-2.5 py-1 whitespace-nowrap'
const TITLE = 'min-w-0 overflow-hidden text-xs text-ellipsis'
const COUNT = 'shrink-0 text-[10px] tabular-nums'

/* Fan geometry. A pill is ~26px tall (12px text, 8px padding); LABEL_GAP is
 * that plus real air, and LABEL_PAD keeps the first and last rows clear of the
 * nav's edges. Ticks sit ~11px apart, so labels pinned to their ticks pile up
 * unreadably — see `spreadPositions`. The gap is wider than the old 28 because
 * the goo needs the *resting* fan to be visibly separate shapes: at a 2px gap
 * a 6px blur welds the column into one slab and the liquid never reads. */
const LABEL_GAP = 34
const LABEL_PAD = 16

/* How wide a label may get. Headings run long and `whitespace-nowrap` has no
 * opinion about it, so the ceiling is the room actually measured between the
 * spine and the first character of prose — one 90-character section title
 * does not get to decide how far the fan reaches into the page. MIN_LABEL is
 * the floor for a window with no margin left to give: below it the fan is
 * overlapping prose whatever we do, and legible-but-overlapping beats a
 * column of ellipses. */
const MIN_LABEL = 150
const MAX_LABEL = 320
const FAN_EDGE_PAD = 16
/** How far a label starts from the spine, before its level indent. */
const LABEL_LEAD = 8

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

/**
 * The theme's motion tokens deliberately do not zero themselves under reduced
 * motion (see theme.css), and the goo and the plate are both set from JS
 * rather than from a stylesheet — an inline `filter` cannot be undone by a
 * media query without `!important`. So every accessibility preference this
 * component answers is read here and branched on in the render, where the
 * decision is visible beside the thing it changes.
 */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
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
  const labelsRef = useRef<HTMLDivElement>(null)
  const tickRefs = useRef<(HTMLButtonElement | null)[]>([])
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)')
  /** Melted edges are the opposite of what this preference asks for, so the
      goo comes off and the pills get a hard edge of their own instead. */
  const highContrast = useMedia('(prefers-contrast: more)')
  /** The plate stops being frosted canvas and becomes canvas. */
  const solidSurfaces = useMedia('(prefers-reduced-transparency: reduce)')
  /** Per-instance, because two gutters on one page sharing a filter id is a
      silent bug: the second one's `url(#…)` resolves to the first's element. */
  const gooId = `essay-goo${useId()}`

  // Fan lifecycle is two booleans, not one: `mounted` keeps the labels in the
  // DOM, `shown` drives the transition. Entering flips them a frame apart
  // (a freshly mounted element cannot CSS-transition its own entrance);
  // leaving flips `shown` first so the exit fade is visible, then unmounts
  // after EXIT_MS. Exit is everyone at once, no stagger — a staggered exit
  // reads as the UI being slow to obey, where a staggered entrance reads as
  // the UI arriving.
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  /**
   * The fan is on its way out, as distinct from not yet on its way in.
   *
   * Two booleans could not carry this. `shown === false` means "folded", and
   * the entrance effect below reads that as "needs starting" — correct on a
   * fresh mount, catastrophic during an exit, where it flipped `shown` back on
   * the same tick the close turned it off. The fade never rendered (the fan sat
   * open until the unmount timer removed it: a teleport) and `shown` was left
   * true at unmount, so the *next* mount began already in its open computed
   * style with nothing to interpolate from and snapped open too. One flag,
   * both symptoms.
   */
  const [leaving, setLeaving] = useState(false)
  /** The arrival is over. Until it is, every label carries its stagger delay
      and the spring; after it, the same transform property has to answer a
      moving pointer immediately, so the transition is swapped for a short
      settle. Without this, emphasising a row waits out its entrance delay and
      then bounces — the fan reads as sluggish exactly when it is being used. */
  const [settled, setSettled] = useState(false)
  /** Vertical centre of each tick, in nav space, measured at open — where a
      label sits *before* the fan opens, packed against its tick. */
  const [anchors, setAnchors] = useState<number[]>([])
  /** Where it travels to: the same anchors, spread far enough apart to read. */
  const [tops, setTops] = useState<number[]>([])
  /** How wide a label may be — the room between the spine and the prose,
      measured at open, because the companion opening or the window resizing
      both change it. */
  const [labelMax, setLabelMax] = useState(MAX_LABEL)
  /** The page has no margin left to lend: the fan cannot avoid the prose at
      this width, so it stops behaving like marginalia and becomes a layer. */
  const [cramped, setCramped] = useState(false)
  /** How far the widest row actually reaches. `labelMax` is a ceiling, not a
      width — a plate drawn to the ceiling has dead space beside every title
      short enough not to need it. Only knowable once the rows have laid out,
      so this is measured rather than computed. */
  const [fanWidth, setFanWidth] = useState(0)
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
    // Room is measured to the first character of prose, not to the prose
    // element's border box: the column carries 1.5rem of padding that the fan
    // is welcome to sit in. Measured live rather than derived from
    // --essay-measure, because the companion, the writing-width preference and
    // the window all move that edge and only the element knows where it ended
    // up. No prose on the page (a host embedding the gutter alone) falls back
    // to the ceiling rather than to zero.
    const prose = document.querySelector('.essay-prose')
    const textLeft = prose
      ? prose.getBoundingClientRect().left +
        parseFloat(getComputedStyle(prose).paddingLeft || '0')
      : navRect.right + MAX_LABEL + FAN_EDGE_PAD
    // The deepest label's lead comes out of the budget too, or the ceiling is
    // the room from the *spine* and the indented rows spend it overshooting.
    const lead =
      LABEL_LEAD +
      outline.reduce(
        (deepest, item) =>
          Math.max(
            deepest,
            Math.min((item.level - 1) * LEVEL_INSET, STRIP_WIDTH - MIN_TICK) * 2,
          ),
        0,
      )
    const room = textLeft - navRect.right - lead - FAN_EDGE_PAD
    // Below the floor the labels are over prose whatever we do. That is not a
    // reason to pretend otherwise: the backing surface comes on, and what was
    // a fan in the margin reads as a panel over the page.
    const tight = room < MIN_LABEL
    setCramped(tight)
    // And once it *is* a panel it should be one. Squeezing titles to 150px
    // while covering the paragraph anyway is the worst of both: the reader
    // loses the prose and still cannot read the outline. A panel is measured
    // against the window it floats in, not against the margin it did not get.
    const panel = window.innerWidth - navRect.right - lead - FAN_EDGE_PAD * 2
    setLabelMax(
      Math.max(MIN_LABEL, Math.min(MAX_LABEL, tight ? panel : room)),
    )
    const ticks = tickRefs.current.slice(0, outline.length).map((el) => {
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      return rect.top - navRect.top + rect.height / 2
    })
    setAnchors(ticks)
    setTops(
      spreadPositions(ticks, LABEL_GAP, LABEL_PAD, navRect.height - LABEL_PAD),
    )
  }, [outline])

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
      setLeaving(false)
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
      setLeaving(true)
      setShown(false)
      setHoverPos(null)
      unmountTimer.current = window.setTimeout(() => {
        unmountTimer.current = null
        setMounted(false)
        // Cleared only once the labels are gone. Clearing it beside the fade
        // would hand the entrance effect a mounted, folded fan and it would
        // start the whole arrival over, mid-exit.
        setLeaving(false)
      }, EXIT_MS)
    }, CLOSE_GRACE_MS)
  }

  // Outline changed while the fan is out (agent edit, autosave re-weigh):
  // re-measure so labels track their ticks rather than the old geometry.
  useEffect(() => {
    if (mounted) measure()
  }, [mounted, measure])

  // Resizing the window while the fan is out moves the manuscript under it and
  // takes room off the labels' ceiling. Listened for only while mounted: this
  // is hover-only chrome and costs nothing when idle.
  useEffect(() => {
    if (!mounted) return
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [mounted, measure])

  /**
   * Size the plate, then start the entrance — in that order, in one layout
   * effect, because both need the rows measured and the second needs the
   * first's reflow.
   *
   * The entrance is the subtle half. A transition interpolates between two
   * *computed* styles, and a freshly mounted element that is told to open in
   * the same recalculation has only one: the browser has nothing to travel
   * from, so it snaps, and the spring never plays. This used to be handled
   * with a double `requestAnimationFrame`, which was wrong twice over — it
   * assumed React would not coalesce the two commits, and it assumed frames
   * exist at all, which is false in an occluded window where rAF is
   * suspended and the fan would then be stuck invisible.
   *
   * Reading geometry forces the folded state to be computed. After that the
   * open state is a second, different computed style and the transition has
   * its two ends. No frames required, no timing assumed.
   */
  useLayoutEffect(() => {
    const el = labelsRef.current
    if (!mounted || !el) return
    const rows = Array.from(el.children) as HTMLElement[]
    if (rows.length > 0) {
      // `offsetLeft` carries each row's lead and level indent, and neither
      // offset is affected by the entrance transform, so this reads the
      // resting extent while the fan is still folded into the spine.
      const reach = Math.max(...rows.map((row) => row.offsetLeft + row.offsetWidth))
      setFanWidth(reach + LABEL_LEAD)
    }
    // `leaving` is what keeps this from resurrecting a fan that is fading out.
    if (!shown && !leaving) {
      void el.getBoundingClientRect()
      setShown(true)
    }
  }, [mounted, shown, leaving, labelMax, outline])

  // The arrival's own length: the last label's stagger plus the spring. Timed
  // rather than driven off transitionend, which fires per property per element
  // and would need de-duplicating for the one edge it actually marks.
  useEffect(() => {
    if (!shown) {
      setSettled(false)
      return
    }
    if (reducedMotion) {
      setSettled(true)
      return
    }
    const last = Math.min((outline.length - 1) * STAGGER_MS, STAGGER_CAP_MS)
    const timer = window.setTimeout(() => setSettled(true), last + ARRIVE_MS)
    return () => window.clearTimeout(timer)
  }, [shown, reducedMotion, outline.length])

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

  /**
   * One description of the fan, rendered twice. Every label's geometry and
   * motion is decided here so the goo layer and the type layer are literally
   * the same numbers — the shapes cannot end up somewhere the words are not.
   *
   * The travel is the whole effect. Closed, a label sits *on its tick*, pulled
   * back into the strip and scaled down: at ~11px apart and 26px tall the
   * pills overlap into a single body under the filter. Open, each one springs
   * out to its spread position and full size, and the body separates into
   * rows. `top` therefore stays on the anchor and the spread is carried by
   * translateY — same pixels, but a transform animates on the compositor where
   * `top` would lay out thirty elements a frame.
   */
  /**
   * The fan's own footprint, in nav space. Two jobs, which is why it exists
   * even when it paints nothing.
   *
   * It is the hit area. The label column is `pointer-events-none` with only
   * the pills interactive, so a pointer travelling diagonally from one row to
   * the next passes over the manuscript, which is outside the nav — the fan
   * would start closing on the way between two of its own targets. A box
   * under them, inside the nav, means DOM containment covers the whole
   * gesture rather than only the pills.
   *
   * And when the page has no margin it is the surface: prose showing between
   * floating pills is what makes an overlay read as a mistake, and a plate
   * under them is what makes it read as a layer.
   */
  const footprint = (() => {
    if (tops.length === 0) return null
    const first = tops[0]
    const last = tops[tops.length - 1]
    const pad = LABEL_GAP / 2 + 6
    return {
      top: first - pad,
      height: last - first + pad * 2,
      // Visible, so it hugs its rows. Invisible, so it stays generous: the
      // ceiling is a better hit area than the ragged right edge of the titles.
      width: cramped
        ? fanWidth || LABEL_LEAD + labelMax + LABEL_LEAD
        : LABEL_LEAD + labelMax + LABEL_LEAD,
    }
  })()

  const fan = outline.map((item, i) => {
    const anchor = anchors[i] ?? 0
    const spread = (tops[i] ?? 0) - anchor
    const inset = Math.min((item.level - 1) * LEVEL_INSET, STRIP_WIDTH - MIN_TICK)
    const emphasised = item.pos === emphasisPos
    // Entrance sweeps top-to-bottom; the exit is one flip with no delay, so
    // the fan collapses back into the spine as a single surface.
    const delay = shown && !reducedMotion ? Math.min(i * STAGGER_MS, STAGGER_CAP_MS) : 0
    const open = shown && !reducedMotion
    return {
      key: `${item.pos}-${i}`,
      text: item.text || 'Untitled',
      words: item.words,
      emphasised,
      onSelect: () => onSelect(item),
      onEnter: () => setHoverPos(item.pos),
      style: {
        top: anchor,
        maxWidth: labelMax,
        // Level indent echoes the tick inset, so the fan keeps the outline's
        // hierarchy without rendering tree lines.
        marginLeft: LABEL_LEAD + inset * 2,
        // Opaque, not 0.92. At widths where the page has no margin the fan
        // is an overlay on prose, and a pill you can read the paragraph
        // through is the worst of both. Emphasis is carried by ink colour and
        // the 1.04, which cost nothing when the pill is over words.
        opacity: shown ? 1 : 0,
        transform: open
          ? `translate(0px, calc(-50% + ${spread}px)) scale(${emphasised ? 1.04 : 1})`
          : reducedMotion
            ? `translate(0px, calc(-50% + ${shown ? spread : 0}px))`
            : // Back inside the strip, small: where the body is one blob.
              'translate(-24px, -50%) scale(0.72)',
        transition: reducedMotion
          ? `opacity var(--essay-speed-quick) linear`
          : !shown
            ? `opacity ${EXIT_MS}ms linear, transform ${EXIT_MS}ms ${SETTLE}`
            : settled
              ? // Arrived. The transform property now belongs to emphasis.
                `opacity 120ms linear, transform 200ms ${SETTLE}`
              : // Opacity arrives ahead of the spring so the overshoot is seen
                // rather than faded through.
                `opacity 160ms linear ${delay}ms, transform ${ARRIVE_MS}ms ${ARRIVE} ${delay}ms`,
      } satisfies CSSProperties,
    }
  })

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
      {/* The fan, in two layers that must stay pixel-identical: the goo
          carries the pill shapes, the labels carry the words. Splitting them
          is what lets the filter melt the shapes without touching the type —
          a filtered subtree blurs its text too, and 11px section titles do not
          survive that. The pills get their widths from the same markup with
          the text made invisible, so the two layers cannot drift.

          Labels are real click targets (the fan is a nav surface, not a
          caption) but tabIndex -1 and aria-hidden: keyboard and AT users
          already have the tick buttons, and thirty duplicate tab stops that
          exist only mid-hover would be noise, not access. */}
      {/* The three layers below stack among themselves and nowhere else: the
          container this nav sits in carries a z-index, which opens a stacking
          context, so these numbers are private to the fan. They are plain
          numbers rather than workspace tokens for exactly that reason — using
          the shared scale here would imply a relationship that does not
          exist. */}
      {mounted && outline.length > 0 && (
        <>
          {/* Footprint: always the hit area, a visible plate only when the
              page has no margin to fan into. It scales out of the spine with
              the labels rather than appearing under them fully formed, or the
              plate would arrive before the thing it is a plate for. */}
          {footprint && (
            <div
              aria-hidden
              className={cn(
                'pointer-events-auto absolute left-full z-20 origin-left rounded-2xl',
                cramped &&
                  'shadow-[var(--essay-shadow-low)] ring-1 ring-[var(--essay-border)]',
                cramped &&
                  (solidSurfaces
                    ? 'bg-[var(--essay-editor-bg)]'
                    : 'bg-[var(--essay-editor-bg)]/95 backdrop-blur-md'),
              )}
              style={{
                top: footprint.top,
                height: footprint.height,
                width: footprint.width,
                opacity: shown ? 1 : 0,
                transform: shown || reducedMotion ? 'scaleX(1)' : 'scaleX(0.9)',
                transition: reducedMotion
                  ? 'opacity var(--essay-speed-quick) linear'
                  : shown
                    ? `opacity 140ms linear, transform ${ARRIVE_MS}ms ${ARRIVE}`
                    : `opacity ${EXIT_MS}ms linear, transform ${EXIT_MS}ms ${SETTLE}`,
              }}
            />
          )}
          {/* The goo. Blur, then crush alpha's contrast — the metaball trick:
              two shapes whose blurred haloes touch resolve as one body, and
              separate as they move apart. sRGB interpolation is not optional;
              the default linearRGB shifts the surface colour visibly. */}
          <svg aria-hidden className="pointer-events-none absolute size-0">
            <filter id={gooId} colorInterpolationFilters="sRGB">
              <feGaussianBlur in="SourceGraphic" stdDeviation={GOO_BLUR} result="blur" />
              <feColorMatrix
                in="blur"
                type="matrix"
                values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${GOO_CONTRAST} -${GOO_CONTRAST / 2.2}`}
              />
            </filter>
          </svg>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-full z-30"
            // The shadow is chained *after* the goo so it traces the melted
            // silhouette rather than the rectangles that went in — and it is
            // on this layer alone, because a shadow under the type layer would
            // be a second, sharper outline half a pixel off the first.
            style={{
              filter: highContrast
                ? 'drop-shadow(0 2px 6px rgb(0 0 0 / 0.28))'
                : `url(#${gooId}) drop-shadow(0 2px 6px rgb(0 0 0 / 0.28))`,
            }}
          >
            {fan.map((label) => (
              <div
                key={`goo-${label.key}`}
                className={cn(
                  PILL,
                  'bg-[var(--essay-surface)]',
                  highContrast && 'ring-1 ring-[var(--essay-border-strong)]',
                )}
                style={label.style}
              >
                <span className={cn(TITLE, 'invisible')}>{label.text}</span>
                <span className={cn(COUNT, 'invisible')}>{label.words}</span>
              </div>
            ))}
          </div>
          <div
            ref={labelsRef}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-full z-40"
          >
            {fan.map((label) => (
              <button
                key={`label-${label.key}`}
                type="button"
                tabIndex={-1}
                onClick={label.onSelect}
                onMouseEnter={label.onEnter}
                className={cn(PILL, 'pointer-events-auto')}
                style={label.style}
              >
                <span
                  className={cn(
                    TITLE,
                    label.emphasised
                      ? 'text-[var(--essay-text)]'
                      : 'text-[var(--essay-text-muted)]',
                  )}
                >
                  {label.text}
                </span>
                <span className={cn(COUNT, 'text-[var(--essay-text-faint)]')}>
                  {label.words}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </nav>
  )
}
