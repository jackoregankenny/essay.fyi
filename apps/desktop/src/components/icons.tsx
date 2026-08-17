/**
 * Essay's own icons.
 *
 * The chrome stopped borrowing its whole vocabulary from Phosphor here: these
 * are the marks for Essay's own ideas (the gutter, the proof, the agent, the
 * revision stack), drawn to sit beside the remaining Phosphor icons without
 * visual shock.
 *
 * Design rules — future icons must follow all of them:
 *
 * - 16×16 grid (`viewBox="0 0 16 16"`), artwork kept inside 1.5–14.5 so a
 *   1.5px stroke never clips at the edge.
 * - `stroke="currentColor"`, `strokeWidth 1.5`, round caps and joins.
 *   `fill="none"` except a deliberate accent (the mark's highlight block is
 *   the one so far: `currentColor` at low opacity, no stroke). No gradients.
 * - Corner radius 1 on anything rectangular; that shared radius is most of
 *   what makes the set read as one hand.
 * - Optical weight matched to Phosphor regular at 16px: roughly two to four
 *   strokes' worth of ink, generous negative space.
 * - Voice: editorial, not mechanical. Each icon should rhyme with the feature
 *   it names (the structure icon *is* the gutter; history is versions, not a
 *   clock; the agent is an editor in the margin, never a robot). One slight
 *   quirk per icon is wanted — an asymmetry, a slant — noise is not.
 *
 * Common interface: `{ size?: number; className?: string }`, default 16.
 */

export interface IconProps {
  size?: number
  className?: string
}

/** Shared SVG attributes — the single place the set's stroke voice lives. */
function frame(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    'aria-hidden': true,
  } as const
}

/**
 * Structure — the gutter itself: a spine of ticks sized by section weight,
 * left-aligned the way the gutter draws them. The icon and the feature rhyme;
 * the third tick is the longest because the current section is the lit one.
 */
export function IconStructure({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <path d="M3 3.25h7.5" />
      <path d="M3 6.5h4.5" />
      <path d="M3 9.75h10" />
      <path d="M3 13h6" />
    </svg>
  )
}

/**
 * Proof — the printed page: a deep top margin before the first typeset line
 * (the margin is what says "typeset", not "file"), a short last line ending a
 * paragraph, and the bottom-right corner turned rather than the stock
 * file-icon's clipped top.
 */
export function IconProof({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <path d="M4.5 2.5h7a1 1 0 0 1 1 1v7l-3 3h-5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
      <path d="M12.5 10.5h-2a1 1 0 0 0-1 1v2" />
      <path d="M6 6.25h4" />
      <path d="M6 8.5h4" />
      <path d="M6 10.75h2" />
    </svg>
  )
}

/**
 * Agent — a marginal annotation: the copy-editor's bracket scoping a passage,
 * with an asterisk set beside it in the margin. Chosen over a quill because
 * the product voice is "AI proposes; the author decides" — the agent's whole
 * posture is a note in the margin awaiting judgement, and a pen is the
 * author's instrument, not the agent's. Not a robot, ever.
 */
export function IconAgent({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <path d="M6.5 2.5h-2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h2" />
      <path d="M10.75 5.75v4.5" />
      <path d="M8.8 6.875l3.9 2.25" />
      <path d="M12.7 6.875l-3.9 2.25" />
    </svg>
  )
}

/**
 * History — versions, not time: the current draft in front, two earlier
 * states receding behind it to the upper right. No clock; a revision is a
 * page the document used to be.
 */
export function IconHistory({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <rect x="2.5" y="6" width="8" height="8" rx="1" />
      <path d="M5 3.75h5.5a1 1 0 0 1 1 1V11" />
      <path d="M7.5 1.5h4a1 1 0 0 1 1 1v5.75" />
    </svg>
  )
}

/**
 * Folders — a drawer more than a manila folder: the tab is short, slanted and
 * off-centre (the asymmetry is the quirk), and a small pull-line sits on the
 * front face. Reads as "where the work is kept" without being the stock
 * folder every app ships.
 */
export function IconFolders({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <path d="M2.5 12.25v-7.5a1 1 0 0 1 1-1h2.9l1.7 1.75h4.4a1 1 0 0 1 1 1v5.75a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1Z" />
      <path d="M6.5 9.75h3" />
    </svg>
  )
}

/**
 * Mark — the ==come back to this== highlight: one line of text with the soft
 * highlighter block behind it, tilted a degree the way a real swipe never
 * sits square. The block is the set's one deliberate fill.
 */
export function IconMark({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <rect
        x="2.75"
        y="5.5"
        width="10.5"
        height="5"
        rx="1"
        fill="currentColor"
        opacity="0.22"
        stroke="none"
        transform="rotate(-2 8 8)"
      />
      <path d="M4.25 8h7.5" />
    </svg>
  )
}

/**
 * Close — an X drawn by hand: one stroke runs a touch longer than the other
 * and neither sits at exactly 45°. Barely perceptible, which is the point.
 */
export function IconClose({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <path d="M3.7 3.9l8.7 8.2" />
      <path d="M12.1 3.7L4 12.2" />
    </svg>
  )
}

/**
 * Tasks — a checklist: a ticked box, then two lines standing for the items
 * under it. The tick is what separates this from Structure's four rules at a
 * glance, which is the only comparison that matters — they are neighbours in
 * the rail and get looked at in the same sweep.
 */
export function IconTasks({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <path d="M2.75 4.25 4 5.5l2.75-2.75" />
      <path d="M9 4.25h4.25" />
      <path d="M2.75 9.5h3" />
      <path d="M9 9.5h4.25" />
      <path d="M2.75 13h3" />
      <path d="M9 13h4.25" />
    </svg>
  )
}
