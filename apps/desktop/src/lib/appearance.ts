// What the room looks like: which theme, and which colour the one saturated
// element in it is.
//
// Both are preferences in the same sense as the writing width and the prose
// face — they travel with the person, never touch the Markdown or the sidecar,
// and mean nothing to a second machine reading the same file.
//
// Theme used to be a palette command that flipped `data-theme` and nothing
// else, so an author who preferred light chose it again on every launch. It is
// stored now, and `applyTheme` is called from `main.tsx` before React mounts —
// early enough that the wrong theme is never painted. A flash of the other
// ground is worse than a slow start.
//
// Wiring (Workspace integrator):
//   - at boot, in main.tsx: `startAppearance()`
//   - from Settings: `setTheme(id)` / `setAccent(id)` — both persist and apply

export type ThemeId = 'dark' | 'light' | 'system'

export interface Theme {
  id: ThemeId
  label: string
  detail: string
}

/* Dark first, because dark is the identity rather than a mode (theme.css):
   the light theme is the same architecture restated on paper. `system` is
   offered because an OS-level preference is usually a statement about the
   room the machine is in, and an author who set it once should not have to
   restate it here. */
export const THEMES: readonly Theme[] = [
  { id: 'dark', label: 'Dark', detail: 'The default. Near-black chrome, the canvas one step lighter.' },
  { id: 'light', label: 'Light', detail: 'The same architecture restated on paper.' },
  { id: 'system', label: 'Match system', detail: 'Follow this machine’s appearance setting.' },
]

export const DEFAULT_THEME: ThemeId = 'dark'

/** Hue angles in OKLCH. Named for what they look like, not for their number —
    an author picking a colour is not picking 340°. Lightness and chroma are
    the theme's (see `--essay-accent-hue`); only the angle moves, so no choice
    here can produce an accent that fails against either ground. */
export interface Accent {
  id: string
  label: string
  hue: number
}

export const ACCENTS: readonly Accent[] = [
  { id: 'azure', label: 'Azure', hue: 240 },
  { id: 'violet', label: 'Violet', hue: 292 },
  { id: 'magenta', label: 'Magenta', hue: 340 },
  { id: 'rust', label: 'Rust', hue: 35 },
  { id: 'moss', label: 'Moss', hue: 145 },
  { id: 'teal', label: 'Teal', hue: 195 },
]

export const DEFAULT_ACCENT = 'azure'

const THEME_KEY = 'essay.theme.v1'
const ACCENT_KEY = 'essay.accent.v1'

const THEME_ATTRIBUTE = 'data-theme'
const ACCENT_PROPERTY = '--essay-accent-hue'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

export function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return isThemeId(stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function loadAccent(): string {
  try {
    const stored = localStorage.getItem(ACCENT_KEY)
    return ACCENTS.some((accent) => accent.id === stored) ? stored! : DEFAULT_ACCENT
  } catch {
    return DEFAULT_ACCENT
  }
}

/**
 * Paint the choice. `system` resolves here rather than in CSS because the
 * stylesheet has no `prefers-color-scheme` block at all — dark is `:root` and
 * light is an explicit `data-theme`, which is a deliberate statement about
 * which one is the identity. Resolving in JS keeps that statement intact and
 * still lets an author defer to their machine.
 */
export function applyTheme(id: ThemeId): void {
  const root = document.documentElement
  const light =
    id === 'light' ||
    (id === 'system' && !window.matchMedia(DARK_QUERY).matches)
  // Present means "the author is on paper"; absent is the untouched default,
  // same discipline as `data-prose-font`.
  if (light) root.setAttribute(THEME_ATTRIBUTE, 'light')
  else root.removeAttribute(THEME_ATTRIBUTE)

  // And tell the engine, which `data-theme` cannot: `color-scheme` is what
  // decides the parts of the interface Essay does not paint — scrollbars, the
  // caret in an input, focus rings on native controls, the ground behind an
  // overscroll. Left unset they follow the *operating system*, so an author on
  // a light machine choosing Essay's dark theme got pale scrollbars down every
  // popup and scrollable pane, which is exactly the thing that reads as "this
  // menu is not themed". It is set here rather than in the stylesheet because
  // `system` is resolved here (see above) and the two must not disagree.
  root.style.colorScheme = light ? 'light' : 'dark'
}

/** Inline, so it outranks both theme blocks and one choice covers both. */
export function applyAccent(id: string): void {
  const accent = ACCENTS.find((entry) => entry.id === id)
  const root = document.documentElement
  if (!accent || accent.id === DEFAULT_ACCENT) {
    root.style.removeProperty(ACCENT_PROPERTY)
    return
  }
  root.style.setProperty(ACCENT_PROPERTY, String(accent.hue))
}

export function saveTheme(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_KEY, id)
  } catch {
    // A preference that cannot be remembered is still a preference that works.
  }
}

export function saveAccent(id: string): void {
  try {
    localStorage.setItem(ACCENT_KEY, id)
  } catch {
    // As above.
  }
}

export function setTheme(id: ThemeId): void {
  saveTheme(id)
  applyTheme(id)
}

export function setAccent(id: string): void {
  saveAccent(id)
  applyAccent(id)
}

export function themeLabel(id: ThemeId): string {
  return THEMES.find((theme) => theme.id === id)?.label ?? THEMES[0].label
}

/** Next theme in the list, wrapping — what a palette command steps through. */
export function nextTheme(id: ThemeId): ThemeId {
  const index = THEMES.findIndex((theme) => theme.id === id)
  return THEMES[(index + 1) % THEMES.length].id
}

/**
 * Apply the stored appearance and keep `system` honest afterwards.
 *
 * The listener is the reason this returns a teardown rather than being two
 * calls: an author on `system` who lets their machine switch at sunset expects
 * the app to follow, and a `matchMedia` change is the only notice of it. It
 * costs nothing while the preference is explicit — the handler re-reads the
 * stored value and does nothing unless it is still `system`.
 */
export function startAppearance(): () => void {
  applyTheme(loadTheme())
  applyAccent(loadAccent())
  const query = window.matchMedia(DARK_QUERY)
  const onChange = () => {
    if (loadTheme() === 'system') applyTheme('system')
  }
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
