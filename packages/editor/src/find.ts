/**
 * In-manuscript find: pure TypeScript matching over the flattened buffer.
 *
 * Deliberately not a call into `essay-search` — this recomputes while the
 * author types, and typing never waits on IPC (invariant 5;
 * docs/authoring-backlog.md item 1.6). The price of a second matcher is
 * drift, so the semantics are transcribed from the crate rather than
 * approximated: the same one-to-one case fold, the same whole-word alphabet,
 * the same non-overlapping scan. If one changes, change the other.
 *
 * Offsets are UTF-16 code units into `manuscriptText`, and the fold is one
 * code point to one code point — `toLowerCase` on a whole string changes
 * length on `ß` and `İ` and would shift every offset after them, which is a
 * worse failure than missing a match nobody was searching for. Where a
 * lowercase mapping expands, the first code point stands in (as the crate's
 * `to_lowercase().next()` does); where even that would change UTF-16 length,
 * the original code point is kept so the folded string always aligns with
 * the real one.
 */
import type { Editor } from '@tiptap/core'
// prosemirror-history groups transactions arriving within its newGroupDelay
// into one undo event; a replacement folded into the keystrokes before it
// would make undo eat the author's typing along with the replace. closeHistory
// seals the running group so the replacement stands alone — which is also what
// makes "replace all is one undo step" a guarantee rather than a usually.
import { closeHistory } from '@tiptap/pm/history'

import { manuscriptText, positionAtOffset, type ManuscriptText } from './index'
import { setDecorationLayer } from './decorations'

export interface FindOptions {
  /** Off by default: a half-remembered sentence is not remembered in case. */
  caseSensitive?: boolean
  wholeWord?: boolean
}

export interface FindMatch {
  /** UTF-16 offset into the flattened text. */
  offset: number
  /** UTF-16 length of the match. */
  length: number
  /** ProseMirror range of the match. */
  from: number
  to: number
  /** The matched text as it appears in the manuscript. */
  text: string
  /**
   * Whether replacing `from..to` replaces exactly this text. False when the
   * match crosses a block boundary or a leaf node (a hard break): the range
   * is still findable and highlightable, but splicing it would also splice
   * document structure, and that operation has no defined semantics yet
   * (docs/authoring-backlog.md item 1.5).
   */
  replaceable: boolean
}

/** One code point, folded without ever changing UTF-16 length. */
function foldCodePoint(cp: string): string {
  const lower = cp.toLowerCase()
  if (lower === cp) return cp
  const first = lower.codePointAt(0)
  if (first === undefined) return cp
  const folded = String.fromCodePoint(first)
  return folded.length === cp.length ? folded : cp
}

/** The text folded for comparison, offset-for-offset aligned with the original. */
export function foldText(text: string): string {
  let out = ''
  for (const cp of text) out += foldCodePoint(cp)
  return out
}

/**
 * A word character, for whole-word search. Transcribed from the crate:
 * alphanumeric plus underscore, and the apostrophe counts as *inside* a word —
 * whole-word `can` must not match within `can't`.
 */
const WORD_CHAR = /[\p{Alphabetic}\p{Nd}\p{Nl}\p{No}_'\u{2019}]/u

function isWordChar(cp: string | undefined): boolean {
  return cp !== undefined && WORD_CHAR.test(cp)
}

/** The code point ending at `index`, surrogate pairs respected. */
function codePointBefore(text: string, index: number): string | undefined {
  if (index <= 0) return undefined
  const unit = text.charCodeAt(index - 1)
  if (unit >= 0xdc00 && unit <= 0xdfff && index >= 2) {
    const lead = text.charCodeAt(index - 2)
    if (lead >= 0xd800 && lead <= 0xdbff) return text.slice(index - 2, index)
  }
  return text[index - 1]
}

/** The code point starting at `index`, or undefined past the end. */
function codePointAfter(text: string, index: number): string | undefined {
  const cp = text.codePointAt(index)
  return cp === undefined ? undefined : String.fromCodePoint(cp)
}

/**
 * Every non-overlapping occurrence of `query` in `text`, as offsets.
 *
 * Unlike the crate this scans the whole flattened text rather than line by
 * line, so a query containing a newline *can* match across a hard break or a
 * block boundary — the backlog wants those findable (and marked
 * non-replaceable), where project search wants them gone.
 */
export function findInText(
  text: string,
  query: string,
  options: FindOptions = {},
): Array<{ offset: number; length: number }> {
  const found: Array<{ offset: number; length: number }> = []
  if (!query) return found
  const haystack = options.caseSensitive ? text : foldText(text)
  const needle = options.caseSensitive ? query : foldText(query)
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    // Word boundaries are judged against the original text, as the crate
    // judges the original line; the fold exists only for equality.
    const whole =
      !options.wholeWord ||
      (!isWordChar(codePointBefore(text, at)) &&
        !isWordChar(codePointAfter(text, at + needle.length)))
    if (whole) {
      found.push({ offset: at, length: needle.length })
      // Occurrences are reported once: "aa" in "aaa" is one match to a reader.
      at = haystack.indexOf(needle, at + needle.length)
    } else {
      at = haystack.indexOf(needle, at + 1)
    }
  }
  return found
}

