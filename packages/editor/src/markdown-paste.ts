/**
 * Pasted Markdown becomes the document it describes.
 *
 * `@tiptap/markdown` parses and serializes, but it does not touch the
 * clipboard — so without this, pasting a draft out of ChatGPT, a terminal, or
 * another Markdown editor lands `## Heading` as the literal five characters.
 * In an editor whose canonical file *is* Markdown, that is the wrong default:
 * the author pasted a document, not a transcript of one.
 *
 * Three rules decide, in order:
 *
 * 1. **A code context always wins.** Inside a fenced block or an HTML block —
 *    any node whose spec says `code` — the clipboard is source and stays
 *    verbatim. This is also the escape hatch that needs no shortcut.
 * 2. **A real HTML flavour wins.** When the clipboard carries `text/html` the
 *    author copied rendered content, and ProseMirror's own parser reads it
 *    better than re-deriving structure from the plain-text fallback.
 * 3. **Otherwise, parse when it looks like Markdown.** Not "always parse":
 *    `2 * 3 * 4` and `a_b_c` are ordinary prose, and silently italicising
 *    them would be exactly the gratuitous rewrite invariant 2 forbids. The
 *    test therefore wants *structure* — a heading, list, fence, quote, table,
 *    rule — or a well-formed inline construct, not a stray asterisk.
 *
 * `Mod-Shift-V` overrides all of it and pastes the plain text literally.
 */
import { Extension } from '@tiptap/core'
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state'

/** Line-anchored structure. Any one of these means the author pasted a
    document rather than a sentence that happens to contain punctuation. */
const BLOCK_SIGNALS: RegExp[] = [
  /^ {0,3}#{1,6}[ \t]\S/m, // # Heading — the hash must lead a word, not a tag
  /^ {0,3}[-*+][ \t]\S/m, // - bullet
  /^ {0,3}\d{1,9}[.)][ \t]\S/m, // 1. ordered
  /^ {0,3}>[ \t]?\S/m, // > quote
  /^ {0,3}(?:```|~~~)/m, // fence
  /^ {0,3}\|.*\|[ \t]*$/m, // | table | row |
  /^ {0,3}(?:-[ \t]*){3,}$|^ {0,3}(?:\*[ \t]*){3,}$|^ {0,3}(?:_[ \t]*){3,}$/m, // --- rule
]

/** Well-formed inline constructs. Paired and non-empty on purpose: `**bold**`
    is a decision, a lone `*` is a typo or a multiplication sign. */
const INLINE_SIGNALS: RegExp[] = [
  /!?\[[^\]\n]*\]\([^)\s]+(?:[ \t]+"[^"]*")?\)/, // [text](url) and images
  /`[^`\n]+`/, // `code`
  /\*\*[^\s*][^*]*\*\*/, // **bold**
  /~~[^\s~][^~]*~~/, // ~~strike~~
]

/**
 * Does this text want to be read as Markdown?
 *
 * Exported for the tests, which are the honest specification of where the
 * line sits — see `test/paste.test.ts`.
 */
export function looksLikeMarkdown(text: string): boolean {
  // A fence or table can legitimately be the whole paste, so there is no
  // minimum length; but a single line with no signal is just a word.
  if (!text.trim()) return false
  return (
    BLOCK_SIGNALS.some((signal) => signal.test(text)) ||
    INLINE_SIGNALS.some((signal) => signal.test(text))
  )
}

/** True inside a fenced code block, an HTML block, or any other node whose
    schema declares its content to be code. */
function inCodeContext(state: EditorState): boolean {
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.spec.code) return true
  }
  return false
}

/**
 * Does the clipboard carry markup worth preferring over the plain-text copy?
 *
 * A bare `<meta charset>` wrapper is what several apps emit around what is
 * really plain text, so it does not count; anything with an actual element in
 * it does.
 */
function hasRealHtml(html: string | undefined): boolean {
  if (!html) return false
  const stripped = html
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?html[^>]*>|<\/?head[^>]*>|<\/?body[^>]*>/gi, '')
    .trim()
  return /<[a-z][^>]*>/i.test(stripped)
}

export const MarkdownPaste = Extension.create({
  name: 'essayMarkdownPaste',

  // Below ManuscriptTableEditing (110): a tab-separated blob pasted into a
  // table is a grid first and Markdown never.
  priority: 100,

  addKeyboardShortcuts() {
    return {
      // Arms the next paste to be taken literally. The keystroke cannot carry
      // the clipboard itself — the browser fires `paste` separately — so it
      // sets a flag the plugin reads and clears.
      'Mod-Shift-v': () => {
        literalPasteArmedAt = Date.now()
        return false
      },
    }
  },

  addProseMirrorPlugins() {
    const { editor } = this
    return [
      new Plugin({
        key: new PluginKey('essayMarkdownPaste'),
        props: {
          handlePaste: (view, event) => {
            if (Date.now() - literalPasteArmedAt < LITERAL_PASTE_WINDOW_MS) {
              literalPasteArmedAt = 0
              return false
            }

            const text = event.clipboardData?.getData('text/plain')
            if (!text) return false
            if (hasRealHtml(event.clipboardData?.getData('text/html'))) return false
            if (inCodeContext(view.state)) return false

            // Normalised because this is clipboard text, not file bytes: the
            // serializer decides the document's line endings from the file it
            // loaded, and a pasted CRLF has no vote.
            const markdown = text.replace(/\r\n?/g, '\n')
            if (!looksLikeMarkdown(markdown)) return false

            return editor.commands.insertContent(markdown, {
              contentType: 'markdown',
            })
          },
        },
      }),
    ]
  },
})

/** Module-scoped rather than plugin state: the shortcut and the paste event
    are two separate trips through ProseMirror, and the arming has to outlive
    the first.

    A timestamp rather than a boolean because a keystroke does not guarantee a
    paste — an empty clipboard fires nothing — and a flag left standing would
    quietly take the *next* paste literally, hours later. This expires. */
const LITERAL_PASTE_WINDOW_MS = 1000
let literalPasteArmedAt = 0
