/**
 * List serialization that keeps the author's markers.
 *
 * Invariant 2 again: a save must not rewrite Markdown the author did not
 * touch. Tiptap's stock list renderer rewrites two things unconditionally.
 * Every bullet comes back as `-`, so a file written with `*` or `+` has every
 * list line changed on the first save. And every ordered item is numbered
 * `start + index`, so the widely used
 *
 *     1. one
 *     1. two
 *     1. three
 *
 * — written that way precisely so inserting an item does not renumber the
 * rest — is rewritten to 1./2./3. the moment the file is opened and saved.
 *
 * ProseMirror models a list as "a list with a start number", not as a sequence
 * of author-written markers, and that is the right model for editing: pressing
 * Enter must produce a correct next item. So the fidelity we can honestly keep
 * is the list's *style*, not each individual marker — which bullet character,
 * which delimiter, and whether the numbers were repeated or ascending. Those
 * three go on the list node as attributes that never reach the DOM (they are
 * source facts, not semantics) and are honoured on the way back out.
 *
 * What this deliberately does not do is preserve a genuinely irregular list
 * (`1.` `5.` `2.`). Those numbers are not in the document model, and inventing
 * a place for them would mean the editor could no longer renumber a list the
 * author is actually editing.
 */
import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownParseResult,
  MarkdownRendererHelpers,
  MarkdownToken,
} from '@tiptap/core'
import {
  BulletList,
  getListMarker,
  ListItem,
  OrderedList,
  TaskItem,
  TaskList,
} from '@tiptap/extension-list'

/** How the author numbered an ordered list. */
export type Numbering = 'ordinal' | 'repeated'

/**
 * A source fact about the file — which marker, which fence — rather than
 * anything the document means. It rides along on the node so the serializer
 * can write the file back the way it was found, and it is never rendered into
 * the editor's DOM, because it has nothing to say about how the node looks.
 */
export const sourceAttribute = <T>(fallback: T) => ({
  default: fallback,
  rendered: false,
  keepOnSplit: true,
})

/** `  1. text` / `- text` — indentation, marker, delimiter. */
const ORDERED_MARKER = /^(\s*)(\d+)([.)])\s/
const BULLET_MARKER = /^(\s*)([-*+])\s/

/**
 * Read the marker lines of a list's own level out of the raw source. The raw
 * token spans nested lists too, so only lines at the shallowest indentation
 * belong to this list.
 */
function markersAtTopLevel<T>(raw: string, pattern: RegExp, read: (match: RegExpMatchArray) => T): T[] {
  const matched = raw
    .split('\n')
    .map(line => line.match(pattern))
    .filter((match): match is RegExpMatchArray => match !== null)

  if (matched.length === 0) return []

  const outermost = Math.min(...matched.map(match => match[1].length))
  return matched.filter(match => match[1].length === outermost).map(read)
}

/**
 * `repeated` when every marker at this level is the same number — the "all
 * ones" style. A single-item list is left as ordinal: there is nothing to
 * repeat, and calling it repeated would freeze the number if the author adds
 * a second item.
 */
export function readNumbering(raw: string): Numbering {
  const numbers = markersAtTopLevel(raw, ORDERED_MARKER, match => match[2])
  if (numbers.length < 2) return 'ordinal'
  return numbers.every(number => number === numbers[0]) ? 'repeated' : 'ordinal'
}

/** `.` unless the author wrote `1)`. Mixed delimiters fall back to `.`. */
export function readDelimiter(raw: string): '.' | ')' {
  const delimiters = markersAtTopLevel(raw, ORDERED_MARKER, match => match[3])
  return delimiters.length > 0 && delimiters.every(d => d === ')') ? ')' : '.'
}

/** The bullet character the author used, defaulting to `-`. */
export function readBullet(raw: string): '-' | '*' | '+' {
  const bullets = markersAtTopLevel(raw, BULLET_MARKER, match => match[2])
  const first = bullets[0]
  return first === '*' || first === '+' ? first : '-'
}

/**
 * Run the extension's inherited `parseMarkdown` and report whether it produced
 * a single node worth annotating. A list token reaches both list extensions,
 * and the one that does not want it answers with an empty array — so the
 * result is passed through untouched unless it is the node we asked for.
 */
