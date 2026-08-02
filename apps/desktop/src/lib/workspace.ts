// Multi-root workspace folders for the explorer. Unlike a single-vault
// model, any number of folders can be added or removed independently.
// Persistence is localStorage for now; this moves into .essay/app state
// once essay-workspace lands (Milestone 3).

import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { fileName } from './documentFile'

export interface WorkspaceFolder {
  /** Absolute path on disk. */
  path: string
  /** Display name (folder basename). */
  name: string
}

const STORAGE_KEY = 'essay.workspace.folders.v1'

export function loadWorkspaceFolders(): WorkspaceFolder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (f): f is WorkspaceFolder =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as WorkspaceFolder).path === 'string' &&
        typeof (f as WorkspaceFolder).name === 'string',
    )
  } catch {
    return []
  }
}

export function saveWorkspaceFolders(folders: WorkspaceFolder[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(folders))
  // A folder that is no longer in the workspace has no tree to remember the
  // shape of, and its record would otherwise sit in storage for ever.
  pruneExpansion(folders.map((folder) => folder.path))
}

// ——— Which folders the author left open ———
//
// The explorer is lazy-loaded inside a popover, so it unmounts every time the
// popover closes. Without this the tree collapses back to depth 1 several
// times a session — the author reopens it and their place is gone. Keyed by
// root path so each folder remembers its own shape.

const EXPANSION_KEY = 'essay.workspace.expanded.v1'

/** Root path -> the directories left open under it, root-relative. */
type ExpansionState = Record<string, string[]>

/** Enough for a deeply nested manuscript folder, far short of the 5MB
    localStorage budget. Trimmed rather than refused: losing the tail of a very
    large expansion is invisible, failing to save any of it is not. */
const MAX_EXPANDED_PER_ROOT = 250

function readExpansion(): ExpansionState {
  try {
    const raw = localStorage.getItem(EXPANSION_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    const state: ExpansionState = {}
    for (const [root, dirs] of Object.entries(parsed as ExpansionState)) {
      if (Array.isArray(dirs)) {
        state[root] = dirs.filter((dir): dir is string => typeof dir === 'string')
      }
    }
    return state
  } catch {
    return {}
  }
}

/**
 * The directories the author had open under `root`, or null if this folder has
 * never been recorded.
 *
 * Null and `[]` mean different things and the caller has to tell them apart: a
 * folder nobody has touched should open to its first level, a folder the
 * author deliberately collapsed should stay collapsed.
 */
export function loadExpandedDirs(root: string): string[] | null {
  return readExpansion()[root] ?? null
}

export function saveExpandedDirs(root: string, dirs: string[]): void {
  const state = readExpansion()
  state[root] = dirs.slice(0, MAX_EXPANDED_PER_ROOT)
  try {
    localStorage.setItem(EXPANSION_KEY, JSON.stringify(state))
  } catch {
    // A full or disabled localStorage costs the tree its memory, never the
    // author their files.
  }
}

/** Drop records for folders that are no longer in the workspace. */
function pruneExpansion(keep: string[]): void {
  const state = readExpansion()
  const kept: ExpansionState = {}
  for (const root of keep) {
    if (state[root]) kept[root] = state[root]
  }
  try {
    localStorage.setItem(EXPANSION_KEY, JSON.stringify(kept))
  } catch {
    // As above.
  }
}

/** Native folder picker. Resolves null on cancel or outside the desktop shell. */
export async function pickWorkspaceFolder(): Promise<WorkspaceFolder | null> {
  if (!isTauri()) return null
  const path = await openDialog({ directory: true, multiple: false })
  if (typeof path !== 'string') return null
  return { path, name: fileName(path) }
}

/**
 * Root-relative markdown tree for one folder: directories end with '/',
 * files are .md/.markdown (the @pierre/trees input convention).
 */
export function listMarkdownTree(root: string): Promise<string[]> {
  return invoke<string[]>('list_markdown_tree', { root })
}

/** One folder whose listing changed, with the listing that replaces it. */
export interface TreeChange {
  root: string
  paths: string[]
}

/**
 * Watch these folders for files being created, deleted or renamed.
 *
 * Pass an empty array to stop. The explorer does exactly that when it
 * unmounts: a recursive watch on a large folder is not free, and a tree nobody
 * is looking at is re-walked when it next opens anyway.
 */
export async function watchWorkspaceRoots(roots: string[]): Promise<void> {
  if (!isTauri()) return
  await invoke('watch_workspace_roots', { roots })
}

/**
 * Subscribe to changes in the watched folders. Resolves an unsubscribe.
 *
 * The new listing arrives with the event, so nothing here asks for the tree
 * again — the walk that detected the change produced it.
 */
export async function onTreeChange(
  handler: (change: TreeChange) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {}
  return listen<TreeChange>('essay://tree-change', (event) =>
    handler(event.payload),
  )
}

/** Join a workspace root and a tree-relative path using the root's separator. */
export function joinPath(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  return root.replace(/[\\/]+$/, '') + sep + rel.replaceAll('/', sep)
}
