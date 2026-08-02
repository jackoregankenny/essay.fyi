/**
 * Escaping that only escapes what would otherwise be read as syntax.
 *
 * Tiptap's Markdown serializer escapes text defensively and unconditionally:
 * every `&` becomes `&amp;`, every `<` and `>` become entities, and a
 * backslash goes in front of every ``\ ` * _ [ ] ~``. The output is always
 * *correct* — it re-reads as the same prose — but it is not the author's
 * bytes. A manuscript that mentions `data_source.md`, "Tom & Jerry" or a
 * footnote `[^1]` is rewritten on the first save and shows up as churn in the
 * diff of a document nobody edited. Invariant 2 forbids exactly that.
 *
 * So this narrows the escaping to characters that CommonMark would actually
 * re-read as syntax in the position they appear in, and leaves the rest alone.
 * Two classes of relaxation, treated differently because their risks differ:
 *
 *   Local — provable from the text node alone. An underscore between two
 *   alphanumerics can neither open nor close emphasis; an `&` that is not
 *   followed by an entity name is just an ampersand; a `<` not followed by a
 *   tag-ish character cannot open a tag or an autolink; a `>` that is not the
 *   first character of its node cannot start a block quote. Adjacent text
 *   nodes always have a mark delimiter between them, so none of these can be
 *   completed by a neighbour.
 *
 *   Contextual — `[`, `]` and `~`. These *can* be completed across a node
 *   boundary (`[a` in one node and `](b)` in the next is a link once the
 *   backslashes are gone). Each is checked against its own node first, and
 *   then the whole serialized document is re-read and compared — see
 *   {@link serializeBody}. If the gentler output would say something different,
 *   the save falls back to the stock, maximally-escaped form. The result is
 *   never worse than the status quo, and usually exact.
 *
 * The serializer has no public seam for this — text nodes are encoded by a
 * private method on `MarkdownManager`, not by a registered handler — so the
 * method is shadowed on the manager instance. If a future Tiptap renames it,
 * the patch quietly does nothing and the stock escaping returns; the golden
 * round-trip tests are what notice.
 */
import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** `&amp;`, `&#39;`, `&#x27;` — an `&` that begins one of these is an entity. */
const ENTITY_REFERENCE = /^&(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/

/** `<` followed by a name, `/`, `!` or `?` — a tag, a comment or an autolink. */
const TAG_OPENING = /^<[a-zA-Z!/?]/

const ALPHANUMERIC = /[0-9A-Za-z]/

/** The characters CommonMark lets a backslash escape. Nothing else. */
const ESCAPABLE = /[!-/:-@[-`{-~]/

/**
 * True when nothing in this text could combine into a link, an image or a
 * link reference definition, which is the only way brackets carry meaning.
 */
function bracketsAreInert(text: string): boolean {
  if (/\]\s*[([]/.test(text)) return false
  if (/^\s{0,3}\[[^\]]*\]:\s*\S+\s*$/.test(text)) return false
  return true
}

/**
 * A strikethrough delimiter is a run of one or two tildes followed by
 * something other than whitespace, so a lone tilde with a space after it
 * cannot open one. That is all this can prove from a single text node; the
 * document-level check catches the case where it closes a run opened
 * elsewhere.
 */
function tildeIsInert(text: string, index: number): boolean {
  const next = text[index + 1]
  if (text[index - 1] === '~') return false
  return next === undefined || /\s/.test(next)
}

function isIntraWord(text: string, index: number): boolean {
  return ALPHANUMERIC.test(text[index - 1] ?? '') && ALPHANUMERIC.test(text[index + 1] ?? '')
}

/**
 * True when the character has whitespace on both sides *inside this text
 * node*. An emphasis delimiter has to be left- or right-flanking, and a
 * character with whitespace either side is neither — so `_` and `*` in this
 * position are literal no matter what the neighbouring nodes contain.
 */
function isIsolated(text: string, index: number): boolean {
  const before = text[index - 1]
  const after = text[index + 1]
  return before !== undefined && after !== undefined && /\s/.test(before) && /\s/.test(after)
}

export interface EscapeResult {
  text: string
  /** Whether a relaxation was applied whose safety depends on neighbours. */
  contextual: boolean
}

/**
 * Escape a run of inline text for Markdown, escaping only what would be read
 * back as syntax. Never called for text inside code spans or code blocks —
 * see the guard in {@link installMinimalEscaping}.
 */
export function escapeInlineText(text: string): EscapeResult {
  const inertBrackets = bracketsAreInert(text)
  // A `<` that has to be encoded takes the matching `>` with it, so prose that
  // quotes a tag comes back as `&lt;div&gt;` rather than as a half-encoded pair.
  const encodesAngles = /<[a-zA-Z!/?]/.test(text)
  let out = ''
  let contextual = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (char === '\\') {
      // A backslash only escapes ASCII punctuation; before anything else it
      // is an ordinary character and doubling it is a rewrite.
      const next = text[i + 1]
      out += next !== undefined && !ESCAPABLE.test(next) ? '\\' : '\\\\'
    } else if (char === '`') {
      out += '\\`'
    } else if (char === '*') {
      out += isIsolated(text, i) ? '*' : '\\*'
    } else if (char === '&') {
      out += ENTITY_REFERENCE.test(text.slice(i)) ? '&amp;' : '&'
    } else if (char === '<') {
      out += TAG_OPENING.test(text.slice(i)) ? '&lt;' : '<'
    } else if (char === '>') {
      // Only a `>` at the very start of a node can land at the start of a
      // line, which is the only place it opens a block quote.
      out += i === 0 || encodesAngles ? '&gt;' : '>'
    } else if (char === '_') {
      out += isIntraWord(text, i) || isIsolated(text, i) ? '_' : '\\_'
    } else if (char === '[' || char === ']') {
      if (inertBrackets) {
        contextual = true
        out += char
      } else {
        out += `\\${char}`
      }
    } else if (char === '~') {
      if (tildeIsInert(text, i)) {
        contextual = true
        out += '~'
      } else {
        out += '\\~'
      }
    } else {
      out += char
    }
  }

  return { text: out, contextual }
}

