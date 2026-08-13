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

import { convertFileSrc, isTauri } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import type { Editor } from '@essay/editor'

/** Everything the insert dialog offers; shared so other surfaces agree. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']

// ——— Display-time resolution (ManuscriptImage's resolveSrc) ———
//
// The open document's directory, held module-level so the node view's
// resolver can be a plain function handed to the editor once. The host
// (Workspace) calls setImageBase on every document change. Staleness within
// one document's life is acceptable by design: node views are recreated when
// a document loads, so a base that changes mid-document (it cannot — saves
// do not move files) would only matter for a feature Essay does not have.

let imageBase: string | null = null

/** The open document's directory (dirname of its path), null while unsaved. */
export function setImageBase(dir: string | null): void {
  imageBase = dir
}

/** The current base, for surfaces (drag/drop, replace) that share it. */
export function currentImageBase(): string | null {
  return imageBase
}

/** `/x/y` or `C:/x` (separators already normalised). */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

/**
 * Turn a Markdown src into something the WebView can display. Display only:
 * the value never reaches the node attrs or the file — ManuscriptImage
 * guarantees that end of the bargain.
 *
 * URLs pass through (two-plus chars before the colon, so a Windows drive
 * letter is not mistaken for a scheme). Local paths go through Tauri's asset
 * protocol; a relative path is joined to the document's directory first —
 * the same base essay-render resolves against, so the editor and the proof
 * agree about which file a path names. A relative path with no base (unsaved
 * buffer) is returned as-is and will show the broken-image state, which is
 * honest: there is nothing to resolve it against.
 */
export function resolveImageSrc(src: string): string {
  if (/^[a-z][a-z0-9+.-]+:/i.test(src)) return src
  if (!isTauri()) return src
  const path = normalise(src)
  if (isAbsolutePath(path)) return convertFileSrc(path)
  if (imageBase) {
    return convertFileSrc(`${withoutTrailingSlash(normalise(imageBase))}/${path}`)
  }
  return src
}

/**
 * Ask for a replacement file for the selected image node and update its src
 * through the same path policy as insertion. Alt and title stay — they
 * describe the figure, not the file.
 */
export async function replaceImage(editor: Editor): Promise<boolean> {
  if (!isTauri()) return false
  const picked = await openDialog({
    multiple: false,
    filters: [
      { name: 'Images', extensions: IMAGE_EXTENSIONS },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  if (typeof picked !== 'string') return false
  const src = imageSrc(picked, imageBase)
  editor.chain().focus().updateAttributes('image', { src }).run()
  return true
}

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
