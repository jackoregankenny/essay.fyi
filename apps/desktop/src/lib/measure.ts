// How wide the writing column runs.
//
// The default is the iA Writer discipline the theme was built around — a
// measure short enough that the eye finds the next line without hunting.
// It is the right default and the wrong rule for everybody: wide tables,
// code-heavy technical documents and large displays all want more room, and
// the author is better placed than the theme to know which they are writing.
//
// A preference, not a document property: it travels with the person, not the
// manuscript, so it never touches the Markdown or the sidecar.

export type MeasureId = 'auto' | 'narrow' | 'normal' | 'wide' | 'full'

export interface Measure {
  id: MeasureId
  label: string
  /** `max-width` for the prose column; `none` fills the pane. */
  width: string
}

/**
 * `auto` scales with the space actually available rather than with the
 * viewport, so opening the sidebar or the agent pane narrows the column the
 * way moving to a smaller screen would. The floor keeps it readable when both
 * panes are open; the ceiling stops a 4K display from producing lines the eye
 * cannot track back from.
 */
// This is a working manuscript, not a reader-mode article. Auto uses the
// available canvas and tops out only when a wide display would make prose
// genuinely hard to track. Narrow/Normal remain deliberate reading measures;
// Full remains there for tables, technical material, and authors who want it.
const AUTO_WIDTH = 'clamp(34rem, 92%, 58rem)'

export const MEASURES: readonly Measure[] = [
  { id: 'auto', label: 'Auto', width: AUTO_WIDTH },
  { id: 'narrow', label: 'Narrow', width: '34rem' },
  { id: 'normal', label: 'Normal', width: '42rem' },
  { id: 'wide', label: 'Wide', width: '52rem' },
  { id: 'full', label: 'Full width', width: 'none' },
]

export const DEFAULT_MEASURE: MeasureId = 'auto'

const STORAGE_KEY = 'essay.measure.v1'

function isMeasureId(value: unknown): value is MeasureId {
  return MEASURES.some((measure) => measure.id === value)
}

export function loadMeasure(): MeasureId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isMeasureId(stored) ? stored : DEFAULT_MEASURE
  } catch {
    return DEFAULT_MEASURE
  }
}

export function saveMeasure(id: MeasureId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // A preference that cannot be remembered is still a preference that works.
  }
}

/** Resolve by id, falling back to the default rather than to a position —
    the list is ordered for the menu, and reordering it must not silently
    change what an unknown preference resolves to. */
function measure(id: MeasureId): Measure {
  const found = MEASURES.find((entry) => entry.id === id)
  if (found) return found
  return MEASURES.find((entry) => entry.id === DEFAULT_MEASURE) ?? MEASURES[0]
}

export function measureWidth(id: MeasureId): string {
  return measure(id).width
}

export function measureLabel(id: MeasureId): string {
  return measure(id).label
}

/** Next width in the list, wrapping — what the palette command steps through. */
export function nextMeasure(id: MeasureId): MeasureId {
  const index = MEASURES.findIndex((entry) => entry.id === id)
  return MEASURES[(index + 1) % MEASURES.length].id
}
