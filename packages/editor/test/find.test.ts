/**
 * The find engine and the decoration substrate.
 *
 * The matching semantics are transcribed from `essay-search` (case fold,
 * whole-word alphabet, non-overlapping scan) — several tests here mirror the
 * crate's own so a drift between the two matchers fails loudly on whichever
 * side moved. The rest covers what only the editor side can get wrong: the
 * offset→position map, replaceability across structure, and undo grouping.
 */
import './dom'

import { describe, expect, test } from 'bun:test'
import { Editor } from '@tiptap/core'

import {
  decorationLayerRanges,
  findInText,
  findMatches,
  manuscriptExtensions,
  manuscriptText,
  setDecorationLayer,
  FindController,
} from '../src/index'
import { getManuscript, setManuscript } from '../src/frontmatter'

function open(source: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: manuscriptExtensions(),
  })
  setManuscript(editor, source)
  // The caret at the head of the document, as it is when a document has just
  // been opened — the controller starts its session from the caret, and
  // setManuscript leaves the selection at the end.
  editor.commands.setTextSelection(1)
  return editor
}

describe('matching mirrors essay-search', () => {
  test('a search ignores case by default', () => {
    const editor = open('The Manuscript is a manuscript.\n')
    expect(findMatches(editor, 'manuscript')).toHaveLength(2)
    editor.destroy()
  })

  test('a case-sensitive search tells the two apart', () => {
    const editor = open('The Manuscript is a manuscript.\n')
    const found = findMatches(editor, 'manuscript', { caseSensitive: true })
    expect(found).toHaveLength(1)
    expect(found[0].text).toBe('manuscript')
    editor.destroy()
  })

  test('a whole-word search skips the word inside a longer one', () => {
    const editor = open('Mark went to the market.\n')
    const found = findMatches(editor, 'mark', { wholeWord: true })
    expect(found).toHaveLength(1)
    expect(found[0].offset).toBe(0)
    editor.destroy()
  })

  test('a whole-word search treats an apostrophe as part of the word', () => {
    const cant = open("she can't stop\n")
    expect(findMatches(cant, 'can', { wholeWord: true })).toHaveLength(0)
    cant.destroy()
    const can = open('she can stop\n')
    expect(findMatches(can, 'can', { wholeWord: true })).toHaveLength(1)
    can.destroy()
  })

  test('punctuation is a word boundary', () => {
    const editor = open('A word. Another word, again\n')
    expect(findMatches(editor, 'word', { wholeWord: true })).toHaveLength(2)
    editor.destroy()
  })

  test('overlapping occurrences are reported once', () => {
    expect(findInText('aaa', 'aa')).toHaveLength(1)
  })

  test('an empty query finds nothing', () => {
    expect(findInText('a document with words in it', '')).toHaveLength(0)
  })

  test('the fold never changes UTF-16 length, so offsets after ß and İ hold', () => {
    // 'İ'.toLowerCase() expands to two code points and 'ß' pairs with 'ẞ';
    // a full toLowerCase over the haystack would shift the needle's offset.
    const text = 'İstanbul and Straße before the needle'
    const found = findInText(text, 'NEEDLE')
    expect(found).toHaveLength(1)
    expect(found[0].offset).toBe(text.indexOf('needle'))
    // And the expanding fold still matches one-to-one, as the crate's does.
    expect(findInText(text, 'istanbul')[0]).toEqual({ offset: 0, length: 8 })
  })
})