/**
 * The position *after* the last character of a match.
 *
 * Not `positionAtOffset(end)`: an offset that falls on a line break resolves
 * forward to the start of the next block, which is right for a caret and
 * wrong for a range end — a `to` that crosses the block boundary would make
 * replacement merge two paragraphs. This resolves backward instead, to the
 * end of the last run the match actually touched.
 */
function positionAfter(flat: ManuscriptText, end: number): number {
  let pos = flat.runs[0]?.pos ?? 0
  for (const run of flat.runs) {
    if (run.offset >= end) break
    pos = run.pos + Math.min(end - run.offset, run.length)
  }
  return pos
}

/** Every match in the open manuscript, with ProseMirror ranges attached. */
export function findMatches(
  editor: Editor,
  query: string,
  options: FindOptions = {},
): FindMatch[] {
  const flat = manuscriptText(editor)
  const doc = editor.state.doc
  return findInText(flat.text, query, options).map(({ offset, length }) => {
    const text = flat.text.slice(offset, offset + length)
    const from = positionAtOffset(flat, offset)
    const to = positionAfter(flat, offset + length)
    // The honesty check: a range is replaceable only if what the document
    // holds between from and to is exactly what was matched. A match across
    // a hard break or two blocks fails this (textBetween drops the leaf /
    // boundary), and so would any future flattening drift — better a
    // disabled button than a replacement that eats a paragraph break.
    const replaceable = to > from && doc.textBetween(from, to) === text
    return { offset, length, from, to, text, replaceable }
  })
}

/** Why the state changed — what the host needs to decide whether to scroll. */
export type FindChangeCause = 'query' | 'navigate' | 'doc' | 'replace' | 'closed'

export interface FindState {
  query: string
  options: Required<FindOptions>
  matches: FindMatch[]
  /** Index into `matches`, or -1 when there are none. */
  activeIndex: number
  cause: FindChangeCause
}

/** How long after the last doc change matches are recomputed. Between the
    change and the recompute the decorations map through the transaction, so
    the highlights stay glued to their words; only the counts can lag. */
const RECOMPUTE_DELAY = 150

/**
 * The state a find session holds: query, options, matches, the active one.
 *
 * A class rather than a plugin because the substrate (decorations.ts) already
 * owns the editor-side lifecycle; this only decides what the layers contain.
 * Recomputes synchronously when the author changes the query — that is the
 * moment they are watching — and on a short debounce when the document
 * changes underneath the session.
 */
export class FindController {
  private editor: Editor
  private onChange: ((state: FindState) => void) | undefined
  private query = ''
  private caseSensitive = false
  private wholeWord = false
  private matches: FindMatch[] = []
  private activeIndex = -1
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly onUpdate = () => this.scheduleRecompute()

  constructor(editor: Editor, onChange?: (state: FindState) => void) {
    this.editor = editor
    this.onChange = onChange
    editor.on('update', this.onUpdate)
  }

  state(cause: FindChangeCause = 'doc'): FindState {
    return {
      query: this.query,
      options: { caseSensitive: this.caseSensitive, wholeWord: this.wholeWord },
      matches: this.matches,
      activeIndex: this.activeIndex,
      cause,
    }
  }

  activeMatch(): FindMatch | null {
    return this.matches[this.activeIndex] ?? null
  }

