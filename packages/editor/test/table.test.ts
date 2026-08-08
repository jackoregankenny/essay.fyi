/**
 * Tables: keyboard navigation (Tiptap's, verified), structure commands,
 * column alignment that serializes to real GFM markers, and TSV both ways.
 */
import { describe, expect, test } from 'bun:test'
import './dom'
import { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'

import { manuscriptExtensions, getManuscript, setManuscript } from '../src/index'
import { ManuscriptTableEditing, cellSelectionTsv, parseTsv, pasteTsv } from '../src/table-editing'

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n'

/** The manuscript surface — table editing ships in the default assembly. */
function tableEditor(source: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: manuscriptExtensions(),
  })
  setManuscript(editor, source)
  // Close the history group so an undo assertion measures the edit under
  // test, not the edit folded together with the setContent above it.
  editor.view.dispatch(closeHistory(editor.state.tr))
  return editor
}

/**
 * A keydown through the view's own handler chain — the path a real Tab takes.
 * Not editor.commands.keyboardShortcut(): that runs inside a buffered
 * command transaction which, dispatched after the nested command's own, puts
 * the old selection back and would report navigation as broken when it isn't.
 */
function pressKey(editor: Editor, key: string, shift = false): boolean {
  const event = new KeyboardEvent('keydown', { key, shiftKey: shift })
  return editor.view.someProp('handleKeyDown', f => f(editor.view, event)) ?? false
}

function withEditor<T>(source: string, fn: (editor: Editor) => T): T {
  const editor = tableEditor(source)
  try {
    return fn(editor)
  } finally {
    editor.destroy()
  }
}

/** Put the caret inside the first cell whose text is `text`. */
function caretInCell(editor: Editor, text: string): void {
  let target = -1
  editor.state.doc.descendants((node, pos) => {
    if (target === -1 && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) {
      if (node.textContent === text) target = pos + 2
    }
    return target === -1
  })
  expect(target).toBeGreaterThan(-1)
  const tr = editor.state.tr.setSelection(
    TextSelection.create(editor.state.doc, target),
  )
  editor.view.dispatch(tr)
}

/** A CellSelection from the cell containing `anchor` to the one containing `head`. */
function selectCells(editor: Editor, anchor: string, head: string): void {
  const cells: Record<string, number> = {}
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      cells[node.textContent] = pos
      return false
    }
    return true
  })
  const sel = CellSelection.create(editor.state.doc, cells[anchor], cells[head])
  editor.view.dispatch(editor.state.tr.setSelection(sel))
}

describe('keyboard navigation (the Table extension\'s, held by test)', () => {
  test('Tab moves to the next cell', () => {
    withEditor(TABLE, editor => {
      caretInCell(editor, '1')
      expect(pressKey(editor, 'Tab')).toBe(true)
      expect(editor.state.selection.$from.parent.textContent).toBe('2')
    })
  })

  test('Shift+Tab moves to the previous cell', () => {
    withEditor(TABLE, editor => {
      caretInCell(editor, '2')
      expect(pressKey(editor, 'Tab', true)).toBe(true)
      expect(editor.state.selection.$from.parent.textContent).toBe('1')
    })
  })

  test('Tab in the last cell creates a row and moves into it', () => {
    withEditor(TABLE, editor => {
      caretInCell(editor, '2')
      expect(pressKey(editor, 'Tab')).toBe(true)
      expect(getManuscript(editor)).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n')
      // The caret landed in the new row's first cell.
      expect(editor.state.selection.$from.node(-1).textContent).toBe('')
    })
  })
})

describe('column alignment', () => {
  test('alignment markers survive a round-trip byte for byte', () => {
    const source = '| Left | Centre | Right |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n'
    withEditor(source, editor => {
      expect(getManuscript(editor)).toBe(source)
    })
  })

  test('setColumnAlign writes the GFM marker for the caret\'s column', () => {
    withEditor(TABLE, editor => {
      caretInCell(editor, '2')
      expect(editor.commands.setColumnAlign('center')).toBe(true)
      expect(getManuscript(editor)).toBe('| A | B |\n| --- | :---: |\n| 1 | 2 |\n')
    })
  })

  test('each alignment produces its marker, and null clears it', () => {
    withEditor(TABLE, editor => {
      caretInCell(editor, '1')
      editor.commands.setColumnAlign('left')
      expect(getManuscript(editor)).toContain('| :--- | --- |')
      editor.commands.setColumnAlign('right')
      expect(getManuscript(editor)).toContain('| ---: | --- |')
      editor.commands.setColumnAlign(null)
      expect(getManuscript(editor)).toBe(TABLE)
    })
  })

  test('alignment is one undo step', () => {
    withEditor(TABLE, editor => {
      caretInCell(editor, '1')
      editor.commands.setColumnAlign('right')
      editor.commands.undo()
      expect(getManuscript(editor)).toBe(TABLE)
    })
  })
})

