// Documents opened recently, most recent first.
//
// Separate from the workspace folders because it answers a different question.
// A folder is somewhere the author put their work; a recent file is somewhere
// they were five minutes ago, and it may well be outside every folder they
// have added. The explorer cannot show it, which is exactly why this exists.
//
// Persistence is localStorage, alongside the folders, for the same reason: it
// is a preference about this installation rather than anything about the
// documents. Deleting it costs a list, never a file.

export interface RecentFile {
  /** Absolute path on disk. */
  path: string
  /** Display name (file basename). */
  name: string
  /** When it was last opened, epoch milliseconds. */
  openedAt: number
}

const STORAGE_KEY = 'essay.recent.files.v1'

/** Long enough to cover a working session's worth of switching, short enough
    that the list is still scannable at a glance rather than a second file
    explorer. */
const MAX_RECENTS = 12

export function loadRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (entry): entry is RecentFile =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as RecentFile).path === 'string' &&
          typeof (entry as RecentFile).name === 'string' &&
          typeof (entry as RecentFile).openedAt === 'number',
      )
      .slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

function save(entries: RecentFile[]): RecentFile[] {
  const capped = entries.slice(0, MAX_RECENTS)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped))
  } catch {
    // A full or disabled localStorage costs the list, never the document that
    // was just opened.
  }
  return capped
}

/**
 * Record a document as opened, moving it to the front.
 *
 * Called from the one place every open goes through, rather than from each
 * surface that can open something — the explorer, the palette, the dialog, the
 * recents list itself. A surface that forgot to call this would be a file that
 * silently never appears here.
 *
 * The display name is handed in rather than derived here: `documentFile` owns
 * splitting a path, and importing it back would make these two modules
 * mutually dependent for one basename.
 */
export function rememberRecentFile(path: string, name: string): RecentFile[] {
  const existing = loadRecentFiles().filter((recent) => recent.path !== path)
  return save([{ path, name, openedAt: Date.now() }, ...existing])
}

/**
 * Drop a document from the list.
 *
 * The list is a record of what the author opened, not a claim that those files
 * still exist — they get renamed, moved and deleted outside Essay all the
 * time. Rather than stat every entry on the way to rendering (a disk hit per
 * row, every time the popover opens), an entry that fails to open is removed
 * at that point. The one click it costs is the only honest moment to find out.
 */
export function forgetRecentFile(path: string): RecentFile[] {
  return save(loadRecentFiles().filter((recent) => recent.path !== path))
}
