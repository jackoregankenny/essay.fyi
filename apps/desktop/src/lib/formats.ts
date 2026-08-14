// The formats a document can be set in.
//
// Unlike the measure or the image store, this is not a preference: it is a
// document property, written into front matter as `format:` and read by
// whoever opens the file next. So nothing is remembered here — the list comes
// from Rust, where the templates are embedded, and the current value comes
// back with the pages that were set in it.
//
// The list is a compile-time constant on the other side, which is why this
// module has no cache and no failure story worth the name: outside the desktop
// shell there is no compiler to ask, and an empty list is the honest answer.

import { invoke, isTauri } from '@tauri-apps/api/core'

export interface Format {
  id: string
  label: string
  /** One line, in the author's terms: what kind of document this is for. */
  description: string
}

export const DEFAULT_FORMAT = 'essay'

export async function listFormats(): Promise<Format[]> {
  if (!isTauri()) return []
  return invoke<Format[]>('list_formats')
}

/** Label for an id without waiting on the list — a format the document names
    but this machine does not have still has to read as something. */
export function formatLabel(formats: readonly Format[], id: string): string {
  return formats.find((format) => format.id === id)?.label ?? id
}
