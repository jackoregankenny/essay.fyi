// The shape of `essay-diff`, and the one way the frontend asks for a diff.
//
// Nothing here computes a difference. The Rust engine is the only place a
// diff exists, so the review panel, the CLI and any future agent surface can
// never disagree about what changed — the same discipline that makes the
// file, not editor state, canonical.

import { invoke, isTauri } from '@tauri-apps/api/core'

export type LineTag = 'context' | 'insert' | 'delete'

export interface DiffLine {
  tag: LineTag
  /** 1-based line number in the old document, when the line exists there. */
  oldLine: number | null
  newLine: number | null
  text: string
}

/** A run of changed lines with surrounding context — one block in the review
    surface. */
export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export type SectionStatus =
  | 'unchanged'
  | 'edited'
  | 'moved'
  | 'movedAndEdited'
  | 'added'
  | 'removed'

export interface DiffStats {
  wordsInserted: number
  wordsRemoved: number
}

export interface SectionChange {
  /** Heading text; null for content before the first heading. */
  heading: string | null
  /** 1–6, or 0 for the preamble. */
  depth: number
  status: SectionStatus
  /** Position among sections, 0-based. null when the section is not there. */
  oldIndex: number | null
  newIndex: number | null
  stats: DiffStats
}

export interface DocumentDiff {
  hunks: Hunk[]
  sections: SectionChange[]
  stats: DiffStats
  linesInserted: number
  linesRemoved: number
  /** Touched sections over total sections, 0–1. */
  churn: number
}

/** Two thirds of a document changing at once is the point where "edited"
    stops being a fair description of what happened. Mirrors
    `essay_diff::REWRITE_CHURN`. */
export const REWRITE_CHURN = 0.66

/**
 * Compare two versions of the manuscript. Resolves null outside the desktop
 * shell (the browser dev preview has no Rust to ask).
 */
export async function diffDocuments(
  old: string,
  updated: string,
): Promise<DocumentDiff | null> {
  if (!isTauri()) return null
  return invoke<DocumentDiff>('diff_documents', { old, new: updated })
}

export function isChanged(section: SectionChange): boolean {
  return section.status !== 'unchanged'
}

export function hasMoved(section: SectionChange): boolean {
  return section.status === 'moved' || section.status === 'movedAndEdited'
}

export function changedSections(diff: DocumentDiff): SectionChange[] {
  return diff.sections.filter(isChanged)
}

/**
 * Whether this reads as a wholesale regeneration rather than an edit.
 * A heuristic, and deliberately generous: it labels a change, never rejects
 * one. Mirrors `DocumentDiff::looks_like_a_rewrite`.
 */
export function looksLikeARewrite(diff: DocumentDiff): boolean {
  return diff.churn >= REWRITE_CHURN && diff.sections.length >= 3
}

/**
 * A pure reordering still shows words on both sides of the *line* diff.
 * Reporting "+23/−23 words" about it would be true and misleading, so the
 * summary asks this question first.
 */
export function isPureReordering(diff: DocumentDiff): boolean {
  const changed = changedSections(diff)
  return changed.length > 0 && changed.every(hasMoved)
}
