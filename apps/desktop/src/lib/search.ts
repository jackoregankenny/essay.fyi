// The shape of `essay-search`, and the one way the frontend asks for matches.
//
// Nothing here matches text — but the Rust engine is no longer the only place
// a match is decided. It answers the palette's project search and the CLI;
// the in-manuscript find bar matches the live buffer in TypeScript
// (@essay/editor's find.ts), because it recomputes while the author types and
// typing never waits on IPC (docs/authoring-backlog.md item 1.6). The find
// bar's case fold and whole-word alphabet are transcribed from the crate, and
// keeping the two in agreement is a standing discipline, not a mechanism.
//
// Every offset below is in UTF-16 code units, which is what JavaScript strings
// and ProseMirror positions are counted in. Nothing here needs to convert.

import { invoke, isTauri } from '@tauri-apps/api/core'

export interface SearchOptions {
  /** Off by default: a half-remembered sentence is not remembered in case. */
  caseSensitive?: boolean
  wholeWord?: boolean
  maxMatchesPerDocument?: number
  maxDocuments?: number
}

export interface SearchMatch {
  /** 1-based line in the text that was searched. */
  line: number
  /** Offset of the match within its line. */
  column: number
  /** Offset from the start of the text — what `positionAtOffset` maps. */
  offset: number
  length: number
  /** The sentence around the match, not the whole paragraph it sits in. */
  excerpt: string
  /** Where the match begins inside `excerpt`. */
  excerptStart: number
}

export interface TextMatches {
  matches: SearchMatch[]
  /** Occurrences found, which exceeds `matches.length` once the cap bites. */
  total: number
}

export interface DocumentMatches {
  path: string
  root: string
  relativePath: string
  /** The document's first heading — what a writer knows their work by. */
  title: string | null
  matches: SearchMatch[]
  total: number
}

export interface ProjectSearch {
  documents: DocumentMatches[]
  totalMatches: number
  documentsSearched: number
  truncated: boolean
}

/**
 * Find a phrase in the open manuscript. Resolves null outside the desktop
 * shell (the browser dev preview has no Rust to ask).
 */
export async function searchDocument(
  text: string,
  query: string,
  options: SearchOptions = {},
): Promise<TextMatches | null> {
  if (!isTauri()) return null
  return invoke<TextMatches>('search_document', { text, query, options })
}

/**
 * Find a phrase across the workspace folders. `skip` is the open document,
 * whose buffer the in-document results already cover more accurately than its
 * file does.
 */
export async function searchProject(
  roots: string[],
  query: string,
  options: SearchOptions = {},
  skip: string | null = null,
): Promise<ProjectSearch | null> {
  if (!isTauri()) return null
  return invoke<ProjectSearch>('search_project', { roots, query, options, skip })
}

/** What to call a document in a results list. */
export function documentLabel(document: DocumentMatches): string {
  return document.title ?? document.relativePath
}
