// Drag-and-drop image insertion.
//
// Tauri 2 intercepts native file drops before the DOM sees them (the WebView
// gets no dataTransfer.files with paths), so the wiring is the webview's
// onDragDropEvent, not an HTML drop handler. Only drops that contain image
// files are claimed; everything else is left for whoever else listens —
// dropping a .md on the window must keep meaning whatever it means today.
//
// Inserted paths go through the same imageSrc() policy as the picker:
// relative inside the document's directory, absolute otherwise, forward
// slashes, never a URL scheme. The document directory is the module-level
// base images.ts already holds for display resolution — one funnel, one
// answer.
//
// Paste is deliberately NOT handled here, and the gap is stated rather than
// papered over: pasted image DATA (a clipboard bitmap, or Files without OS
// paths — webviews do not expose paths on paste) has no source path, so
// honouring the path policy means writing a file the author chooses. Essay's
// frontend currently has no byte-level write path — no @tauri-apps/plugin-fs,
// and the only write commands are the hash-guarded text `write_document` and
// the renderer's own `export_pdf` — so paste-to-file needs either plugin-fs
// with a scoped capability or a small `write_image_bytes` command first.
// Until one exists, pasting an image does nothing rather than something
// silent or lossy.

import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { Editor } from '@essay/editor'
import { IMAGE_EXTENSIONS, currentImageBase, imageSrc } from './images'

function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTENSIONS.includes(path.slice(dot + 1).toLowerCase())
}

/**
 * Listen for native file drops and insert dropped images at the drop point.
 * Returns an unsubscribe for the host to call when the editor goes away.
 * Outside the desktop shell this is a no-op — a browser drop carries no
 * filesystem paths a Markdown file could hold.
 */
export function attachImageDrop(editor: Editor): () => void {
  if (!isTauri()) return () => {}

  let disposed = false
  let unlisten: (() => void) | null = null

  void getCurrentWebview().onDragDropEvent(event => {
    if (event.payload.type !== 'drop') return
    const images = event.payload.paths.filter(isImagePath)
    if (images.length === 0) return
    if (editor.isDestroyed) return

    // The event reports physical pixels; posAtCoords speaks CSS pixels.
    const scale = window.devicePixelRatio || 1
    const hit = editor.view.posAtCoords({
      left: event.payload.position.x / scale,
      top: event.payload.position.y / scale,
    })
    const pos = hit ? hit.pos : editor.state.selection.to

    // One insertContentAt for the lot: the files land in drop order and the
    // whole drop is one undo step.
    const base = currentImageBase()
    const nodes = images.map(path => ({
      type: 'image',
      attrs: { src: imageSrc(path, base) },
    }))
    editor.chain().focus().insertContentAt(pos, nodes).run()
  }).then(fn => {
    // The listener resolves async; a host that unmounted meanwhile still
    // gets its unsubscribe honoured.
    if (disposed) fn()
    else unlisten = fn
  })

  return () => {
    disposed = true
    unlisten?.()
    unlisten = null
  }
}