function parseWithParent(
  context: unknown,
  token: MarkdownToken,
  helpers: MarkdownParseHelpers,
): { result: MarkdownParseResult; node?: JSONContent } {
  const parent = (context as { parent?: (...args: unknown[]) => MarkdownParseResult }).parent
  const result = parent?.(token, helpers) ?? []
  const node = !Array.isArray(result) && 'type' in result ? (result as JSONContent) : undefined
  return { result, node }
}

/**
 * Ordered lists that remember how they were written. The parse delegates to
 * the stock implementation and then annotates the node, so nothing about how
 * list items themselves are parsed changes here.
 */
export const ManuscriptOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      numbering: sourceAttribute<Numbering>('ordinal'),
      delimiter: sourceAttribute<'.' | ')'>('.'),
    }
  },

  parseMarkdown(token, helpers) {
    const parsed = parseWithParent(this, token, helpers)
    if (parsed.node?.type !== 'orderedList') return parsed.result

    const raw = typeof token.raw === 'string' ? token.raw : ''
    return {
      ...parsed.node,
      attrs: {
        ...parsed.node.attrs,
        numbering: readNumbering(raw),
        delimiter: readDelimiter(raw),
      },
    }
  },
})

/** Bullet lists that remember whether they were written with `-`, `*` or `+`. */
export const ManuscriptBulletList = BulletList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      marker: sourceAttribute<'-' | '*' | '+'>('-'),
    }
  },

  parseMarkdown(token, helpers) {
    const parsed = parseWithParent(this, token, helpers)
    if (parsed.node?.type !== 'bulletList') return parsed.result

    const raw = typeof token.raw === 'string' ? token.raw : ''
    return { ...parsed.node, attrs: { ...parsed.node.attrs, marker: readBullet(raw) } }
  },
})

/**
 * Render one list item, hanging everything under it at the marker's own width.
 *
 * Tiptap's shared list-item renderer indents nested content by a fixed two
 * spaces and does not indent the wrapped lines of the item's own paragraph at
 * all. Both are wrong for an ordered list — `1. ` puts the content column at
 * three — and the second turns a soft-wrapped item into text that only stays
 * inside the item by CommonMark's lazy-continuation rule, so every wrapped
 * list line in the author's file loses its indentation on save. Hanging
 * everything at `marker.length` is what the author wrote and what every other
 * Markdown tool writes.
 */
function renderListItem(
  node: JSONContent,
  h: MarkdownRendererHelpers,
  marker: string,
): string {
  const children = Array.isArray(node.content) ? node.content : []
  if (children.length === 0) return ''

  const hang = ' '.repeat(marker.length)
  const indentEveryLine = (text: string) =>
    text
      .split('\n')
      .map(line => (line ? hang + line : line))
      .join('\n')

  const [first, ...rest] = children
  // Leading whitespace on a wrapped paragraph line is not content — and the
  // upstream list tokenizer leaves a stray space on it, having dedented by the
  // width of the number rather than of the whole marker. Re-hanging from the
  // trimmed line is both the fix and the faithful output.
  const hangParagraph = (text: string) =>
    text
      .split('\n')
      .map((line, index) => {
        if (index === 0) return line
        const content = first.type === 'paragraph' ? line.replace(/^[ \t]+/, '') : line
        return content ? hang + content : content
      })
      .join('\n')

  let out = marker + hangParagraph(h.renderChildren([first]))

  rest.forEach((child, index) => {
    const rendered = h.renderChild?.(child, index + 1) ?? h.renderChildren([child])
    if (rendered === undefined || rendered === null) return
    // A paragraph needs a blank line to stay a separate block; a nested list
    // must sit directly under the line above or it becomes a new list.
    out += `${child.type === 'paragraph' ? '\n\n' : '\n'}${indentEveryLine(rendered)}`
  })

  return out
}

/**
 * List items that write the marker their parent list recorded. This replaces
 * the stock renderer rather than wrapping it: both the marker and the hanging
 * indent are different.
 */
export const ManuscriptListItem = ListItem.extend({
  renderMarkdown(node, h, ctx) {
    const parent = (ctx.meta?.parentAttrs ?? {}) as Record<string, unknown>
    return renderListItem(node, h, markerFor(ctx.parentType, parent, ctx.index ?? 0))
  },
})

/** Task items hang at six columns — the width of `- [ ] `. */
export const ManuscriptTaskItem = TaskItem.extend({
  renderMarkdown(node, h) {
    return renderListItem(node, h, `- [${node.attrs?.checked ? 'x' : ' '}] `)
  },
})

