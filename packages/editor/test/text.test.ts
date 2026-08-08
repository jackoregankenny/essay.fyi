/**
 * The flattened manuscript text, and the map from an offset back to a caret.
 *
 * `essay-search` decides where a match is; this decides where that answer
 * points. The failure mode it exists to catch is silent — a caret that lands a
 * few characters off, or in the paragraph above — because nothing throws when
 * an offset is wrong, it just puts the author somewhere they were not looking.
 */
import './dom'

import { describe, expect, test } from 'bun:test'
import { Editor } from '@tiptap/core'

import {
  extractTasks,
  manuscriptExtensions,
  manuscriptSections,
  manuscriptText,
  offsetAtPosition,
  positionAtOffset,
} from '../src/index'
import { setManuscript } from '../src/frontmatter'

function open(source: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: manuscriptExtensions(),
  })
  setManuscript(editor, source)
  return editor
}

/** The text at a caret position, as ProseMirror sees it. */
function textFrom(editor: Editor, pos: number, length: number): string {
  return editor.state.doc.textBetween(pos, pos + length)
}

describe('the manuscript flattens to the text the author sees', () => {
  test('markdown syntax is not part of the text', () => {
    const editor = open('# A Title\n\nSome **bold** prose.\n')
    expect(manuscriptText(editor).text).toBe('A Title\nSome bold prose.')
    editor.destroy()
  })

  test('a phrase interrupted by emphasis is still one phrase', () => {
    const editor = open('The **quick** brown fox.\n')
    expect(manuscriptText(editor).text).toBe('The quick brown fox.')
    editor.destroy()
  })

  test('every block is its own line, so a line number means a block', () => {
    const editor = open('One.\n\nTwo.\n\n- Three\n- Four\n\nFive.\n')
    expect(manuscriptText(editor).text.split('\n')).toEqual([
      'One.',
      'Two.',
      'Three',
      'Four',
      'Five.',
    ])
    editor.destroy()
  })
})

describe('an offset into that text becomes the caret position it names', () => {
  test('a match in the first block', () => {
    const editor = open('The quick brown fox.\n')
    const text = manuscriptText(editor)
    const offset = text.text.indexOf('brown')
    expect(textFrom(editor, positionAtOffset(text, offset), 5)).toBe('brown')
    editor.destroy()
  })

  test('a match in a later block, past every line break', () => {
    const editor = open('# A Title\n\nFirst para.\n\nThe needle is here.\n')
    const text = manuscriptText(editor)
    const offset = text.text.indexOf('needle')
    expect(textFrom(editor, positionAtOffset(text, offset), 6)).toBe('needle')
    editor.destroy()
  })

  test('a match that begins inside a mark, where the text runs are split', () => {
    const editor = open('Plain and **bold and more** plain.\n')
    const text = manuscriptText(editor)
    const offset = text.text.indexOf('more')
    expect(textFrom(editor, positionAtOffset(text, offset), 4)).toBe('more')
    editor.destroy()
  })

  test('a match after an astral character, which counts as two units', () => {
    const editor = open('An em dash — and 𝄞 then the needle.\n')
    const text = manuscriptText(editor)
    const offset = text.text.indexOf('needle')
    expect(textFrom(editor, positionAtOffset(text, offset), 6)).toBe('needle')
    editor.destroy()
  })

  test('a match inside a list item', () => {
    const editor = open('- One\n- The needle\n')
    const text = manuscriptText(editor)
    const offset = text.text.indexOf('needle')
    expect(textFrom(editor, positionAtOffset(text, offset), 6)).toBe('needle')
    editor.destroy()
  })
})

describe('a caret position becomes the offset that names it (the inverse map)', () => {
  test('round-trips through positionAtOffset inside a block', () => {
    const editor = open('The quick brown fox.\n')
    const text = manuscriptText(editor)
    const offset = text.text.indexOf('brown')
    expect(offsetAtPosition(text, positionAtOffset(text, offset))).toBe(offset)
    editor.destroy()
  })

  test('round-trips across marks, later blocks and astral characters', () => {
    const editor = open(
      '# Title\n\nPlain **bold** and — 𝄞 astral.\n\nThe needle paragraph.\n',
    )
    const text = manuscriptText(editor)
    for (const phrase of ['bold', 'astral', 'needle']) {
      const offset = text.text.indexOf(phrase)
      expect(offsetAtPosition(text, positionAtOffset(text, offset))).toBe(offset)
    }
    editor.destroy()
  })

  test('a selection sliced from the flattened text is the text the author selected', () => {
    const editor = open('First paragraph here.\n\nSecond paragraph there.\n')
    const text = manuscriptText(editor)
    // A multi-block selection: from "paragraph" in block one to "Second" in
    // block two, expressed as ProseMirror positions.
    const from = positionAtOffset(text, text.text.indexOf('paragraph'))
    const to = positionAtOffset(text, text.text.indexOf('Second') + 'Second'.length)
    const slice = text.text.slice(offsetAtPosition(text, from), offsetAtPosition(text, to))
    expect(slice).toBe('paragraph here.\nSecond')
    editor.destroy()
  })

  test('a position at the very end of a block maps to the end of its run', () => {
    const editor = open('One.\n\nTwo.\n')
    const text = manuscriptText(editor)
    const endOfOne = positionAtOffset(text, text.text.indexOf('One.')) + 'One.'.length
    expect(offsetAtPosition(text, endOfOne)).toBe('One.'.length)
    editor.destroy()
  })

  test('a position before any text clamps to the start', () => {
    const editor = open('Only paragraph.\n')
    const text = manuscriptText(editor)
    expect(offsetAtPosition(text, 0)).toBe(0)
    editor.destroy()
  })
})

describe('sections restated in flattened coordinates, with duplicate ordinals', () => {
  test('spans run heading-to-heading and the last runs to the end', () => {
    const editor = open(
      'Preamble before any heading.\n\n# One\n\nBody one.\n\n## Two\n\nBody two.\n',
    )
    const text = manuscriptText(editor)
    const sections = manuscriptSections(editor, text)
    expect(sections.map((s) => s.text)).toEqual(['One', 'Two'])
    // The preamble is in no section: the first span starts at its heading.
    expect(text.text.slice(sections[0].from, sections[0].from + 3)).toBe('One')
    expect(sections[0].to).toBe(sections[1].from)
    expect(sections[1].to).toBe(text.text.length)
    editor.destroy()
  })

  test('duplicate headings are told apart by ordinal, same text and depth only', () => {
    const editor = open(
      '## Objections\n\nFirst run.\n\n## Objections\n\nSecond run.\n\n# Objections\n\nDifferent depth.\n',
    )
    const sections = manuscriptSections(editor)
    expect(sections.map((s) => [s.text, s.level, s.ordinal])).toEqual([
      ['Objections', 2, 0],
      ['Objections', 2, 1],
      ['Objections', 1, 0],
    ])
    editor.destroy()
  })
})

describe('task lists become document structure without leaving Markdown', () => {
  test('open and completed tasks retain their text, state and position', () => {
    const editor = open('- [ ] Follow up the evidence\n- [x] Draft the opening\n')
    const tasks = extractTasks(editor)

    expect(tasks.map(({ text, checked }) => ({ text, checked }))).toEqual([
      { text: 'Follow up the evidence', checked: false },
      { text: 'Draft the opening', checked: true },
    ])
    expect(tasks[0].pos).toBeLessThan(tasks[1].pos)
    editor.destroy()
  })
})
