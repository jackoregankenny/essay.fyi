import './dom'

import { Editor } from '@tiptap/core'

import { manuscriptExtensions } from '../src/index'
import { getManuscript, setManuscript } from '../src/frontmatter'

/**
 * One save cycle: open a Markdown file in a real manuscript surface and write
 * it back out, exactly as the app does (`setManuscript` → `getManuscript`).
 *
 * The editor is destroyed afterwards so a suite of these does not leak a
 * ProseMirror view per fixture.
 */
export function roundTrip(source: string): string {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: manuscriptExtensions(),
  })
  try {
    setManuscript(editor, source)
    return getManuscript(editor)
  } finally {
    editor.destroy()
  }
}

/**
 * Two save cycles. A serializer can be lossy and still be *stable* — the
 * second save producing the same bytes as the first is what stops an
 * author's file drifting a little further on every autosave. Tests assert
 * stability separately from fidelity because the two failures mean very
 * different things.
 */
export function roundTripTwice(source: string): { once: string; twice: string } {
  const once = roundTrip(source)
  return { once, twice: roundTrip(once) }
}