/** `  - [x] text` — indentation, checkbox state, and the text after it. */
const TASK_ITEM_LINE = /^(\s*)[-+*][ \t]+\[([ xX])\][ \t]+(.*)$/

/** A line that starts a block of its own rather than continuing a paragraph. */
const BLOCK_OPENER = /^\s*(?:[-+*][ \t]|\d+[.)][ \t]|>|```|~~~|#{1,6}[ \t])/

interface CollectedTaskItem {
  checked: boolean
  /** The item's own paragraph, including the lines it wraps onto. */
  main: string
  /** Everything after the first blank line or block opener, dedented. */
  nested: string
}

/**
 * Split a run of task-list lines into items.
 *
 * This exists because the stock tokenizer dedents an item's continuation lines
 * by a fixed two columns rather than by the width of `- [ ] `, which leaves
 * four spaces in front of them — and four spaces is an indented code block. A
 * task item whose text simply wrapped onto a second line came back wrapped in
 * a code fence, and because the fence itself then re-parsed as more indented
 * code, the item grew another pair of fences on *every* save. That is a
 * document corrupting itself while the author watches.
 *
 * Dedenting by no more than the content column keeps both readings right: a
 * wrapped line at column six joins the paragraph it wraps, and the two-space
 * nested list people actually write still nests.
 */
function collectTaskItems(lines: string[]): [CollectedTaskItem[], number] {
  const items: CollectedTaskItem[] = []
  let index = 0
  let consumed = 0

  while (index < lines.length) {
    const match = lines[index].match(TASK_ITEM_LINE)
    if (!match) break

    const indent = match[1].length
    const contentColumn = match[0].length - match[3].length
    const main = [match[3]]
    const nested: string[] = []
    let inNested = false
    index += 1

    while (index < lines.length) {
      const line = lines[index]

      if (line.trim() === '') {
        const following = lines.slice(index + 1).find(candidate => candidate.trim() !== '')
        if (following === undefined) break
        if (following.length - following.trimStart().length <= indent) break
        inNested = true
        nested.push('')
        index += 1
        continue
      }

      const lineIndent = line.length - line.trimStart().length
      if (lineIndent <= indent) break
      if (BLOCK_OPENER.test(line)) inNested = true
      ;(inNested ? nested : main).push(line.slice(Math.min(lineIndent, contentColumn)))
      index += 1
    }

    consumed = index
    items.push({
      checked: match[2].toLowerCase() === 'x',
      main: main.join('\n'),
      nested: nested.join('\n'),
    })
  }

  return [items, consumed]
}

/**
 * Task lists whose items keep their wrapped lines. Only the tokenizer is
 * replaced; parsing and rendering of the resulting tokens is unchanged.
 */
export const ManuscriptTaskList = TaskList.extend({
  markdownTokenizer: {
    name: 'taskList',
    level: 'block' as const,
    start: (src: string) => src.match(/^\s*[-+*][ \t]+\[[ xX]\][ \t]+/)?.index ?? -1,
    tokenize: (src, _tokens, lexer) => {
      const lines = src.split('\n')
      const [collected, consumed] = collectTaskItems(lines)
      if (collected.length === 0) return undefined

      return {
        type: 'taskList',
        raw: lines.slice(0, consumed).join('\n'),
        items: collected.map(item => ({
          type: 'taskItem',
          raw: '',
          checked: item.checked,
          mainContent: item.main,
          text: item.main,
          tokens: lexer.inlineTokens(item.main),
          nestedTokens: item.nested.trim() ? lexer.blockTokens(item.nested) : [],
        })),
      } as unknown as object
    },
  },
})

function markerFor(
  parentType: string | null | undefined,
  parent: Record<string, unknown>,
  index: number,
): string {
  if (parentType === 'orderedList') {
    const start = typeof parent.start === 'number' ? parent.start : 1
    const type = typeof parent.type === 'string' ? parent.type : undefined
    const delimiter = parent.delimiter === ')' ? ')' : '.'
    // A repeated list writes its start value on every line. Lettered and roman
    // lists are always ordinal — repeating "a." reads as a typo in a way
    // repeating "1." does not.
    const ordinal = parent.numbering === 'repeated' && !type ? 0 : index
    return getListMarker(type, start - 1 + ordinal, `${delimiter} `)
  }

  if (parentType === 'bulletList') {
    const marker = parent.marker
    return `${marker === '*' || marker === '+' ? marker : '-'} `
  }

  return '- '
}