describe('row and column selection and structure commands', () => {
  test('selectTableRow selects the caret\'s whole row', () => {
    withEditor(TABLE, editor => {
      caretInCell(editor, '1')
      expect(editor.commands.selectTableRow()).toBe(true)
      const sel = editor.state.selection
      expect(sel).toBeInstanceOf(CellSelection)
      expect((sel as CellSelection).isRowSelection()).toBe(true)
    })
  })

  test('selectTableColumn selects the caret\'s whole column', () => {
    withEditor(TABLE, editor => {
      caretInCell(editor, '1')
      expect(editor.commands.selectTableColumn()).toBe(true)
      const sel = editor.state.selection
      expect(sel).toBeInstanceOf(CellSelection)
      expect((sel as CellSelection).isColSelection()).toBe(true)
    })
  })

  test('insert row above and column before land on the correct side', () => {
    withEditor(TABLE, editor => {
      caretInCell(editor, '1')
      editor.commands.addRowBefore()
      expect(getManuscript(editor)).toBe('| A | B |\n| --- | --- |\n|  |  |\n| 1 | 2 |\n')
    })
    withEditor(TABLE, editor => {
      caretInCell(editor, '1')
      editor.commands.addColumnBefore()
      expect(getManuscript(editor)).toBe('|  | A | B |\n| --- | --- | --- |\n|  | 1 | 2 |\n')
    })
  })

  test('toggling the header row off serializes an empty GFM header', () => {
    // GFM cannot express a headerless table, so the serializer emits an empty
    // header row rather than promoting the first data row — pinned here.
    withEditor(TABLE, editor => {
      caretInCell(editor, '1')
      editor.commands.toggleHeaderRow()
      expect(getManuscript(editor)).toBe('|  |  |\n| --- | --- |\n| A | B |\n| 1 | 2 |\n')
      editor.commands.toggleHeaderRow()
      expect(getManuscript(editor)).toBe(TABLE)
    })
  })
})

describe('TSV clipboard', () => {
  test('parseTsv requires a tab — prose pastes are not grids', () => {
    expect(parseTsv('just a paragraph')).toBeNull()
    expect(parseTsv('two\nlines of prose')).toBeNull()
    expect(parseTsv('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  test('paste fills right and down from the anchor cell, growing rows', () => {
    withEditor(TABLE, editor => {
      caretInCell(editor, '1')
      const handled = pasteTsv(editor.state, tr => editor.view.dispatch(tr), 'x\ty\nz\tw')
      expect(handled).toBe(true)
      expect(getManuscript(editor)).toBe('| A | B |\n| --- | --- |\n| x | y |\n| z | w |\n')
    })
  })

  test('overflow columns are dropped rather than reshaping the table', () => {
    withEditor(TABLE, editor => {
      caretInCell(editor, '2')
      pasteTsv(editor.state, tr => editor.view.dispatch(tr), 'x\tdropped')
      expect(getManuscript(editor)).toBe('| A | B |\n| --- | --- |\n| 1 | x |\n')
    })
  })

  test('a paste is one undo step', () => {
    withEditor(TABLE, editor => {
      caretInCell(editor, '1')
      pasteTsv(editor.state, tr => editor.view.dispatch(tr), 'x\ty\nz\tw')
      editor.commands.undo()
      expect(getManuscript(editor)).toBe(TABLE)
    })
  })

  test('outside a table the paste is declined', () => {
    withEditor('A paragraph.\n\n' + TABLE, editor => {
      editor.commands.setTextSelection(2)
      expect(pasteTsv(editor.state, () => {}, 'a\tb')).toBe(false)
    })
  })

  test('a cell selection copies as TSV', () => {
    withEditor('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n', editor => {
      selectCells(editor, '1', '4')
      expect(cellSelectionTsv(editor.state.selection as CellSelection)).toBe('1\t2\n3\t4')
    })
  })

  test('a single column selection copies without stray tabs', () => {
    withEditor('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n', editor => {
      selectCells(editor, '1', '3')
      expect(cellSelectionTsv(editor.state.selection as CellSelection)).toBe('1\n3')
    })
  })
})