describe('matches land on the right ProseMirror range', () => {
  test('a phrase crossing bold is one match, and replaceable', () => {
    const editor = open('The **quick brown** fox jumps.\n')
    const found = findMatches(editor, 'quick brown fox')
    expect(found).toHaveLength(1)
    const match = found[0]
    expect(match.replaceable).toBe(true)
    expect(editor.state.doc.textBetween(match.from, match.to)).toBe('quick brown fox')
    editor.destroy()
  })

  test('emoji and astral characters do not shift the range', () => {
    const editor = open('An emoji 🎯 then 𝄞 then the needle here.\n')
    const match = findMatches(editor, 'needle')[0]
    expect(editor.state.doc.textBetween(match.from, match.to)).toBe('needle')
    editor.destroy()
  })

  test('accented text matches case-insensitively at the right place', () => {
    const editor = open('Café society begins.\n')
    const match = findMatches(editor, 'café')[0]
    expect(match).toBeDefined()
    expect(editor.state.doc.textBetween(match.from, match.to)).toBe('Café')
    editor.destroy()
  })

  test('an em dash before the match does not shift it', () => {
    const editor = open('A pause — long — then the needle.\n')
    const match = findMatches(editor, 'needle')[0]
    expect(editor.state.doc.textBetween(match.from, match.to)).toBe('needle')
    editor.destroy()
  })

  test('a match ending at the end of a block does not leak into the next', () => {
    const editor = open('Ends with needle\n\nNext paragraph.\n')
    const match = findMatches(editor, 'needle')[0]
    expect(match.replaceable).toBe(true)
    expect(editor.state.doc.textBetween(match.from, match.to)).toBe('needle')
    editor.destroy()
  })
})

describe('a match that spans structure is findable but not replaceable', () => {
  test('across a hard break', () => {
    const editor = open('alpha  \nbeta\n')
    // Guard the fixture itself: the hard break must flatten to a newline.
    expect(manuscriptText(editor).text).toBe('alpha\nbeta')
    const found = findMatches(editor, 'alpha\nbeta')
    expect(found).toHaveLength(1)
    expect(found[0].replaceable).toBe(false)
    editor.destroy()
  })

  test('across a paragraph boundary', () => {
    const editor = open('One two.\n\nThree four.\n')
    const found = findMatches(editor, 'two.\nThree')
    expect(found).toHaveLength(1)
    expect(found[0].replaceable).toBe(false)
    editor.destroy()
  })

  test('replace-all skips it and says so', () => {
    const editor = open('alpha  \nbeta and alpha beta again\n')
    const controller = new FindController(editor)
    controller.setQuery('alpha\nbeta')
    expect(controller.state().matches).toHaveLength(1)
    expect(controller.replaceAll('gone')).toBe(0)
    expect(getManuscript(editor)).toBe('alpha  \nbeta and alpha beta again\n')
    controller.destroy()
    editor.destroy()
  })
})

describe('navigation wraps', () => {
  test('next cycles forward and wraps to the first match', () => {
    const editor = open('needle one, needle two, needle three.\n')
    const controller = new FindController(editor)
    controller.setQuery('needle')
    expect(controller.state().matches).toHaveLength(3)
    expect(controller.state().activeIndex).toBe(0)
    controller.next()
    expect(controller.state().activeIndex).toBe(1)
    controller.next()
    expect(controller.state().activeIndex).toBe(2)
    controller.next()
    expect(controller.state().activeIndex).toBe(0)
    controller.destroy()
    editor.destroy()
  })

  test('previous wraps to the last match', () => {
    const editor = open('needle one, needle two, needle three.\n')
    const controller = new FindController(editor)
    controller.setQuery('needle')
    controller.previous()
    expect(controller.state().activeIndex).toBe(2)
    controller.destroy()
    editor.destroy()
  })
})

describe('replacement', () => {
  test('replace one replaces only the active match', () => {
    const editor = open('aaa bbb aaa.\n')
    const controller = new FindController(editor)
    controller.setQuery('bbb')
    expect(controller.replaceActive('xxx')).toBe(true)
    expect(getManuscript(editor)).toBe('aaa xxx aaa.\n')
    controller.destroy()
    editor.destroy()
  })

  test('replace all replaces every match, applied from the end', () => {
    // A replacement longer than the query: applied front-to-back without
    // mapping, the later ranges would drift and splice mid-word.
    const editor = open('x needle y needle z needle.\n')
    const controller = new FindController(editor)
    controller.setQuery('needle')
    expect(controller.replaceAll('a much longer replacement')).toBe(3)
    expect(getManuscript(editor)).toBe(
      'x a much longer replacement y a much longer replacement z a much longer replacement.\n',
    )
    controller.destroy()
    editor.destroy()
  })

  test('replace all is one undo step', () => {
    const source = 'one needle, two needle, three needle.\n'
    const editor = open(source)
    const controller = new FindController(editor)
    controller.setQuery('needle')
    expect(controller.replaceAll('pin')).toBe(3)
    expect(getManuscript(editor)).toBe('one pin, two pin, three pin.\n')
    editor.commands.undo()
    expect(getManuscript(editor)).toBe(source)
    controller.destroy()
    editor.destroy()
  })

  test('replacement with different case leaves the others alone', () => {
    const editor = open('The Manuscript is a manuscript.\n')
    const controller = new FindController(editor)
    controller.setQuery('manuscript')
    // Case-insensitive: the replaced text is what the document held, not the
    // query, so the first (capitalised) occurrence is what changes.
    expect(controller.replaceActive('draft')).toBe(true)
    expect(getManuscript(editor)).toBe('The draft is a manuscript.\n')
    controller.destroy()
    editor.destroy()
  })
})