declare module '@tiptap/core' {
  interface Storage {
    essayMinimalEscaping: EscapeStorage
  }
}

export interface EscapeStorage {
  /** Set while a fallback serialization runs, to get the stock escaping back. */
  strict: boolean
  /** Whether the serialization in progress leaned on a contextual relaxation. */
  contextual: boolean
  /** False when the manager could not be patched — the stock rules are in use. */
  installed: boolean
}

type TextEncoder = (text: string, node: JSONContent, parentNode?: JSONContent) => string

interface PatchableManager {
  encodeTextForMarkdown?: TextEncoder
  parse(markdown: string): JSONContent
}

/**
 * Shadow the manager's text encoder. The stock encoder is still called first,
 * for two reasons: it is the fallback, and — because it returns text
 * unchanged inside code spans and code blocks — `strict === text` is an exact
 * test for "this is a code context, leave it alone" that does not require
 * reaching for the manager's private list of code types.
 */
function installMinimalEscaping(manager: PatchableManager, storage: EscapeStorage): boolean {
  const inherited = manager.encodeTextForMarkdown
  if (typeof inherited !== 'function') return false

  const strictEncode = inherited.bind(manager)

  manager.encodeTextForMarkdown = (text, node, parentNode) => {
    const strict = strictEncode(text, node, parentNode)
    // Nothing was escaped: either a code context, or there was nothing here to
    // escape. Either way the relaxed form is the same string.
    if (strict === text || storage.strict) return strict

    const relaxed = escapeInlineText(text)
    if (relaxed.contextual && relaxed.text !== strict) storage.contextual = true
    return relaxed.text
  }

  return true
}

/** Read a Markdown string back into a document, or nothing if it will not. */
function reread(editor: Editor, markdown: string): ProseMirrorNode | undefined {
  const manager = editor.markdown as PatchableManager | undefined
  if (!manager) return undefined
  try {
    return editor.schema.nodeFromJSON(manager.parse(markdown))
  } catch {
    return undefined
  }
}

/**
 * Patch the manager the first time a manuscript is serialized.
 *
 * Deliberately lazy rather than done in a lifecycle hook: Tiptap emits
 * `create` on a timer, so an extension's `onCreate` has not run yet when a
 * host serializes immediately after constructing the editor — and a save that
 * silently used the stock escaping would be a rewrite the tests could not
 * reproduce. By the time anything asks for Markdown the manager exists, so
 * this is both the earliest reliable moment and the only one that matters.
 */
function ensureInstalled(editor: Editor): EscapeStorage | undefined {
  const storage = editor.storage.essayMinimalEscaping
  if (!storage || storage.installed) return storage

  const manager = editor.markdown as PatchableManager | undefined
  if (manager) storage.installed = installMinimalEscaping(manager, storage)
  return storage
}

/**
 * Serialize the manuscript body with minimal escaping, falling back to the
 * stock escaping if the gentler output would not read back the same.
 *
 * There are three answers to "did relaxing an escape change the meaning?", in
 * increasing cost, and the cheap ones cover the common documents:
 *
 *   Nothing contextual was relaxed. Nothing to check.
 *
 *   The output reads back as exactly the document that is open. This is the
 *   answer for any manuscript the round trip already preserves, and it costs
 *   one parse.
 *
 *   The output does not — but neither would the stock escaping, because the
 *   *document* contains something the serializer cannot reproduce (a raw HTML
 *   block, a reference link). Comparing the two serializations against each
 *   other instead of against the editor isolates the escaping from every other
 *   loss, so a file with unknown syntax in it still gets its prose written back
 *   faithfully. This costs a second serialization and a second parse, and only
 *   documents that are already lossy ever reach it.
 */
export function serializeBody(editor: Editor): string {
  const storage = ensureInstalled(editor)
  if (!storage?.installed) return editor.getMarkdown()

  storage.contextual = false
  const relaxed = editor.getMarkdown()
  if (!storage.contextual) return relaxed

  const reader = reread(editor, relaxed)
  if (reader?.eq(editor.state.doc)) return relaxed

  storage.strict = true
  let strict: string
  try {
    strict = editor.getMarkdown()
  } finally {
    storage.strict = false
  }

  const strictReader = reread(editor, strict)
  return reader && strictReader && reader.eq(strictReader) ? relaxed : strict
}

/**
 * Narrows the Markdown serializer's text escaping. Carries no schema and no
 * commands: it exists only to hold the state {@link serializeBody} needs, and
 * to mark a manuscript surface as one where minimal escaping applies.
 */
export const MinimalEscaping = Extension.create<Record<string, never>, EscapeStorage>({
  name: 'essayMinimalEscaping',

  addStorage() {
    return { strict: false, contextual: false, installed: false }
  },
})
