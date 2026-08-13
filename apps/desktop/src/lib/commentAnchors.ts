// The editor's coordinates restated as essay-context's — the one place a
// selection becomes an anchor. Everything is UTF-16 over the flattened
// buffer (`manuscriptText`), the same space the Rust reconciler searches, so
// the quote recorded here is byte-for-byte the quote that will be looked for
// after the document changes.

import {
  manuscriptSections,
  manuscriptText,
  offsetAtPosition,
  type Editor,
  type ManuscriptText,
} from '@essay/editor'
import type { NewAnchor, SectionRef, SectionSpan } from './comments'

/** Matches CONTEXT_WINDOW in crates/essay-context/src/reconcile.rs — the
    reconciler trims to this; recording more would only be discarded. */
const CONTEXT_WINDOW = 32

/** The section list `listComments` wants: flattened UTF-16 spans, duplicate
    headings told apart by ordinal. */
export function sectionSpans(
  editor: Editor,
  text: ManuscriptText = manuscriptText(editor),
): SectionSpan[] {
  return manuscriptSections(editor, text).map((section) => ({
    text: section.text,
    depth: section.level,
    ordinal: section.ordinal,
    from: section.from,
    to: section.to,
  }))
}

/** The section a flattened offset falls in, as a bare ref — null in the
    preamble or a heading-less document, and that absence is recorded. */
function refAt(spans: SectionSpan[], offset: number): SectionRef | null {
  for (const span of spans) {
    if (offset >= span.from && offset < span.to) {
      return { text: span.text, depth: span.depth, ordinal: span.ordinal }
    }
  }
  return null
}

/** The pure half of `buildAnchor`, for callers that already flattened once
    (the post-save refresh rebuilds every placed anchor against one text). */
export function buildAnchorFrom(
  text: ManuscriptText,
  spans: SectionSpan[],
  from: number,
  to: number,
): NewAnchor {
  const fromOffset = offsetAtPosition(text, from)
  const toOffset = Math.max(fromOffset, offsetAtPosition(text, to))
  return {
    pmFrom: from,
    pmTo: to,
    selectedText: text.text.slice(fromOffset, toOffset),
    contextBefore: text.text.slice(
      Math.max(0, fromOffset - CONTEXT_WINDOW),
      fromOffset,
    ),
    contextAfter: text.text.slice(
      toOffset,
      Math.min(text.text.length, toOffset + CONTEXT_WINDOW),
    ),
    startSection: refAt(spans, fromOffset),
    // The selection's last character, not its exclusive end: a selection
    // running exactly to a section boundary ends in the section it is in.
    endSection: refAt(spans, Math.max(fromOffset, toOffset - 1)),
  }
}

/** Everything the store needs to find this selection again: positions for
    now, quote + context + section corridor for after the document changes. */
export function buildAnchor(editor: Editor, from: number, to: number): NewAnchor {
  const text = manuscriptText(editor)
  return buildAnchorFrom(text, sectionSpans(editor, text), from, to)
}

/** The selected passage as the author sees it — the flattened slice, which
    is what the anchor records, not `textBetween` with invented separators. */
export function selectionQuote(editor: Editor, from: number, to: number): string {
  const text = manuscriptText(editor)
  const fromOffset = offsetAtPosition(text, from)
  return text.text.slice(fromOffset, Math.max(fromOffset, offsetAtPosition(text, to)))
}

/** Middle truncation for quotes: the start says where it begins, the end
    says where it stops — both matter for "we say X here… through there". */
export function truncateMiddle(quote: string, max = 96): string {
  const flat = quote.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const head = Math.ceil((max - 2) * 0.6)
  const tail = max - 2 - head
  return `${flat.slice(0, head).trimEnd()} … ${flat.slice(flat.length - tail).trimStart()}`
}
