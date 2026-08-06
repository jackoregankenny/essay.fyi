// Insert an image into the manuscript via the native file dialog.
//
// Path discipline — the file IS the document. If the picked image lives
// inside the open document's directory, the inserted path is RELATIVE to it,
// so the Markdown stays portable (move the folder, the image comes along) and
// so Typst can typeset it: essay-render's `EssayWorld` resolves relative file
// references against the document's folder (`root` in
// crates/essay-render/src/world.rs), so a relative path is the one spelling
// that works in both the editor and the print pane.
//
// An image outside the document's directory (or in an unsaved buffer, where
// there is no directory yet) is inserted as a plain absolute path — NOT a
// `file://` URL. A URL scheme in the Markdown would be a spelling only a
// webview understands: Typst's `#image()` takes a path, other Markdown tools
// take a path, and the canonical file must not carry webview-isms. Assumption,
// stated: the in-editor <img> preview of local paths needs Tauri's asset
// protocol (convertFileSrc) applied at RENDER time by the Image node view —
// that is presentation, and does not belong in the serialized document.
//
// Palette wiring for the integrator (not done here):
//   register an 'insert.image' command in the palette registry, e.g.
//     { id: 'insert.image', title: 'Insert image…',
//       run: () => insertImage(editor, documentDir) }
//   where `documentDir` is the open document's folder (dirname of
//   DocumentRef.path, null while unsaved).

import { isTauri } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import type { Editor } from '@essay/editor'

/** Everything the insert dialog offers; shared so other surfaces agree. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']

/**
 * Ask for an image file and insert it at the caret. Resolves true when an
 * image was inserted, false on cancel or outside the desktop shell (the
 * browser fallback has no filesystem paths to put in a Markdown file).
 */
export async function insertImage(
  editor: Editor,
  documentDir: string | null,
): Promise<boolean> {
  if (!isTauri()) return false
  const picked = await openDialog({
    multiple: false,
    filters: [
      { name: 'Images', extensions: IMAGE_EXTENSIONS },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  if (typeof picked !== 'string') return false

  const src = imageSrc(picked, documentDir)
  editor.chain().focus().setImage({ src }).run()
  return true
}

/**
 * The path as it should appear in the Markdown: relative to the document's
 * directory when the image is inside it, absolute otherwise. Exported for
 * tests and for any future drag-and-drop path to share the discipline.
 */
export function imageSrc(
  imagePath: string,
  documentDir: string | null,
): string {
  if (documentDir) {
    // Normalise separators before comparing — on Windows the dialog answers
    // with backslashes, and the Markdown should carry forward slashes either
    // way (every consumer, Typst included, accepts them).
    const dir = withoutTrailingSlash(normalise(documentDir))
    const img = normalise(imagePath)
    if (img.startsWith(dir + '/')) return img.slice(dir.length + 1)
  }
  return normalise(imagePath)
}

function normalise(path: string): string {
  return path.replace(/\\/g, '/')
}

function withoutTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path
}
