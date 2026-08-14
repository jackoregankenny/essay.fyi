/**
 * Front matter is edited in place in the author's file, so most of what these
 * tests assert is what did *not* change: the other keys, their order, the
 * comments between them, the line endings, and the body below. A test here
 * that only checks the key it set would pass while the document rotted around
 * it.
 *
 * The parity block mirrors `parse_front_matter` in
 * `crates/essay-render/src/convert.rs`. Those cases are odd on purpose — they
 * are the renderer's quirks, and a drift between the two sides means the UI
 * would start reporting a page the typesetter is not setting.
 */
// @ts-ignore - `bun:test` has no types installed: the app's tsconfig covers
// `**/*.ts`, and CI installs with `--frozen-lockfile`, so adding `@types/bun`
// for one import is not free. The runner resolves it; only tsc cannot.
import { describe, expect, test } from 'bun:test'

import { readFrontMatter, setFrontMatterKeys } from './frontMatter'

describe('reading', () => {
  test('a document with no block has no front matter', () => {
    expect(readFrontMatter('# A memo\n\nBody.\n')).toEqual({})
  })

  test('keys come back lowercased, values exactly as written', () => {
    const source = '---\nTitle: A Memo\nformat: Essay\n---\n\nBody.\n'
    expect(readFrontMatter(source)).toEqual({ title: 'A Memo', format: 'Essay' })
  })

  test('a thematic break in the body is not a delimiter', () => {
    const source = 'Some prose.\n\n---\n\nformat: essay\n\n---\n\nMore prose.\n'
    expect(readFrontMatter(source)).toEqual({})
  })

  test('a document opening on a thematic break is not front matter', () => {
    expect(readFrontMatter('---\n\nJust a rule above the prose.\n')).toEqual({})
  })

  test('quoting styles all unquote to the same value', () => {
    const source = '---\na: essay\nb: "essay"\nc: \'essay\'\n---\n'
    expect(readFrontMatter(source)).toEqual({ a: 'essay', b: 'essay', c: 'essay' })
  })

  test('a value containing a colon survives its quotes', () => {
    expect(readFrontMatter('---\ntitle: "Essay: a memo"\n---\n')).toEqual({
      title: 'Essay: a memo',
    })
  })
})

describe('reading matches the renderer', () => {
  test('an empty value reads as absent', () => {
    expect(readFrontMatter('---\nformat:\ntitle: A Memo\n---\n')).toEqual({
      title: 'A Memo',
    })
  })

  test('lines without a colon are skipped', () => {
    expect(readFrontMatter('---\n# a comment\n\nformat: essay\n---\n')).toEqual({
      format: 'essay',
    })
  })

  test('an unbalanced quote is stripped anyway', () => {
    expect(readFrontMatter('---\nformat: "essay\n---\n')).toEqual({ format: 'essay' })
  })

  test('the last of two declarations wins', () => {
    expect(readFrontMatter('---\nformat: essay\nformat: report\n---\n')).toEqual({
      format: 'report',
    })
  })

  test('an indented line is read as a top-level pair', () => {
    expect(readFrontMatter('---\ntypst:\n  format: essay\n---\n')).toEqual({
      format: 'essay',
    })
  })
})

describe('creating a block', () => {
  test('a document with none gets one at the very top', () => {
    const source = '# A memo\n\nBody.\n'
    expect(setFrontMatterKeys(source, { format: 'essay' })).toBe(
      '---\nformat: essay\n---\n\n# A memo\n\nBody.\n',
    )
  })

  test('several keys keep the order they were given', () => {
    expect(setFrontMatterKeys('Body.\n', { format: 'essay', font: 'Iowan Old Style' })).toBe(
      '---\nformat: essay\nfont: Iowan Old Style\n---\n\nBody.\n',
    )
  })

  test('a body opening on a thematic break is left alone', () => {
    const source = '---\n\nJust a rule above the prose.\n'
    expect(setFrontMatterKeys(source, { format: 'essay' })).toBe(
      `---\nformat: essay\n---\n\n${source}`,
    )
  })

  test('removing a key from a document with no block adds nothing', () => {
    const source = '# A memo\n\nBody.\n'
    expect(setFrontMatterKeys(source, { format: null })).toBe(source)
  })

  test('an empty update adds nothing', () => {
    const source = '# A memo\n\nBody.\n'
    expect(setFrontMatterKeys(source, {})).toBe(source)
  })
})

