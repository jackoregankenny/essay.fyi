// Comment threads on a passage of the manuscript, and the anchors that keep
// them attached — the frontend's half of `essay-context`.
//
// Nothing here decides where a comment belongs. Placement is computed in
// Rust, where it is tested, against three coordinates this module ships over:
// the flattened live buffer (`manuscriptText()`), its section spans, and the
// content hash of the source the buffer was loaded from. Every offset is in
// UTF-16 code units — what JavaScript strings and ProseMirror positions
// already count in, so nothing here converts.
//
// Comments live in `.essay/context.sqlite` beside the document. Deleting the
// sidecar deletes them and never touches a manuscript byte; no ID is ever
// written into the Markdown.

import { invoke, isTauri } from '@tauri-apps/api/core'

/** A heading as an anchor names it. `ordinal` is the zero-based occurrence
 *  among headings sharing this text and depth — what tells two `## Methods`
 *  sections apart. */
export interface SectionRef {
  text: string
  /** 1–6. */
  depth: number
  ordinal: number
}

/** A section as it exists in the buffer on screen: the ref plus the UTF-16
 *  range it occupies in the flattened text (heading included, running to the
 *  next heading of any depth or the end of the document). */
export interface SectionSpan extends SectionRef {
  from: number
  to: number
}

export type ThreadState = 'open' | 'resolved'
export type ActorKind = 'human' | 'agent'

export interface CommentThread {
  id: string
  documentId: string
  anchorId: string
  state: ThreadState
  createdAt: number
  updatedAt: number
  resolvedAt: number | null
  deletedAt: number | null
  version: number
}

export interface CommentEntry {
  id: string
  threadId: string
  actorKind: ActorKind
  actorId: string | null
  body: string
  createdAt: number
  editedAt: number | null
  deletedAt: number | null
  version: number
}

/** Everything recorded about where a comment belongs: exact positions (valid
 *  only against `createdHash`), the quote with ~a line of context either
 *  side, and the section corridor the selection started and ended in. */
export interface CommentAnchor {
  id: string
  documentId: string
  /** The content hash the stored positions are valid against. */
  createdHash: string
  pmFrom: number
  pmTo: number
  selectedText: string
  contextBefore: string
  contextAfter: string
  startSection: SectionRef | null
  endSection: SectionRef | null
  /** Byte range into the source, once a later source-index phase records one. */
  sourceFrom: number | null
  sourceTo: number | null
  confidence: number
  /** Set when this anchor was superseded by a manual reattachment. */
  detachedAt: number | null
  version: number
}

/** What the composer supplies when a comment is created or reattached. */
export interface NewAnchor {
  pmFrom: number
  pmTo: number
  selectedText: string
  contextBefore: string
  contextAfter: string
  startSection?: SectionRef | null
  endSection?: SectionRef | null
}

/**
 * Where an anchor lands in the current buffer, or the honest admission that
 * it does not. `exact` positions are ProseMirror positions to use as they
 * are; `relocated` offsets are UTF-16 into the flattened text — map them
 * with `positionAtOffset`. `unplaced` is a visible state, never a guess:
 * a plausible but wrong attachment is data corruption.
 */
export type Placement =
  | { kind: 'exact'; pmFrom: number; pmTo: number }
  | { kind: 'relocated'; offsetFrom: number; offsetTo: number; confidence: number }
  | { kind: 'unplaced' }

/** One thread with everything a review surface needs. */
export interface PlacedThread {
  thread: CommentThread
  entries: CommentEntry[]
  anchor: CommentAnchor
  placement: Placement
}

/** One anchor's post-save correction, sent in bulk by `refreshCommentAnchors`. */
export interface AnchorUpdate extends NewAnchor {
  threadId: string
}

/**
 * Every live comment thread for the document, resolved ones included —
 * hiding those is the surface's choice. Each anchor arrives placed against
 * the buffer described by `text`/`sections`/`hash`. Resolves [] outside the
 * desktop shell.
 */
export async function listComments(
  path: string,
  text: string,
  hash: string,
  sections: SectionSpan[],
): Promise<PlacedThread[]> {
  if (!isTauri()) return []
  return invoke<PlacedThread[]>('list_comments', { path, text, hash, sections })
}

/**
 * Start a thread on the current selection. `hash` must be the content hash
 * of the saved source the anchor's positions were measured against — it is
 * what makes them trustworthy later.
 */
export async function createComment(
  path: string,
  hash: string,
  body: string,
  anchor: NewAnchor,
): Promise<PlacedThread | null> {
  if (!isTauri()) return null
  return invoke<PlacedThread>('create_comment', { path, hash, body, anchor })
}

export async function replyComment(
  path: string,
  threadId: string,
  body: string,
): Promise<CommentEntry | null> {
  if (!isTauri()) return null
  return invoke<CommentEntry>('reply_comment', { path, threadId, body })
}

/** Resolving changes no manuscript bytes; the thread stays in history. */
export async function resolveComment(
  path: string,
  threadId: string,
): Promise<CommentThread | null> {
  if (!isTauri()) return null
  return invoke<CommentThread>('resolve_comment', { path, threadId })
}

export async function reopenComment(
  path: string,
  threadId: string,
): Promise<CommentThread | null> {
  if (!isTauri()) return null
  return invoke<CommentThread>('reopen_comment', { path, threadId })
}

/** Tombstones the thread — it leaves every listing, the record survives. */
export async function deleteComment(
  path: string,
  threadId: string,
): Promise<CommentThread | null> {
  if (!isTauri()) return null
  return invoke<CommentThread>('delete_comment', { path, threadId })
}

/**
 * The author's answer to an unplaced comment: point the thread at a new
 * selection. The superseded anchor is kept, detached, as history.
 */
export async function reattachComment(
  path: string,
  threadId: string,
  hash: string,
  anchor: NewAnchor,
): Promise<PlacedThread | null> {
  if (!isTauri()) return null
  return invoke<PlacedThread>('reattach_comment', { path, threadId, hash, anchor })
}

/**
 * After a successful save: hand every *placed* thread's current range back
 * so anchors track the state that just reached disk and exact placement
 * stays exact. Never call this for unplaced threads — refreshing an anchor
 * the editor could not place would overwrite the evidence a manual
 * reattachment needs. Returns how many anchors moved.
 */
export async function refreshCommentAnchors(
  path: string,
  hash: string,
  updates: AnchorUpdate[],
): Promise<number> {
  if (!isTauri() || updates.length === 0) return 0
  return invoke<number>('refresh_comment_anchors', { path, hash, updates })
}
