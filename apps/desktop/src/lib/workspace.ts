// Multi-root workspace folders for the explorer. Unlike a single-vault
// model, any number of folders can be added or removed independently.
// Persistence is localStorage for now; this moves into .essay/app state
// once essay-workspace lands (Milestone 3).

import { invoke, isTauri } from '@tauri-apps/api/core'
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

/** Join a workspace root and a tree-relative path using the root's separator. */
export function joinPath(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  return root.replace(/[\\/]+$/, '') + sep + rel.replaceAll('/', sep)
}
