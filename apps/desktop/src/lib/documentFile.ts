// Open/save for the canonical Markdown file. In the desktop app this goes
// through native dialogs and Rust file IO (read_document/write_document);
// in a plain browser (dev preview) it falls back to a file input and a
// download so the flow stays testable.

import { invoke, isTauri } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'

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
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/** Read a known path directly (explorer clicks). Desktop shell only. */
export async function openDocumentByPath(
  path: string,
): Promise<OpenedDocument | null> {
  if (!isTauri()) return null
  const contents = await invoke<string>('read_document', { path })
  return { path, name: fileName(path), contents }
}

/** Show an open dialog and read the chosen file. Resolves null on cancel. */
export async function openDocumentFile(): Promise<OpenedDocument | null> {
  if (isTauri()) {
    const path = await openDialog({ multiple: false, filters: MARKDOWN_FILTERS })
    if (typeof path !== 'string') return null
    const contents = await invoke<string>('read_document', { path })
    return { path, name: fileName(path), contents }
  }
  return openViaFileInput()
}

/**
 * Write contents to `path`, or prompt for a location when there is none.
 * Resolves the saved location, or null on cancel.
 */
export async function saveDocumentFile(
  contents: string,
  path: string | null,
  suggestedName: string,
): Promise<DocumentRef | null> {
  if (isTauri()) {
    let target = path
    if (!target) {
      target = await saveDialog({
        filters: MARKDOWN_FILTERS,
        defaultPath: suggestedName,
      })
      if (!target) return null
    }
    await invoke('write_document', { path: target, contents })
    return { path: target, name: fileName(target) }
  }
  downloadFallback(contents, path ?? suggestedName)
  return { path: null, name: fileName(path ?? suggestedName) }
}

function openViaFileInput(): Promise<OpenedDocument | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,text/markdown'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      resolve({ path: null, name: file.name, contents: await file.text() })
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
