// Which face the manuscript is set in.
//
// Geist is the chrome's voice — precise, instrumental — and it is the right
// default for a surface that doubles as a tool. But this is essay writing,
// and a text serif is what long-form argument has always been read in; the
// serif option swaps only the manuscript face (--essay-font-prose via
// data-prose-font on <html>, see @essay/theme), never the chrome. The stack
// is the machine's best serif per platform (--essay-font-prose-serif); the
// metric compensation lives in prose.css under the same attribute.
//
// A preference, not a document property: like the writing width, it travels
// with the person, not the manuscript, so it never touches the Markdown or
// the sidecar.
//
// Wiring (Workspace integrator):
//   - at startup, once: `applyProseFont(loadProseFont())`
//   - palette command ("Toggle serif prose" or similar):
//       const next = nextProseFont(loadProseFont())
//       saveProseFont(next)
//       applyProseFont(next)
//     `proseFontLabel(next)` names the state for any status/toast surface.

export type ProseFontId = 'sans' | 'serif'

export interface ProseFont {
  id: ProseFontId
  label: string
}

export const PROSE_FONTS: readonly ProseFont[] = [
  { id: 'sans', label: 'Sans (Geist)' },
  { id: 'serif', label: 'Serif' },
]

export const DEFAULT_PROSE_FONT: ProseFontId = 'sans'

const STORAGE_KEY = 'essay.prosefont.v1'

/** The attribute @essay/theme keys the token swap on. */
const ATTRIBUTE = 'data-prose-font'

function isProseFontId(value: unknown): value is ProseFontId {
  return PROSE_FONTS.some((font) => font.id === value)
}

export function loadProseFont(): ProseFontId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isProseFontId(stored) ? stored : DEFAULT_PROSE_FONT
  } catch {
    return DEFAULT_PROSE_FONT
  }
}

export function saveProseFont(id: ProseFontId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // A preference that cannot be remembered is still a preference that works.
  }
}

/** Set or clear the attribute the theme's serif rule matches on. The default
    removes rather than writing `data-prose-font='sans'` so an untouched DOM
    stays untouched — the attribute's presence means "the author chose". */
export function applyProseFont(id: ProseFontId): void {
  if (id === DEFAULT_PROSE_FONT) {
    document.documentElement.removeAttribute(ATTRIBUTE)
  } else {
    document.documentElement.setAttribute(ATTRIBUTE, id)
  }
}

/** Resolve by id, falling back to the default rather than to a position —
    the list is ordered for the menu, and reordering it must not silently
    change what an unknown preference resolves to. */
function proseFont(id: ProseFontId): ProseFont {
  const found = PROSE_FONTS.find((entry) => entry.id === id)
  if (found) return found
  return PROSE_FONTS.find((entry) => entry.id === DEFAULT_PROSE_FONT) ?? PROSE_FONTS[0]
}

export function proseFontLabel(id: ProseFontId): string {
  return proseFont(id).label
}

/** Next face in the list, wrapping — what the palette command steps through. */
export function nextProseFont(id: ProseFontId): ProseFontId {
  const index = PROSE_FONTS.findIndex((entry) => entry.id === id)
  return PROSE_FONTS[(index + 1) % PROSE_FONTS.length].id
}