describe('the controller keeps up with the document', () => {
  test('refresh recomputes after an edit', () => {
    const editor = open('one needle here.\n')
    const controller = new FindController(editor)
    controller.setQuery('needle')
    expect(controller.state().matches).toHaveLength(1)
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' and a needle there')
    controller.refresh()
    expect(controller.state().matches).toHaveLength(2)
    controller.destroy()
    editor.destroy()
  })

  test('a large document recomputes and counts correctly', () => {
    // Built as document JSON, not markdown: parsing 2000 paragraphs of
    // markdown through the whole pipeline takes seconds in happy-dom and is
    // not what this test measures. The flatten–match–map path under test is
    // the same either way (measured at ~17ms for this document).
    const paragraphs = Array.from({ length: 2000 }, (_, i) => ({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: `Paragraph ${i} carries a needle among its ordinary words.`,
        },
      ],
    }))
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: manuscriptExtensions(),
      content: { type: 'doc', content: paragraphs },
    })
    const found = findMatches(editor, 'needle')
    expect(found).toHaveLength(2000)
    // Spot-check the far end of the map, where a drifted offset would land.
    const last = found[found.length - 1]
    expect(editor.state.doc.textBetween(last.from, last.to)).toBe('needle')
    editor.destroy()
  })
})

describe('decoration layers', () => {
  test('a layer maps through edits until it is set again', () => {
    const editor = open('before the needle after.\n')
    const match = findMatches(editor, 'needle')[0]
    setDecorationLayer(editor, 'find', [{ from: match.from, to: match.to }])
    expect(decorationLayerRanges(editor, 'find')).toEqual([
      { from: match.from, to: match.to },
    ])
    editor.commands.insertContentAt(1, 'XX ')
    expect(decorationLayerRanges(editor, 'find')).toEqual([
      { from: match.from + 3, to: match.to + 3 },
    ])
    editor.destroy()
  })

  test('layers are independent: setting one leaves the others', () => {
    const editor = open('two words here.\n')
    setDecorationLayer(editor, 'find', [{ from: 1, to: 4 }])
    setDecorationLayer(editor, 'comment', [{ from: 5, to: 10 }])
    setDecorationLayer(editor, 'find', [])
    expect(decorationLayerRanges(editor, 'find')).toEqual([])
    expect(decorationLayerRanges(editor, 'comment')).toEqual([{ from: 5, to: 10 }])
    editor.destroy()
  })

  test('layer classes reach the DOM, extra classes appended', () => {
    const editor = open('mark this word.\n')
    setDecorationLayer(editor, 'find', [
      { from: 6, to: 10, attrs: { class: 'is-extra', 'data-thread': 't1' } },
    ])
    const span = editor.view.dom.querySelector('.essay-deco-find')
    expect(span).not.toBeNull()
    expect(span?.classList.contains('is-extra')).toBe(true)
    expect(span?.getAttribute('data-thread')).toBe('t1')
    editor.destroy()
  })

  test('closing a find session clears its layers', () => {
    const editor = open('a needle to find.\n')
    const controller = new FindController(editor)
    controller.setQuery('needle')
    expect(decorationLayerRanges(editor, 'find')).toHaveLength(1)
    expect(decorationLayerRanges(editor, 'find-active')).toHaveLength(1)
    controller.destroy()
    expect(decorationLayerRanges(editor, 'find')).toEqual([])
    expect(decorationLayerRanges(editor, 'find-active')).toEqual([])
    editor.destroy()
  })
})
