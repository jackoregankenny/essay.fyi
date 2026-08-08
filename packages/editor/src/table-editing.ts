/**
 * ManuscriptTableEditing — the table interaction layer beyond structure
 * commands the Table extension already ships.
 *
 * What Tiptap's Table already covers, verified in test/table.test.ts rather
 * than duplicated here: Tab → next cell, Shift+Tab → previous, and Tab in the
 * last cell creating a row and moving into it. What this extension adds:
 *
 *   - row/column selection commands (CellSelection, the prosemirror-tables
 *     native) so the toolbar and palette can act on a whole row or column;
 *   - column alignment. GFM stores alignment per column (`:---`/`:--:`/`---:`),
 *     so the command writes the `align` attr on EVERY cell of the column —
 *     a partially aligned column would serialize as aligned and lie about
 *     the rest;
 *   - TSV clipboard, both directions: pasting tab-separated text with the
 *     caret in a table fills cells right/down from the anchor in ONE
 *     transaction (one undo), growing rows as needed; copying a cell
 *     selection produces TSV a spreadsheet will take back.
 *
 * Width controls are deliberately absent: GFM cannot store them.
 */
import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import {
  CellSelection,
  TableMap,
  isInTable,
  selectedRect,
  selectionCell,
} from '@tiptap/pm/tables'

export type ColumnAlign = 'left' | 'center' | 'right' | null

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    manuscriptTableEditing: {
      /**
       * Align every cell of the column(s) the selection touches. `null`
       * clears back to the unmarked `---` delimiter.
       */
      setColumnAlign: (align: ColumnAlign) => ReturnType
      /** Select the whole row holding the caret (CellSelection). */
      selectTableRow: () => ReturnType
      /** Select the whole column holding the caret (CellSelection). */
      selectTableColumn: () => ReturnType
    }
  }
}

/**
 * Tab-separated text as a grid, or null when the clipboard is not
 * grid-shaped. At least one tab is required: multi-line text without tabs is
 * a paragraph being pasted into a cell, not a single-column spreadsheet, and
 * guessing the other way would hijack ordinary pastes.
 */
export function parseTsv(text: string): string[][] | null {
  if (!text.includes('\t')) return null
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  if (normalized === '') return null
  return normalized.split('\n').map(line => line.split('\t'))
}

/** One block per line would break the grid, so blocks flatten to a space. */
function cellText(cell: ProseMirrorNode): string {
  return cell.textBetween(0, cell.content.size, ' ', ' ').trim()
}

/** A cell selection as TSV — what a spreadsheet expects on paste. */
export function cellSelectionTsv(sel: CellSelection): string {
  const table = sel.$anchorCell.node(-1)
  const tableStart = sel.$anchorCell.start(-1)
  const map = TableMap.get(table)
  const rect = map.rectBetween(sel.$anchorCell.pos - tableStart, sel.$headCell.pos - tableStart)

  const lines: string[] = []
  for (let row = rect.top; row < rect.bottom; row += 1) {
    const cells: string[] = []
    for (let col = rect.left; col < rect.right; col += 1) {
      const cell = table.nodeAt(map.map[row * map.width + col])
      cells.push(cell ? cellText(cell) : '')
    }
    lines.push(cells.join('\t'))
  }
  return lines.join('\n')
}

/**
 * Fill cells right/down from the selection's anchor cell with `text` parsed
 * as TSV. One transaction — one undo. Rows are added as needed; columns are
 * NOT: growing the table sideways from a paste reshapes every row the author
 * wrote, so overflow columns are dropped instead. Returns false (untouched
 * state) when the clipboard is not grid-shaped or the caret is not in a
 * table, so the ordinary paste path keeps the event.
 */
