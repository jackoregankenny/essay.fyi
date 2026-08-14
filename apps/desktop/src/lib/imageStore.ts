// Where a pasted image's bytes go.
//
// A dropped or picked image already exists somewhere the author put it, and
// `images.ts` references it in place. Pasted image DATA has no source path —
// a webview never exposes one — so Essay has to write a file, and *where* is
// a question with no right answer: a folder of assets beside the document is
// portable and tidy, a folder named after the document keeps two manuscripts
// in one directory from sharing a bin, and a central library suits someone
// who reuses the same diagrams across a dozen essays.
//
// So it is the author's, not ours. A preference, not a document property: it
// travels with the person, never touches the Markdown or the sidecar, and
// changing it never moves an image that has already landed — a reference that
// works must keep working.
//
// The one case with no choice in it is an untitled buffer. There is no folder
// to be beside, so bytes stage in app data and move into place the first time
// the document is saved (see `relocateStagedImages`).

import { invoke, isTauri } from '@tauri-apps/api/core'

export type ImageStoreId = 'beside' | 'perDocument' | 'library'

export interface ImageStore {
  id: ImageStoreId
  label: string
  /** Shown where the choice is made; says what the author gets, not how. */
  detail: string
}

export const IMAGE_STORES: readonly ImageStore[] = [
  {
    id: 'beside',
    label: 'Assets folder',
    detail: 'assets/ beside the document — move the folder, images come along',
  },
  {
    id: 'perDocument',
    label: 'Folder per document',
    detail: 'essay-assets/ named after the document — self-contained',
  },
  {
    id: 'library',
    label: 'Central library',
    detail: 'one images folder for everything — the Markdown holds full paths',
  },
]

export const DEFAULT_IMAGE_STORE: ImageStoreId = 'beside'

const STORAGE_KEY = 'essay.imageStore.v1'
const STAGING_DIR = 'staged-images'
const LIBRARY_DIR = 'images'

function isImageStoreId(value: unknown): value is ImageStoreId {
  return IMAGE_STORES.some((store) => store.id === value)
}

export function loadImageStore(): ImageStoreId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isImageStoreId(stored) ? stored : DEFAULT_IMAGE_STORE
  } catch {
    return DEFAULT_IMAGE_STORE
  }
}

export function saveImageStore(id: ImageStoreId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // A preference that cannot be remembered is still a preference that works.
  }
}

/** Resolve by id rather than by position, so reordering the list for a menu
    cannot silently change what an unknown preference means. */
function store(id: ImageStoreId): ImageStore {
  return (
    IMAGE_STORES.find((entry) => entry.id === id) ??
    IMAGE_STORES.find((entry) => entry.id === DEFAULT_IMAGE_STORE) ??
    IMAGE_STORES[0]
  )
}

export function imageStoreLabel(id: ImageStoreId): string {
  return store(id).label
}

export function nextImageStore(id: ImageStoreId): ImageStoreId {
  const index = IMAGE_STORES.findIndex((entry) => entry.id === id)
  return IMAGE_STORES[(index + 1) % IMAGE_STORES.length].id
}

/** Separators are normalised the moment a path enters this module, so nothing
    downstream has to know which platform produced it. */
function slashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function dirname(path: string): string {
  const at = slashes(path).lastIndexOf('/')
  return at < 0 ? '' : slashes(path).slice(0, at)
}

function stem(path: string): string {
  const name = slashes(path).slice(slashes(path).lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name : name.slice(0, dot)
}

export async function stagingDir(): Promise<string> {
  return invoke<string>('image_app_dir', { name: STAGING_DIR })
}

/**
 * The folder this document's pasted images belong in.
 *
 * `null` for the document path means an untitled buffer: there is nowhere to
 * be beside, so the answer is the staging directory whatever the preference
 * says. Everything else follows the author's choice.
 */
export async function imageTargetDir(
  id: ImageStoreId,
  documentPath: string | null,
): Promise<string> {
  if (!documentPath) return stagingDir()
  switch (id) {
    case 'library':
      return invoke<string>('image_app_dir', { name: LIBRARY_DIR })
    case 'perDocument':
      return `${dirname(documentPath)}/${stem(documentPath)}-assets`
    default:
      return `${dirname(documentPath)}/assets`
  }
}

/** True when a path sits in the staging directory and therefore still needs a
    home. Compared case-insensitively because Windows hands back both. */
export function isStaged(src: string, staging: string): boolean {
  return slashes(src).toLowerCase().startsWith(`${slashes(staging).toLowerCase()}/`)
}

/**
 * Write pasted bytes and hand back the absolute path they landed at.
 *
 * The stem is a hint, not a promise — the Rust side owns collision handling,
 * because only the filesystem knows what is already taken.
 */
export async function writeImageBytes(
  dir: string,
  stemHint: string,
  extension: string,
  bytes: Uint8Array,
): Promise<string> {
  return invoke<string>('write_image_bytes', {
    dir,
    stem: stemHint,
    extension,
    // Tauri's IPC takes a number array; a Uint8Array serializes as an object.
    bytes: Array.from(bytes),
  })
}

export async function relocateImage(from: string, dir: string): Promise<string> {
  return invoke<string>('relocate_image', { from, dir })
}

/** Outside the desktop shell none of this exists, and callers should not have
    to branch on it at every site. */
export function canWriteImages(): boolean {
  return isTauri()
}
