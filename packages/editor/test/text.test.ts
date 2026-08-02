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

import { manuscriptExtensions, manuscriptText, positionAtOffset } from '../src/index'
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
