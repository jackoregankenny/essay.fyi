// Pasted images: getting the bytes onto disk, and getting them home.
//
// This is the other half of `imageDrop.ts`, whose header explained why paste
// did nothing: pasted image data has no source path, so honouring the path
// policy in `images.ts` means writing a file, and until `write_image_bytes`
// existed the frontend had no way to write bytes at all.
//
// Two things live here because they are one story. `attachImagePaste` puts
// the bytes somewhere — the author's chosen folder, or the staging directory
// when the buffer has no folder yet. `relocateStagedImages` is the second
// half of that "yet": the first save gives the document a home, and every
// image that was waiting moves into it and has its reference rewritten.
//
// A DOM listener in the capture phase rather than a ProseMirror plugin. Two
// reasons: the work is asynchronous (read the blob, write the file, then
// insert) and `handlePaste` must answer synchronously; and capture puts this
// ahead of both ProseMirror's own clipboard parsing and the Markdown paste
// extension, so a screenshot never has a chance to arrive as an <img> tag
// pointing at a blob: URL the Markdown could not hold.

import type { Editor } from '@essay/editor'
import { currentImageBase, imageSrc } from './images'
import {
  canWriteImages,
  imageTargetDir,
  isStaged,
  relocateImage,
  stagingDir,
  writeImageBytes,
  type ImageStoreId,
} from './imageStore'

/** Clipboard MIME → the extension Essay will write. Anything not here is not
    an image Essay stores; the Rust side refuses the rest a second time. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/** What the paste handler needs to know at the moment of the paste, read
    fresh each time — the document and the preference both change under it. */
export interface ImagePasteContext {
  documentPath: string | null
  store: ImageStoreId
}

function stemFor(file: File): string {
  const name = file.name ?? ''
  const dot = name.lastIndexOf('.')
  const base = dot <= 0 ? name : name.slice(0, dot)
  // Clipboard files are usually called `image.png` or nothing at all. Neither
  // is worth keeping: a folder of `image-7.png` says less than the date does.
  if (!base || base.toLowerCase() === 'image') {
    const now = new Date()
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-')
    return `pasted-${stamp}`
  }
  return base
}

function imageFilesIn(data: DataTransfer | null): File[] {
  if (!data) return []
  const files: File[] = []
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue
    if (!(item.type in EXTENSION_BY_MIME)) continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  return files
}

/**
 * Insert pasted images at the caret, writing their bytes first.
 *
 * Returns an unsubscribe for the host to call when the editor goes away.
 * Outside the desktop shell this is a no-op: a browser has nowhere to put the
 * bytes, and a `blob:` URL is not something a Markdown file can hold.
 */
export function attachImagePaste(
  editor: Editor,
  context: () => ImagePasteContext,
): () => void {
  if (!canWriteImages()) return () => {}

  const dom = editor.view.dom

  const onPaste = (event: Event) => {
    const clipboard = (event as ClipboardEvent).clipboardData
    const files = imageFilesIn(clipboard)
    if (files.length === 0) return

    // Claimed. Nothing below this point may fall through to the default
    // paste, or the same screenshot arrives twice — once as a file and once
    // as whatever HTML the source application also put on the clipboard.
    event.preventDefault()
    event.stopPropagation()

    const { documentPath, store } = context()
    // The caret is read now, synchronously: by the time the bytes are written
    // the author may have typed, and inserting at a stale position is worse
    // than inserting at the end of what they just wrote.
    const at = editor.state.selection.to

    void (async () => {
      try {
        const dir = await imageTargetDir(store, documentPath)
        const written: string[] = []
        for (const file of files) {
          const extension = EXTENSION_BY_MIME[file.type]
          const bytes = new Uint8Array(await file.arrayBuffer())
          written.push(await writeImageBytes(dir, stemFor(file), extension, bytes))
        }
        if (editor.isDestroyed || written.length === 0) return

        const base = currentImageBase()
        const nodes = written.map((path) => ({
          type: 'image',
          attrs: { src: imageSrc(path, base) },
        }))
        // One insert for the lot, so a multi-image paste is one undo step —
        // the same contract as a multi-file drop.
        editor.chain().focus().insertContentAt(at, nodes).run()
      } catch (error) {
        // Reported rather than swallowed: a paste that silently does nothing
        // is exactly the failure this feature was added to remove.
        console.error('Could not paste image', error)
      }
    })()
  }

  dom.addEventListener('paste', onPaste, { capture: true })
  return () => dom.removeEventListener('paste', onPaste, { capture: true })
}

/**
 * Move every image still sitting in the staging directory into the folder the
 * now-saved document uses, and rewrite the references to match.
 *
 * Called after a first save. Deliberately best-effort per image: one file that
 * cannot be moved must not strand the others or fail the save, because the
 * save has already happened — the manuscript is on disk and this is tidying
 * after it.
 *
 * Returns the number of images relocated, which is what tells the caller
 * whether the document is now dirty again.
 */
export async function relocateStagedImages(
  editor: Editor,
  documentPath: string,
  store: ImageStoreId,
): Promise<number> {
  if (!canWriteImages()) return 0

  const staging = await stagingDir()

  // Collected before anything moves: the walk reads positions, and rewriting
  // as we go would invalidate the ones not yet visited.
  const pending: Array<{ pos: number; src: string }> = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'image') return
    const src = String(node.attrs.src ?? '')
    if (src && isStaged(src, staging)) pending.push({ pos, src })
  })
  if (pending.length === 0) return 0

  const dir = await imageTargetDir(store, documentPath)
  const base = currentImageBase()
  const moved = new Map<string, string>()
  for (const { src } of pending) {
    if (moved.has(src)) continue
    try {
      moved.set(src, await relocateImage(src, dir))
    } catch (error) {
      console.error(`Could not move ${src} into ${dir}`, error)
    }
  }
  if (moved.size === 0 || editor.isDestroyed) return 0

  // One transaction: the rewrite is bookkeeping about where bytes live, not an
  // edit the author made, and it should undo as a single step if at all.
  const { tr } = editor.state
  let rewritten = 0
  for (const { pos, src } of pending) {
    const target = moved.get(src)
    if (!target) continue
    const node = editor.state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'image') continue
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: imageSrc(target, base) })
    rewritten += 1
  }
  if (rewritten > 0) editor.view.dispatch(tr)
  return rewritten
}
