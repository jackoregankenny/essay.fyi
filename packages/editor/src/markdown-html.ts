/**
 * Raw HTML blocks that come back written the way they went in.
 *
 * This was the most serious loss in the round trip, and it was structural
 * rather than a serializer bug: the schema had no node for raw HTML at all,
 * so the parser kept whatever it happened to recognise *inside* the block and
 * threw the rest away. A `<div class="callout">` wrapping a bold sentence
 * came back as the bold sentence and nothing else — the wrapper, the class
 * and every other attribute simply gone. An HTML comment came back as
 * nothing whatsoever.
 *
 * That is the one failure invariant 2 cannot tolerate. A construct the editor
 * does not understand may be shown plainly, may be awkward to edit, may not
 * typeset — but it must still be in the file afterwards.
 *
 * So raw HTML becomes a node that holds its own source verbatim and writes it
 * back byte for byte. It is a code block in every respect except the fence:
 * `code: true` keeps the serializer's escaping away from the contents, and
 * the author can edit the markup directly because it is real text rather than
 * an opaque attribute.
 *
 * **Inline HTML is a different problem, solved differently — see
 * `markdown-html-inline.ts`.** The obstacle there is real: `@tiptap/markdown`
 * intercepts inline `html` tokens before any extension is consulted, pairing
 * opening and closing tags and turning what it recognises into marks, and no
 * `markdownTokenName` reaches that branch. The answer was not to add a node
 * but to stop marked emitting an inline `html` token at all, with a custom
 * tokenizer. Nothing about the block path changes; the two are independent,
 * and marked decides between them by whether the tag stands on its own line.
 */
import { Node, type JSONContent, type MarkdownRendererHelpers } from '@tiptap/core'

/**
 * Trailing newlines belong to the block separator, not to the block.
 *
 * marked hands over a raw token that runs to the end of the line *and* the
 * blank line after it. The renderer puts the blank line back when it joins
 * blocks, so keeping it here would grow a newline on every save — the exact
 * drift the round-trip suite tests for separately from fidelity.
 */
function withoutTrailingNewlines(source: string): string {
  return source.replace(/\n+$/, '')
}

export const ManuscriptHtmlBlock = Node.create({
  name: 'htmlBlock',

  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,

  // Ahead of anything the library would otherwise do with a block-level
  // `html` token, which is to unwrap it.
  priority: 1000,

  /** Registers this node against marked's `html` token rather than a token
      named after the node, which is what routes raw HTML here at all. */
  markdownTokenName: 'html',

  parseHTML() {
    return [{ tag: 'pre[data-essay-html]', preserveWhitespace: 'full' as const }]
  },

  renderHTML() {
    // Shown as what it is: source the editor is keeping rather than
    // rendering. Styled in prose.css beside the code block it resembles.
    return ['pre', { 'data-essay-html': '', class: 'essay-raw-html' }, ['code', {}, 0]]
  },

  parseMarkdown(token, helpers) {
    const source = withoutTrailingNewlines(
      typeof token.raw === 'string' ? token.raw : String(token.text ?? ''),
    )
    if (!source) return []
    return helpers.createNode('htmlBlock', {}, [helpers.createTextNode(source)])
  },

  renderMarkdown(node: JSONContent, h: MarkdownRendererHelpers) {
    return node.content ? h.renderChildren(node.content) : ''
  },
})
