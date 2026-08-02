// Which desktop Essay is running on, and what a shortcut is called there.
//
// Read from the user agent once, synchronously, at module load.
// `@tauri-apps/plugin-os` is more authoritative but it answers a promise, and
// chrome that decides where the window buttons go a frame late is chrome that
// visibly jumps on every launch. The strings are stable enough for the three
// desktops Essay ships to: WebView2 says "Windows NT", WKWebView says
// "Macintosh", WebKitGTK says "X11; Linux".
//
// Nothing here decides *behaviour*. The keyboard handler accepts
// `ctrlKey || metaKey` on every platform, so Cmd already worked; what was
// wrong was only the labels, and a label is exactly the sort of thing that
// should not be branching on `navigator` in nine different components.

const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent

export const isMac = /Mac/i.test(agent)
export const isWindows = /Win/i.test(agent)
export const isLinux = !isMac && !isWindows

/**
 * How much room to leave at the top-left of the header on macOS.
 *
 * With `titleBarStyle: Overlay` the traffic lights are drawn by the OS *over*
 * the web content, and nothing in the DOM knows they are there. Without this
 * the sidebar toggle sits underneath the close button, where the author's
 * click either misses or quits the app. Measured against the standard
 * unzoomed inset (three 14px buttons on a 20px pitch from x=13) with room to
 * spare, because the exact geometry moves between macOS versions.
 */
export const TRAFFIC_LIGHT_INSET = 78

/** The primary modifier, spelled the way the platform spells it. Ctrl and Cmd
    are the same key to the handler, so they are the same entry here. */
export const commandKey = isMac ? '⌘' : 'Ctrl'

const MAC_GLYPHS: Record<string, string> = {
  ctrl: '⌘',
  cmd: '⌘',
  meta: '⌘',
  shift: '⇧',
  alt: '⌥',
  option: '⌥',
  control: '⌃',
}

/** macOS prints modifiers in one fixed order whatever order they were written
    in, so "Ctrl+Shift+S" and "Shift+Ctrl+S" both have to come out as ⇧⌘S. */
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘']

/**
 * A shortcut as this platform writes it: 'Ctrl+Shift+S' stays itself on
 * Windows and Linux, and becomes '⇧⌘S' on macOS.
 *
 * Applied where shortcuts are declared rather than where they are drawn, so
 * the palette, the tooltips and anything later that reads the command registry
 * all get the right label from one call site each.
 */
export function shortcut(keys: string): string {
  if (!isMac) return keys
  const glyphs: string[] = []
  const rest: string[] = []
  for (const part of keys.split('+')) {
    const glyph = MAC_GLYPHS[part.trim().toLowerCase()]
    if (glyph) glyphs.push(glyph)
    else rest.push(part.trim())
  }
  glyphs.sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b))
  // No separator: ⌘ + S is written ⌘S, and a plus sign between glyphs reads
  // as a key you are meant to press.
  return [...glyphs, ...rest].join('')
}