export function pasteTsv(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  text: string,
): boolean {
  if (!isInTable(state)) return false
  const data = parseTsv(text)
  if (!data) return false

  const rect = selectedRect(state)
  const { map, table, tableStart } = rect
  const tr = state.tr
  const schema = state.schema

  const rowsNeeded = rect.top + data.length - map.height
  if (rowsNeeded > 0) {
    const cellType = schema.nodes.tableCell
    const rowType = schema.nodes.tableRow
    // New cells inherit the column's alignment from the bottom row — the
    // serializer reads alignment per column anyway; this keeps the editor's
    // text-align in step with what the file will say.
    const cells: ProseMirrorNode[] = []
    for (let col = 0; col < map.width; col += 1) {
      const above = table.nodeAt(map.map[(map.height - 1) * map.width + col])
      const align = (above?.attrs.align as string | null) ?? null
      const cell = cellType.createAndFill(align ? { align } : null)
      if (!cell) return false
      cells.push(cell)
    }
    const rows: ProseMirrorNode[] = []
    for (let row = 0; row < rowsNeeded; row += 1) rows.push(rowType.create(null, cells))
    // Appending at the table's end leaves every existing cell position valid.
    tr.insert(tableStart + table.content.size, rows)
  }

  const grownTable = tr.doc.nodeAt(tableStart - 1)
  if (!grownTable) return false
  const grownMap = TableMap.get(grownTable)

  // Collect targets, then write bottom-right to top-left so each replace
  // leaves the positions of the ones still to come untouched.
  const targets: Array<{ pos: number; value: string }> = []
  for (let row = 0; row < data.length; row += 1) {
    const rowIndex = rect.top + row
    if (rowIndex >= grownMap.height) break
    for (let col = 0; col < data[row].length; col += 1) {
      const colIndex = rect.left + col
      if (colIndex >= grownMap.width) break
      targets.push({
        pos: grownMap.map[rowIndex * grownMap.width + colIndex],
        value: data[row][col],
      })
    }
  }
  targets.sort((a, b) => b.pos - a.pos)

  for (const { pos, value } of targets) {
    const cell = tr.doc.nodeAt(tableStart + pos)
    if (!cell) continue
    const paragraph = value
      ? schema.nodes.paragraph.create(null, schema.text(value))
      : schema.nodes.paragraph.create()
    tr.replaceWith(tableStart + pos + 1, tableStart + pos + cell.nodeSize - 1, paragraph)
  }

  dispatch(tr)
  return true
}

const tsvKey = new PluginKey('essayTableTsv')

export const ManuscriptTableEditing = Extension.create({
  name: 'manuscriptTableEditing',

  // Above the Table extension (default 100) so this plugin's handlePaste is
  // consulted before prosemirror-tables' own, which would otherwise consume
  // a paste into a CellSelection before the TSV path sees it.
  priority: 110,

  addCommands() {
    return {
      setColumnAlign:
        (align: ColumnAlign) =>
        ({ state, tr, dispatch }) => {
          if (!isInTable(state)) return false
          if (dispatch) {
            const rect = selectedRect(state)
            for (let col = rect.left; col < rect.right; col += 1) {
              for (let row = 0; row < rect.map.height; row += 1) {
                const index = row * rect.map.width + col
                const pos = rect.map.map[index]
                // A spanning cell appears at several grid indices; touch it once.
                if (row > 0 && rect.map.map[index - rect.map.width] === pos) continue
                if (col > rect.left && rect.map.map[index - 1] === pos) continue
                const cell = rect.table.nodeAt(pos)
                if (cell && ((cell.attrs.align as string | null) ?? null) !== align) {
                  tr.setNodeMarkup(rect.tableStart + pos, null, { ...cell.attrs, align })
                }
              }
            }
            dispatch(tr)
          }
          return true
        },

      selectTableRow:
        () =>
        ({ state, tr, dispatch }) => {
          if (!isInTable(state)) return false
          if (dispatch) {
            dispatch(tr.setSelection(CellSelection.rowSelection(selectionCell(state))))
          }
          return true
        },

      selectTableColumn:
        () =>
        ({ state, tr, dispatch }) => {
          if (!isInTable(state)) return false
          if (dispatch) {
            dispatch(tr.setSelection(CellSelection.colSelection(selectionCell(state))))
          }
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tsvKey,
        props: {
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData('text/plain')
            if (!text) return false
            return pasteTsv(view.state, view.dispatch, text)
          },
          clipboardTextSerializer: (slice, view) => {
            const sel = view.state.selection
            if (sel instanceof CellSelection) return cellSelectionTsv(sel)
            // Not ours — reproduce ProseMirror's default, because a someProp
            // answer cannot decline once given and must not change ordinary copy.
            return slice.content.textBetween(0, slice.content.size, '\n\n')
          },
        },
      }),
    ]
  },
})
