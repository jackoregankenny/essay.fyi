/**
 * Table serialization that does not re-lay-out the author's table.
 *
 * Invariant 2 says saving must not gratuitously rewrite the author's Markdown.
 * Tiptap's stock table renderer breaks that twice over. It pads every cell out
 * to the width of the widest cell in the column, so adding one long row
 * rewrites every other row in the table; and it wraps the whole block in its
 * own newlines on top of the `\n\n` the document renderer already puts between
 * blocks, so a table gains a blank line above it and two below on every save.
 *
 * A serializer cannot recover the author's original spacing — the column
 * widths are not in the ProseMirror document — so the honest choice is the
 * narrowest stable form: one space inside each pipe, three dashes in the
 * delimiter row. That is the style this repository's own manuscripts are
 * written in, and it is what a table stays at once it has been written once.
 */
import type { JSONContent, MarkdownRendererHelpers } from '@tiptap/core'

/**
 * Cells that hold several blocks are rendered block-by-block and rejoined, so
 * the block boundary can be turned back into the `<br>` a table cell needs.
 * The unit separator is a control character no manuscript contains.
 */
const BLOCK_SEPARATOR = '\u001F'

type CellAlign = 'left' | 'center' | 'right' | null

interface Cell {
  text: string
  isHeader: boolean
  align: CellAlign
}

function readAlign(attrs: Record<string, unknown> | undefined): CellAlign {
  const align = attrs?.align ?? attrs?.textAlign
  return align === 'left' || align === 'center' || align === 'right' ? align : null
}

/** A cell has to live on one line, so internal breaks become `<br>`. */
function flattenCell(raw: string): string {
  return raw
    .split(BLOCK_SEPARATOR)
    .join('\n')
    .replace(/[ \t]*\r?\n[ \t]*/g, '<br>')
    .replace(/\s+/g, ' ')
    .trim()
}

function readCell(cellNode: JSONContent, h: MarkdownRendererHelpers): Cell {
  const children = Array.isArray(cellNode.content) ? cellNode.content : []
  const raw =
    children.length > 1
      ? children.map(child => h.renderChildren(child as unknown as JSONContent)).join(BLOCK_SEPARATOR)
      : h.renderChildren(children as unknown as JSONContent[])

  return {
    text: flattenCell(raw),
    isHeader: cellNode.type === 'tableHeader',
    align: readAlign(cellNode.attrs),
  }
}

/** `---`, `:---`, `:---:` or `---:` — the shortest delimiter GFM accepts. */
function delimiterFor(align: CellAlign): string {
  if (align === 'left') return ':---'
  if (align === 'right') return '---:'
  if (align === 'center') return ':---:'
  return '---'
}

function renderRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

/**
 * Serialize a table node to a GFM pipe table. Emits no leading or trailing
 * newline: the document renderer joins top-level blocks with `\n\n`, and a
 * block that adds its own newlines on top of that is exactly the bug this
 * replaces.
 */
export function renderManuscriptTable(node: JSONContent, h: MarkdownRendererHelpers): string {
  const rowNodes = Array.isArray(node.content) ? node.content : []
  if (rowNodes.length === 0) return ''

  const rows: Cell[][] = rowNodes.map(rowNode =>
    (Array.isArray(rowNode.content) ? rowNode.content : []).map(cellNode => readCell(cellNode, h)),
  )

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)
  if (columnCount === 0) return ''

  // Alignment is a property of the column, but ProseMirror stores it per cell.
  // The first cell that declares one wins, matching how the parser assigns it.
  const alignments: CellAlign[] = Array.from({ length: columnCount }, (_, column) => {
    const declaring = rows.find(row => row[column]?.align)
    return declaring ? declaring[column].align : null
  })

  const cellsAt = (row: Cell[] | undefined): string[] =>
    Array.from({ length: columnCount }, (_, column) => row?.[column]?.text ?? '')

  // A pipe table needs a header row to be recognized at all. When the document
  // has no header cells an empty one is emitted rather than promoting the
  // author's first row of data into one.
  const hasHeader = rows[0].some(cell => cell.isHeader)
  const header = hasHeader ? cellsAt(rows[0]) : Array.from({ length: columnCount }, () => '')
  const body = hasHeader ? rows.slice(1) : rows

  return [
    renderRow(header),
    renderRow(alignments.map(delimiterFor)),
    ...body.map(row => renderRow(cellsAt(row))),
  ].join('\n')
}
