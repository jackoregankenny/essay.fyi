// Whether the file explorer is summoned or lives in the room.
//
// The overhaul's step 1 made the explorer a palette-summoned layer, and for
// the writing case that is right: a permanent tree is a permanent invitation
// to go and look at something other than the sentence you are in. Quick-open
// answers "which document" faster than a tree does, and the tree costs a
// column of the canvas forever to answer a question asked twice an hour.
//
// But that is a claim about a way of working, not a fact about everyone. An
// author moving between a dozen files in one sitting — a book of chapters, a
// docs tree, a set of RFCs — is navigating, not writing, and for them the
// summon is a keystroke tax on the thing they do most. Both are real, they do
// not have a defensible default between them, and the difference is cheap: the
// pane already exists and already knows how to open a file.
//
// So it is a preference, in the same sense as the writing width — it travels
// with the person, never touches the Markdown or the sidecar, and means
// nothing to a second machine reading the same file. Summoned stays the
// default, because the cost of the wrong default falls the gentler way: a
// pinned rail nobody wanted takes a column of writing surface, and a summon
// nobody wanted takes a keystroke.

export type FileRailId = 'summoned' | 'pinned'

export interface FileRailMode {
  id: FileRailId
  label: string
  detail: string
}

export const FILE_RAILS: readonly FileRailMode[] = [
  {
    id: 'summoned',
    label: 'Summoned',
    detail: 'Opens as a layer when you ask for it, and gets out of the way.',
  },
  {
    id: 'pinned',
    label: 'Pinned',
    detail: 'Keeps a column beside the manuscript. For moving between many files.',
  },
]

export const DEFAULT_FILE_RAIL: FileRailId = 'summoned'

/** How wide the rail runs when pinned. Narrower than the companion's track:
    this is a list of filenames, not a reading surface, and every pixel it
    takes is one the manuscript does not get. */
export const FILE_RAIL_WIDTH = '232px'

const STORAGE_KEY = 'essay.filerail.v1'

function isFileRailId(value: unknown): value is FileRailId {
  return FILE_RAILS.some((mode) => mode.id === value)
}

export function loadFileRail(): FileRailId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isFileRailId(stored) ? stored : DEFAULT_FILE_RAIL
  } catch {
    return DEFAULT_FILE_RAIL
  }
}

export function saveFileRail(id: FileRailId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // A preference that cannot be remembered is still a preference that works.
  }
}

/** Resolve by id, falling back to the default rather than to a position —
    the list is ordered for the menu, and reordering it must not silently
    change what an unknown preference resolves to. */
function mode(id: FileRailId): FileRailMode {
  const found = FILE_RAILS.find((entry) => entry.id === id)
  if (found) return found
  return FILE_RAILS.find((entry) => entry.id === DEFAULT_FILE_RAIL) ?? FILE_RAILS[0]
}

export function fileRailLabel(id: FileRailId): string {
  return mode(id).label
}

/** The other mode — what the palette command steps to. With two modes this is
    a toggle, and stays correct as a cycle if a third is ever added. */
export function nextFileRail(id: FileRailId): FileRailId {
  const index = FILE_RAILS.findIndex((entry) => entry.id === id)
  return FILE_RAILS[(index + 1) % FILE_RAILS.length].id
}
