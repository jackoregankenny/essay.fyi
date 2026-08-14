/**
 * Pasted Markdown: where the "is this a document?" line sits, and what the
 * editor does on either side of it.
 *
 * The heuristic is the interesting part. Parsing everything would mangle
 * ordinary prose; parsing nothing is the bug this fixes. These tests are the
 * specification of the compromise.
 */
import { describe, expect, test } from 'bun:test'
import './dom'
import { Editor } from '@tiptap/core'

import { getManuscript, manuscriptExtensions, setManuscript } from '../src/index'
import { looksLikeMarkdown } from '../src/markdown-paste'

function editorWith(source = ''): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: manuscriptExtensions(),
  })
  setManuscript(editor, source)
  return editor
}

/**
 * Paste is a DOM event with a DataTransfer, which happy-dom does not
 * construct for us. ProseMirror only ever calls `getData`, so a stub with
 * that method is the whole contract.
 */
function paste(editor: Editor, data: Record<string, string>): boolean {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string }
  }
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => data[type] ?? '' },
  })
  return editor.view.someProp('handlePaste', (fn) =>
    fn(editor.view, event as unknown as ClipboardEvent, editor.view.state.selection.content()),
  ) ?? false
}

describe('looksLikeMarkdown', () => {
  test.each([
    ['heading', '## What this produces'],
    ['bullet list', '- Ship useful first versions\n- Then improve them'],
    ['asterisk bullet', '* one\n* two'],
    ['ordered list', '1. First\n2. Second'],
    ['blockquote', '> Somebody said this'],
    ['fence', '```ts\nconst a = 1\n```'],
    ['table', '| A | B |\n| --- | --- |\n| 1 | 2 |'],
    ['thematic break', 'Above\n\n---\n\nBelow'],
    ['link', 'See [the brief](docs/product-brief.md) for more.'],
    ['image', 'A figure: ![chart](chart.png)'],
    ['inline code', 'Call `getManuscript()` when you need the bytes.'],
    ['bold', 'This is **load-bearing** and stays.'],
    ['strikethrough', 'That was ~~the plan~~ until Tuesday.'],
  ])('reads %s as Markdown', (_label, text) => {
    expect(looksLikeMarkdown(text)).toBe(true)
  })

  test.each([
    ['plain prose', 'The normal day should involve much less gathering and chasing.'],
    ['multiplication', 'The grid is 2 * 3 * 4 cells deep.'],
    ['snake_case identifiers', 'Call use_font_dir and then rescan_fonts to pick it up.'],
    ['a hash tag mid-sentence', 'File it under #writing when you get a chance.'],
    ['a lone asterisk', 'Footnote marker * appears at the end.'],
    ['empty', '   \n  '],
    ['a bare URL', 'https://example.com/a_b_c'],
  ])('leaves %s alone', (_label, text) => {
    expect(looksLikeMarkdown(text)).toBe(false)
  })

  test('a hash needs a space and a word to be a heading', () => {
    expect(looksLikeMarkdown('#tag')).toBe(false)
    expect(looksLikeMarkdown('# Heading')).toBe(true)
  })

  test('a dash needs a space to be a bullet', () => {
    expect(looksLikeMarkdown('-1 degrees outside')).toBe(false)
    expect(looksLikeMarkdown('- an item')).toBe(true)
  })
})

describe('pasting into the manuscript', () => {
  test('a pasted document becomes headings and lists, not literal hashes', () => {
    const editor = editorWith('')
    const handled = paste(editor, {
      'text/plain': '## What this produces\n\n- One thing\n- Another thing\n',
    })

    expect(handled).toBe(true)
    const markdown = getManuscript(editor)
    expect(markdown).toContain('## What this produces')
    // The proof it parsed rather than escaped: a literal paste would have to
    // write the hashes back out escaped to survive a round trip.
    expect(markdown).not.toContain('\\#')
    expect(editor.state.doc.textContent).not.toContain('##')

    const headings: number[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'heading') headings.push(node.attrs.level as number)
    })
    expect(headings).toEqual([2])
  })

  test('ordinary prose is left to the default paste path', () => {
    const editor = editorWith('')
    expect(
      paste(editor, { 'text/plain': 'The grid is 2 * 3 * 4 cells deep.' }),
    ).toBe(false)
  })

  test('a real HTML flavour wins over the plain-text fallback', () => {
    const editor = editorWith('')
    expect(
      paste(editor, {
        'text/plain': '## Heading',
        'text/html': '<h2>Heading</h2>',
      }),
    ).toBe(false)
  })

  test('a bare meta wrapper is not a real HTML flavour', () => {
    const editor = editorWith('')
    expect(
      paste(editor, {
        'text/plain': '## Heading',
        'text/html': '<meta charset="utf-8">',
      }),
    ).toBe(true)
  })

  test('inside a fenced code block the clipboard stays source', () => {
    const editor = editorWith('```\nconst a = 1\n```\n')
    // Put the caret inside the fence.
    let pos: number | null = null
    editor.state.doc.descendants((node, at) => {
      if (pos === null && node.type.spec.code) pos = at + 1
    })
    expect(pos).not.toBeNull()
    editor.commands.setTextSelection(pos as unknown as number)

    expect(paste(editor, { 'text/plain': '## Not a heading here' })).toBe(false)
  })

  test('CRLF in the clipboard does not reach the document', () => {
    const editor = editorWith('')
    expect(paste(editor, { 'text/plain': '# Title\r\n\r\n- item\r\n' })).toBe(true)
    expect(getManuscript(editor)).not.toContain('\r')
  })
})
