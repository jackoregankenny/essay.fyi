// The scratch note: the half of the task pane that is not in the manuscript.
//
// Stored in `.essay/` beside the document, same sidecar as comments and for
// the same reason — it is state *about* the work rather than part of it, and
// invariant 1 says the Markdown file is the document. A note here never
// reaches the manuscript, never changes a byte of it, and goes if the sidecar
// is deleted. That is the trade the pane has to state plainly, because it is
// the opposite trade from the checkboxes sitting directly above it: those are
// `- [ ]` lines in the file and travel anywhere it goes.
//
// No path, no scratch. The note lives beside the file, so an untitled buffer
// has nothing to live beside — the same gate comments already have.

import { invoke, isTauri } from '@tauri-apps/api/core'

/** How long after the last keystroke the note is written. Long enough that a
    sentence is one write rather than forty, short enough that closing the pane
    or the window a moment later has already saved. */
export const SCRATCH_DEBOUNCE_MS = 600

/**
 * Read the document's note. Empty for a document that has never had one, and
 * empty on any failure: a scratch pad that cannot be read is an empty scratch
 * pad, and throwing here would take the whole pane down with it.
 */
export async function readScratch(
  path: string | null,
  hash: string | null,
): Promise<string> {
  if (!isTauri() || !path || !hash) return ''
  try {
    return await invoke<string>('read_scratch', { path, hash })
  } catch {
    return ''
  }
}

/**
 * Replace the note. Resolves false when it could not be written, so a caller
 * can say so rather than silently believing it saved.
 */
export async function writeScratch(
  path: string | null,
  hash: string | null,
  body: string,
): Promise<boolean> {
  if (!isTauri() || !path || !hash) return false
  try {
    await invoke('write_scratch', { path, hash, body })
    return true
  } catch {
    return false
  }
}