describe('editing an existing block', () => {
  const source = [
    '---',
    'title: A Memo',
    '# how it should be dressed',
    'format: essay',
    '',
    'author: Jack',
    '---',
    '',
    '# A memo',
    '',
    'Body with a --- rule below.',
    '',
    '---',
    '',
    'More.',
    '',
  ].join('\n')

  test('a new key is added before the closing delimiter', () => {
    expect(setFrontMatterKeys(source, { font: 'Iowan Old Style' })).toBe(
      source.replace('author: Jack\n---', 'author: Jack\nfont: Iowan Old Style\n---'),
    )
  })

  test('changing a value leaves every other byte alone', () => {
    expect(setFrontMatterKeys(source, { format: 'report' })).toBe(
      source.replace('format: essay', 'format: report'),
    )
  })

  test('removing a key leaves the rest in order', () => {
    expect(setFrontMatterKeys(source, { format: null })).toBe(
      source.replace('format: essay\n', ''),
    )
  })

  test('comments, blank lines and unrelated keys all survive a round of edits', () => {
    const edited = setFrontMatterKeys(source, { format: 'report', font: 'Charter' })
    expect(edited).toContain('# how it should be dressed')
    expect(edited).toContain('title: A Memo')
    expect(edited).toContain('\n\nauthor: Jack')
    expect(edited.slice(edited.indexOf('\n---\n') + 5)).toBe(
      source.slice(source.indexOf('\n---\n') + 5),
    )
  })

  test('setting a key to the value it already has writes nothing', () => {
    const quoted = '---\nformat: "essay"\n---\n\nBody.\n'
    expect(setFrontMatterKeys(quoted, { format: 'essay' })).toBe(quoted)
  })

  test('removing a key that is not there writes nothing', () => {
    expect(setFrontMatterKeys(source, { font: null })).toBe(source)
  })

  test('the key is matched case-insensitively and keeps its spelling', () => {
    const titled = '---\nFormat: essay\n---\n\nBody.\n'
    expect(setFrontMatterKeys(titled, { format: 'report' })).toBe(
      '---\nFormat: report\n---\n\nBody.\n',
    )
  })

  test('indentation and the gap after the colon are preserved', () => {
    const spaced = '---\n  format:\t\tessay\n---\n\nBody.\n'
    expect(setFrontMatterKeys(spaced, { format: 'report' })).toBe(
      '---\n  format:\t\tessay\n---\n\nBody.\n'.replace('essay', 'report'),
    )
  })

  test('a key written with no gap gets one', () => {
    expect(setFrontMatterKeys('---\nformat:essay\n---\n', { format: 'report' })).toBe(
      '---\nformat: report\n---\n',
    )
  })

  test('every declaration of a removed key goes', () => {
    const twice = '---\nformat: essay\ntitle: A Memo\nformat: report\n---\n\nBody.\n'
    expect(setFrontMatterKeys(twice, { format: null })).toBe(
      '---\ntitle: A Memo\n---\n\nBody.\n',
    )
  })
})

describe('emptying a block', () => {
  test('removing the last key removes the delimiters and the blank line', () => {
    const source = '---\nformat: essay\n---\n\n# A memo\n\nBody.\n'
    expect(setFrontMatterKeys(source, { format: null })).toBe('# A memo\n\nBody.\n')
  })

  test('a body that opens on a thematic break comes back intact', () => {
    const body = '---\n\nJust a rule above the prose.\n'
    expect(setFrontMatterKeys(`---\nformat: essay\n---\n\n${body}`, { format: null })).toBe(body)
  })

  test('a comment keeps the block alive', () => {
    const source = '---\n# how it should be dressed\nformat: essay\n---\n\nBody.\n'
    expect(setFrontMatterKeys(source, { format: null })).toBe(
      '---\n# how it should be dressed\n---\n\nBody.\n',
    )
  })
})

describe('line endings', () => {
  const crlf = '---\r\ntitle: A Memo\r\n---\r\n\r\n# A memo\r\n\r\nBody.\r\n'

  test('a CRLF block reads the same as an LF one', () => {
    expect(readFrontMatter(crlf)).toEqual({ title: 'A Memo' })
  })

  test('a key added to a CRLF document stays CRLF', () => {
    expect(setFrontMatterKeys(crlf, { format: 'essay' })).toBe(
      '---\r\ntitle: A Memo\r\nformat: essay\r\n---\r\n\r\n# A memo\r\n\r\nBody.\r\n',
    )
  })

  test('a block created in a CRLF document is written CRLF', () => {
    expect(setFrontMatterKeys('# A memo\r\n\r\nBody.\r\n', { format: 'essay' })).toBe(
      '---\r\nformat: essay\r\n---\r\n\r\n# A memo\r\n\r\nBody.\r\n',
    )
  })

  test('emptying a CRLF block leaves the body CRLF and unchanged', () => {
    expect(setFrontMatterKeys(crlf, { title: null })).toBe('# A memo\r\n\r\nBody.\r\n')
  })

  test('an LF document never grows a carriage return', () => {
    const lf = '---\ntitle: A Memo\n---\n\nBody.\n'
    expect(setFrontMatterKeys(lf, { format: 'essay' })).not.toContain('\r')
  })
})

describe('quoting round-trips', () => {
  const cases: Array<[string, string]> = [
    ['a plain value', 'essay'],
    ['a value with a colon', 'Essay: a memo'],
    ['a value with leading space', '  essay'],
    ['a value with trailing space', 'essay  '],
    ['a value with a hash', 'Iowan #2'],
    ['a value with a double quote', 'the "essay" format'],
    ['a value that looks quoted', '"essay"'],
  ]

  for (const [name, value] of cases) {
    test(`${name} survives a write and a read`, () => {
      const written = setFrontMatterKeys('Body.\n', { font: value })
      expect(readFrontMatter(written).font).toBe(value)
    })
  }

  test('a value that needs no quoting is written bare', () => {
    expect(setFrontMatterKeys('Body.\n', { format: 'essay' })).toContain('format: essay\n')
  })

  test('a value needing quotes is quoted', () => {
    expect(setFrontMatterKeys('Body.\n', { title: 'Essay: a memo' })).toContain(
      'title: "Essay: a memo"\n',
    )
  })
})
