/**
 * Inline raw HTML that comes back written the way it went in.
 *
 * The block case is `markdown-html.ts`; this is the other half, and it was
 * left undone there because the obstacle looked structural. `@tiptap/markdown`
 * handles inline `html` tokens itself, inside `parseInlineTokens`, *before* it
 * asks any extension: it pairs an opening tag with its closing tag, hands the
 * span to `generateJSON`, and keeps whatever ProseMirror recognises. For
 * `<em>` that is an italic mark; for `<abbr title="…">` it is the word and
 * nothing else. `markdownTokenName` cannot reach that branch, because the
 * branch tests `token.type === 'html'` directly.
 *
 * The way past it is to make sure marked never emits an inline `html` token in
 * the first place. marked tries `options.extensions.inline` at the top of its
 * inline loop, ahead of every built-in tokenizer, and a `markdownTokenizer` on
 * a Tiptap extension is registered as exactly such an extension. So this claims
 * the tag itself and emits a token under its own name, which lands in the
 * ordinary handler branch further down and arrives at `parseMarkdown` here.
 *
 * {@link INLINE_TAG} is deliberately marked's own inline `tag` rule, transcribed
 * rather than reworded. That is the property which makes this a redirection and
 * not a second, competing HTML parser: the byte ranges claimed are exactly the
 * ones that would have become `html` tokens, so nothing else in the inline
 * grammar moves. `5 < 6` is still prose, `<https://example.com>` is still an
 * autolink, `\<div>` is still an escape — marked would not have called any of
 * them a tag either. Only one built-in tokenizer runs ahead of an extension at
 * all (`escape`), and it needs a leading backslash where this needs a `<`.
 *
 * **A mark on the tag's own text, not a node.** Three things follow from that
 * choice and all three are the reason for it:
 *
 *   Each tag stands alone. A file may hold a `<span>` whose `</span>` is three
 *   paragraphs away, or nowhere — half-finished markup has to survive a save as
 *   readily as a matched pair, and only an unpaired representation promises
 *   that. Text between two tags is ordinary editable prose because it is
 *   ordinary text.
 *
 *   Marks around it stay whole. `[link <kbd>Ctrl</kbd> here](url)` is one link
 *   in the file and must still be one link after a save. An inline *node* would
 *   have forced the serializer to close the link mark before the tag and reopen
 *   it after, writing three links where the author had one — a worse rewrite
 *   than the one being fixed. Marks nest; nodes interrupt.
 *
 *   `code: true` is what keeps the angle brackets. It puts this mark in the
 *   serializer's set of code contexts, where text is written out verbatim
 *   instead of being escaped — the same mechanism that stops `<` inside a code
 *   span becoming `&lt;`. The mark itself renders no delimiters of its own
 *   (`renderMarkdown` returns only its children), so the tag is written as the
 *   text it is.
 *
 * What this costs, stated plainly. Inline HTML that Tiptap *could* have
 * understood no longer becomes formatting: `<em>word</em>` used to arrive as an
 * italic mark and be written back as `*word*`, and now arrives as literal
 * source written back unchanged. That is one rewrite fewer, which is the trade
 * invariant 2 asks for, but a document that leans on HTML for emphasis reads as
 * source in the manuscript. And because the tag is real text, an author can put
 * the caret inside it and break it — the mark is `inclusive: false` so typing
 * at either edge lands outside, but nothing defends the middle. It is the same
 * bargain the raw HTML block makes, for the same reason: markup you can see and
 * repair beats markup held somewhere you cannot reach.
 */
import { Mark, type JSONContent, type MarkdownRendererHelpers } from '@tiptap/core'

/**
 * marked's inline attribute rule, so an attribute list is claimed whole.
 *
 * The backtick is spliced in rather than written: a raw one cannot appear
 * inside a `String.raw` template, and escaping it would leave a backslash in
 * the pattern that upstream does not have — which the fidelity test in
 * `roundtrip.test.ts` compares character for character and would fail on.
 */
const ATTRIBUTE =
  String.raw`\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>` +
  '`' +
  String.raw`]+)?`

/**
 * marked's inline `tag` rule: a comment, a closing tag, an opening or
 * self-closing tag, a processing instruction, a declaration, or CDATA.
 *
 * Transcribed alternative for alternative from `Lexer.rules.inline.normal.tag`,
 * including the parts that look like mistakes — the lazy attribute repetition,
 * and a comment rule that admits both `<!-->` and a `--` in the middle of a
 * comment. Being *faithful* is the point, not being right: a stricter rule here
 * would decline a tag marked still recognises, and the token would fall through
 * to the library's inline HTML path and lose its markup exactly as before. If
 * this ever drifts from upstream the round-trip suite is what notices, because
 * every case it covers would quietly revert to being unwrapped.
 */
export const INLINE_TAG = new RegExp(
  '^(?:' +
    // <!-- comment -->
    String.raw`<!--(?:-?>|[\s\S]*?-->)` +
    // </closing>
    String.raw`|<\/[a-zA-Z][\w:-]*\s*>` +
    // <opening attr="value"> and <self-closing/>
    `|<[a-zA-Z][\\w-]*(?:${ATTRIBUTE})*?\\s*\\/?>` +
    // <?processing instruction?>
    String.raw`|<\?[\s\S]*?\?>` +
    // <!DECLARATION …>
    String.raw`|<![a-zA-Z]+\s[\s\S]*?>` +
    // <![CDATA[…]]>
    String.raw`|<!\[CDATA\[[\s\S]*?\]\]>` +
    ')',
)

export const ManuscriptHtmlInline = Mark.create({
  name: 'htmlInline',

  /** Text under this mark is written back verbatim rather than escaped. */
  code: true,

  /** Typing at either edge of a tag writes prose, not more markup. */
  inclusive: false,

  // Registered ahead of anything else that might want to tokenize a `<`.
  priority: 1000,

  /**
   * Claims the tag before marked's own `tag` tokenizer can make an `html`
   * token of it. This is the whole mechanism.
   */
  markdownTokenizer: {
    name: 'htmlInline',
    level: 'inline',
    // marked uses this only to stop a run of plain text short of the tag. Its
    // `text` rule already breaks on `<`, so this is belt and braces — but the
    // alternative is the library's fallback `start`, which tokenizes
    // speculatively at every offset of every paragraph.
    start: (src: string) => src.indexOf('<'),
    tokenize: (src: string) => {
      const match = INLINE_TAG.exec(src)
      if (!match) return undefined
      return { type: 'htmlInline', raw: match[0], text: match[0] }
    },
  },

  parseMarkdown(token, helpers) {
    const source = typeof token.raw === 'string' ? token.raw : String(token.text ?? '')
    if (!source) return []
    return helpers.applyMark('htmlInline', [helpers.createTextNode(source)])
  },

  renderMarkdown(node: JSONContent, h: MarkdownRendererHelpers) {
    // No delimiters of its own: the mark exists to say "this text is markup",
    // and the markup is already the text.
    return node.content ? h.renderChildren(node.content) : ''
  },

  parseHTML() {
    return [{ tag: 'span[data-essay-html-inline]' }]
  },

  renderHTML() {
    // Shown as the source it is, the way the block node shows its own.
    return ['span', { 'data-essay-html-inline': '', class: 'essay-raw-html-inline' }, 0]
  },
})
