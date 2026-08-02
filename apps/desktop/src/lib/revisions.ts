// The shape of `essay-revisions`, and the one way the frontend asks about a
// document's history.
//
// Same discipline as `diff.ts`: nothing here reads or writes history. The
// SQLite sidecar beside the document is the only place a revision exists, so
// the timeline, the CLI and anything built later can never disagree about
// what happened to a manuscript.

import { invoke, isTauri } from '@tauri-apps/api/core'

/**
 * Where a revision came from. The two that matter to a reader are
 * `agentPatch` and `externalEdit` — "something other than me changed this" —
 * and `checkpoint` and `restore`, which are the two the author asked for.
 */
export type RevisionOrigin =
  | 'humanSession'
  | 'agentPatch'
  | 'externalEdit'
  | 'import'
  | 'checkpoint'
  | 'restore'

/** Local-first: there is no account to ask, so the name is whoever the OS
    says is at the keyboard, or the agent that wrote the patch. */
export type RevisionAuthor =
  | { kind: 'human'; name: string }
  | { kind: 'agent'; name: string }
  | { kind: 'unknown' }

export interface Revision {
  id: string
  parent: string | null
  /** Content hash of the full snapshot. The handle for reading it back. */
  sourceHash: string
  author: RevisionAuthor
  /** The prompt that produced an agent patch, when there was one. */
  instruction: string | null
  /** Milliseconds since the Unix epoch. */
  createdAt: number
  origin: RevisionOrigin
  wordsInserted: number
  wordsRemoved: number
}

/**
 * How much history the timeline asks for at once.
 *
 * A pane cannot show more than this without scrolling for a minute, and the
 * store thins ordinary typing older than ninety days to one revision a day —
 * so for most documents this is the whole history rather than a page of it.
 */
export const TIMELINE_LIMIT = 100

/**
 * The document's history, newest first. Resolves empty outside the desktop
 * shell, and for a document whose sidecar cannot be opened — a manuscript on
 * a read-only volume still opens and saves, it just has no history.
 */
export async function listRevisions(
  path: string | null,
  limit = TIMELINE_LIMIT,
): Promise<Revision[]> {
  if (!isTauri() || !path) return []
  try {
    return await invoke<Revision[]>('list_revisions', { path, limit })
  } catch {
    return []
  }
}

/** The full Markdown behind a revision, for diffing against the document now. */
export async function revisionSource(
  path: string,
  hash: string,
): Promise<string | null> {
  if (!isTauri()) return null
  return invoke<string | null>('revision_source', { path, hash })
}

export type RestoreOutcome =
  | { status: 'written'; hash: string }
  | { status: 'conflict'; diskHash: string; diskContents: string }

export interface Restored {
  outcome: RestoreOutcome
  /** The revision's text, so the editor can adopt it without a second read. */
  contents: string
}

/**
 * Put an earlier revision back.
 *
 * Guarded by `baseHash` like any other write, so a restore cannot quietly
 * overwrite an edit that arrived while the author was reading the timeline.
 * The version being replaced stays in the history, which is what makes this
 * an undo with a record rather than a rewind.
 */
export async function restoreRevision(
  path: string,
  hash: string,
  baseHash: string | null,
): Promise<Restored | null> {
  if (!isTauri()) return null
  return invoke<Restored>('restore_revision', { path, hash, baseHash })
}

/**
 * Mark the document as it stands as a state worth keeping.
 *
 * Records nothing to the file — a checkpoint is a claim about history, not
 * about the bytes, and autosave has almost certainly written them already.
 */
export async function checkpointDocument(
  path: string,
  contents: string,
): Promise<Revision | null> {
  if (!isTauri()) return null
  return invoke<Revision>('checkpoint_document', { path, contents })
}

const ORIGIN_LABEL: Record<RevisionOrigin, string> = {
  humanSession: 'Writing',
  agentPatch: 'Agent patch',
  externalEdit: 'Changed outside Essay',
  import: 'Opened',
  checkpoint: 'Marked',
  restore: 'Restored',
}

export function originLabel(origin: RevisionOrigin): string {
  return ORIGIN_LABEL[origin]
}

/**
 * Who to name on a row.
 *
 * `unknown` is not a gap in the record but a fact about it: the file changed
 * while Essay was not running, so there is genuinely nobody to name, and
 * saying so is better than guessing the author.
 */
export function authorLabel(author: RevisionAuthor): string {
  return author.kind === 'unknown' ? 'Unknown' : author.name
}

/**
 * Timeline stamps, in the form a person reads them: a clock time today, a
 * weekday this week, a date beyond that. Absolute rather than "3 hours ago",
 * because a revision list is scanned for *when* something happened and
 * relative stamps stop being comparable past a day or two.
 */
export function revisionTime(at: number): string {
  const date = new Date(at)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
  }
  const days = (now.getTime() - date.getTime()) / 86_400_000
  if (days < 7) {
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
