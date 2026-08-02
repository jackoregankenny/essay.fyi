/**
 * Code blocks that come back written the way they went in.
 *
 * The stock serializer always emits exactly three backticks and never emits an
 * indented block, which loses two things and corrupts a third:
 *
 *   - a `~~~` fence comes back as ```` ``` ````;
 *   - a four-space indented block comes back fenced;
 *   - and a block written with four backticks *because it contains a
 *     three-backtick fence* comes back with three, so the inner fence now
 *     closes it. On the next save the escaped fragments are re-fenced again
 *     and the block grows another pair of delimiters every time it is saved.
 *
 * The last one is the reason this file exists. The fence the author used is
 * recorded on the node, and the fence that is written is the longer of that
 * and one more than the longest delimiter run inside the block — so a block
 * whose content grows a fence still closes where it should.
 */
import type { JSONContent, MarkdownRendererHelpers } from '@tiptap/core'
import { CodeBlock } from '@tiptap/extension-code-block'

import { sourceAttribute } from './markdown-lists'

/** The opening delimiter of a fenced block, or the indented-block marker. */
export type Fence = string

/** Four spaces, no fence, no language — the other way to write a code block. */
const INDENTED = 'indented'

const OPENING_FENCE = /^[ \t]*(`{3,}|~{3,})/

/** The longest run of `char` anywhere in the text. */
function longestRun(text: string, char: string): number {
  let longest = 0
  let current = 0
  for (const candidate of text) {
    current = candidate === char ? current + 1 : 0
    if (current > longest) longest = current
  }
  return longest
}

export function readFence(raw: string, indented: boolean): Fence {
  if (indented) return INDENTED
  return raw.match(OPENING_FENCE)?.[1] ?? '```'
}

/**
 * Write a code block using the author's fence, widened if the content now
 * needs it. An indented block stays indented — but only when it has no
 * language, since there is nowhere to put one.
 */
export function renderCodeBlock(node: JSONContent, h: MarkdownRendererHelpers): string {
  const content = node.content ? h.renderChildren(node.content) : ''
  const language = (node.attrs?.language as string | null) ?? ''
  const fence = (node.attrs?.fence as Fence | undefined) ?? '```'

  if (fence === INDENTED && !language) {
    return content
      .split('\n')
      .map(line => (line ? `    ${line}` : line))
      .join('\n')
  }

  const char = fence === INDENTED ? '`' : fence[0]
  const width = Math.max(fence === INDENTED ? 3 : fence.length, longestRun(content, char) + 1, 3)
  const delimiter = char.repeat(width)

  return `${delimiter}${language}\n${content}\n${delimiter}`
}

export const ManuscriptCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fence: sourceAttribute<Fence>('```'),
    }
  },

  parseMarkdown(token, helpers) {
    const raw = typeof token.raw === 'string' ? token.raw : ''
    const indented = token.codeBlockStyle === 'indented'
    if (!indented && !OPENING_FENCE.test(raw)) return []

    return helpers.createNode(
      'codeBlock',
      { language: token.lang || null, fence: readFence(raw, indented) },
      token.text ? [helpers.createTextNode(token.text)] : [],
    )
  },

  renderMarkdown: renderCodeBlock,
})