  setQuery(query: string): void {
    if (query === this.query) return
    this.query = query
    this.recompute('query')
  }

  setOptions(options: FindOptions): void {
    if (options.caseSensitive !== undefined) this.caseSensitive = options.caseSensitive
    if (options.wholeWord !== undefined) this.wholeWord = options.wholeWord
    this.recompute('query')
  }

  next(): void {
    this.step(1)
  }

  previous(): void {
    this.step(-1)
  }

  private step(delta: number): void {
    if (this.matches.length === 0) return
    this.activeIndex =
      (this.activeIndex + delta + this.matches.length) % this.matches.length
    this.paintActive()
    this.onChange?.(this.state('navigate'))
  }

  /**
   * Replace the active match. One transaction, `insertText` — the new text
   * takes whatever marks the position holds, no assumptions layered on top.
   * Returns false (and does nothing) when the active match is not
   * replaceable or has drifted since the last recompute.
   */
  replaceActive(replacement: string): boolean {
    const match = this.activeMatch()
    if (!match || !match.replaceable) return false
    // Re-verify against the live document: the debounce window means a match
    // can be stale for up to RECOMPUTE_DELAY, and replacing a range that no
    // longer holds the matched text would edit words the author can see are
    // not the match.
    if (this.editor.state.doc.textBetween(match.from, match.to) !== match.text) {
      return false
    }
    const keepFrom = match.from
    this.editor.view.dispatch(
      closeHistory(this.editor.state.tr).insertText(replacement, match.from, match.to),
    )
    this.recompute('replace', keepFrom)
    return true
  }

  /**
   * Replace every replaceable match in one transaction — one undo step.
   * Applied from the end of the document backward, so each splice leaves
   * every earlier match's positions untouched and no mapping is needed.
   * Returns how many were replaced; non-replaceable matches are skipped and
   * stay in the document.
   */
  replaceAll(replacement: string): number {
    let tr = closeHistory(this.editor.state.tr)
    let replaced = 0
    for (let i = this.matches.length - 1; i >= 0; i -= 1) {
      const match = this.matches[i]
      if (!match.replaceable) continue
      if (this.editor.state.doc.textBetween(match.from, match.to) !== match.text) {
        continue
      }
      tr = tr.insertText(replacement, match.from, match.to)
      replaced += 1
    }
    if (replaced > 0) {
      this.editor.view.dispatch(tr)
      this.recompute('replace')
    }
    return replaced
  }

  /** Recompute now instead of waiting out the debounce — for tests and for
      hosts that need fresh state before acting. */
  refresh(): void {
    this.recompute('doc')
  }

  /** Stop listening and take the highlights down. */
  destroy(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.editor.off('update', this.onUpdate)
    if (!this.editor.isDestroyed) {
      setDecorationLayer(this.editor, 'find', [])
      setDecorationLayer(this.editor, 'find-active', [])
    }
    this.onChange?.(this.state('closed'))
  }

  private scheduleRecompute(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    if (!this.query) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.recompute('doc')
    }, RECOMPUTE_DELAY)
  }

  private recompute(cause: FindChangeCause, keepFrom?: number): void {
    if (this.editor.isDestroyed) return
    // Where was the author's attention? A fresh query starts from the caret;
    // a doc change or replacement stays with the match they were on.
    const anchor =
      keepFrom ??
      (cause === 'query'
        ? this.editor.state.selection.from
        : (this.activeMatch()?.from ?? this.editor.state.selection.from))
    this.matches = this.query
      ? findMatches(this.editor, this.query, {
          caseSensitive: this.caseSensitive,
          wholeWord: this.wholeWord,
        })
      : []
    if (this.matches.length === 0) {
      this.activeIndex = -1
    } else {
      const at = this.matches.findIndex((match) => match.from >= anchor)
      this.activeIndex = at === -1 ? this.matches.length - 1 : at
    }
    this.paint()
    this.onChange?.(this.state(cause))
  }

  private paint(): void {
    setDecorationLayer(
      this.editor,
      'find',
      this.matches.map((match) => ({ from: match.from, to: match.to })),
    )
    this.paintActive()
  }

  private paintActive(): void {
    const active = this.activeMatch()
    setDecorationLayer(
      this.editor,
      'find-active',
      active ? [{ from: active.from, to: active.to }] : [],
    )
  }
}
