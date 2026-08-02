// Open/save for the canonical Markdown file. In the desktop app this goes
// through native dialogs and Rust file IO (read_document/write_document);
// in a plain browser (dev preview) it falls back to a file input and a
// download so the flow stays testable.
//
// Every read hands back a content hash, and every save hands it in again.
// That hash is how Essay tells "the file I opened" from "the file something
// else has edited since" — the guard that stops an autosave from quietly
// overwriting an agent, a `git checkout`, or another editor.

import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { forgetRecentFile, rememberRecentFile } from './recents'

const MARKDOWN_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: 'All files', extensions: ['*'] },
]

export interface DocumentRef {
  /** Absolute path on disk; null while the document is unsaved (browser fallback stays pathless). */
  path: string | null
  name: string
}

export interface OpenedDocument extends DocumentRef {
  contents: string
  /** Hash of `contents` as read; null outside the desktop shell. */
  hash: string | null
}

/** What happened when the editor asked to save. */
export type SaveResult =
  | { status: 'written'; ref: DocumentRef; hash: string | null }
  | { status: 'conflict'; diskHash: string; diskContents: string }
  | { status: 'cancelled' }

/** An edit to the open document that did not come from the editor. */
export interface ExternalChange {
  path: string
  hash: string
  contents: string
}

/** A buffer from a previous run that never reached disk. */
export interface RecoverableBuffer {
  key: string
  name: string
  path: string | null
  contents: string
  baseHash: string | null
  updatedAt: number
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/**
 * Read a known path directly (explorer clicks, the recents list, the palette).
 * Desktop shell only.
 *
 * Resolves null when the file cannot be read rather than throwing. Every
 * caller reaches this from something the author clicked on — a tree row, a
 * remembered path — and any of those can name a file that has since been
 * renamed, moved or deleted. A rejected promise there is an unhandled
 * rejection in the console and nothing at all on screen.
 */
export async function openDocumentByPath(
  path: string,
): Promise<OpenedDocument | null> {
  if (!isTauri()) return null
  try {
    const payload = await readDocument(path)
    const name = fileName(path)
    rememberRecentFile(path, name)
    return { path, name, ...payload }
  } catch {
    // Gone or unreadable. Stop offering it back.
    forgetRecentFile(path)
    return null
  }
}

/** Show an open dialog and read the chosen file. Resolves null on cancel. */
export async function openDocumentFile(): Promise<OpenedDocument | null> {
  if (isTauri()) {
    const path = await openDialog({ multiple: false, filters: MARKDOWN_FILTERS })
    if (typeof path !== 'string') return null
    return openDocumentByPath(path)
  }
  return openViaFileInput()
}

/**
 * Write contents to `path`, or prompt for a location when there is none.
 *
 * `baseHash` is what the editor believes is on disk. Pass null for a first
 * save or a Save As — there the native dialog has already asked about
 * replacing, so the caller owns the location outright.
 */
export async function saveDocumentFile(
  contents: string,
  path: string | null,
  suggestedName: string,
  baseHash: string | null,
): Promise<SaveResult> {
  if (isTauri()) {
    let target = path
    let guard = baseHash
    if (!target) {
      target = await saveDialog({
        filters: MARKDOWN_FILTERS,
        defaultPath: suggestedName,
      })
      if (!target) return { status: 'cancelled' }
      guard = null
    }
    const outcome = await invoke<
      | { status: 'written'; hash: string }
      | { status: 'conflict'; diskHash: string; diskContents: string }
    >('write_document', { path: target, contents, baseHash: guard })

    if (outcome.status === 'conflict') return outcome
    return {
      status: 'written',
      ref: { path: target, name: fileName(target) },
      hash: outcome.hash,
    }
  }
  downloadFallback(contents, path ?? suggestedName)
  return {
    status: 'written',
    ref: { path: null, name: fileName(path ?? suggestedName) },
    hash: null,
  }
}

/** Stop watching the open document — it was closed or replaced. */
export async function closeDocument(): Promise<void> {
  if (isTauri()) await invoke('close_document')
}

/**
 * Subscribe to edits made to the open document by anything other than Essay.
 * Resolves an unsubscribe function.
 */
export async function onExternalChange(
  handler: (change: ExternalChange) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {}
  return listen<ExternalChange>('essay://external-change', (event) =>
    handler(event.payload),
  )
}

/**
 * Record the in-progress buffer outside the document tree. Cheap enough to
 * run on a short debounce, and the only thing standing between an untitled
 * buffer and a power cut.
 */
export async function journalBuffer(entry: {
  key: string
  name: string
  path: string | null
  contents: string
  baseHash: string | null
}): Promise<void> {
  if (isTauri()) await invoke('journal_buffer', entry)
}

export async function clearJournal(key: string): Promise<void> {
  if (isTauri()) await invoke('clear_journal', { key })
}

/** Buffers from a previous run that hold something their file does not. */
export async function pendingRecovery(): Promise<RecoverableBuffer[]> {
  if (!isTauri()) return []
  return invoke<RecoverableBuffer[]>('pending_recovery')
}

/**
 * Typeset the manuscript to PDF at a user-chosen location. Desktop only.
 * Resolves the written path, or null on cancel.
 */
export async function exportPdfFile(
  contents: string,
  suggestedName: string,
  root: string | null,
): Promise<string | null> {
  if (!isTauri()) return null
  const target = await saveDialog({
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    defaultPath: suggestedName.replace(/\.(md|markdown)$/i, '.pdf'),
  })
  if (!target) return null
  await invoke('export_pdf', { source: contents, root, path: target })
  return target
}

function readDocument(
  path: string,
): Promise<{ contents: string; hash: string }> {
  return invoke<{ contents: string; hash: string }>('read_document', { path })
}

function openViaFileInput(): Promise<OpenedDocument | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,text/markdown'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      resolve({
        path: null,
        name: file.name,
        contents: await file.text(),
        hash: null,
      })
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

function downloadFallback(contents: string, name: string): void {
  const url = URL.createObjectURL(
    new Blob([contents], { type: 'text/markdown' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
