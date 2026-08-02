/**
 * The escaping rules on their own.
 *
 * `roundtrip.test.ts` proves the whole pipeline keeps an author's bytes; this
 * proves the rule that does most of that work is *safe*. Each relaxation is
 * paired with the case it must not relax, because an escape left out where it
 * was needed does not show up as churn — it shows up as the author's prose
 * turning into a link, a code span or emphasis on the next save.
 */
import { describe, expect, test } from 'bun:test'

import { escapeInlineText } from '../src/markdown-escapes'

const escaped = (text: string) => escapeInlineText(text).text

describe('escaping leaves alone what markdown would not read as syntax', () => {
  test('an underscore inside a word is not a delimiter', () => {
    expect(escaped('data_source.md')).toBe('data_source.md')
    expect(escaped('snake_case_identifiers')).toBe('snake_case_identifiers')
  })

  test('an underscore with whitespace on both sides can neither open nor close', () => {
    expect(escaped('# $ % & ~ ^ _ { }')).toBe('# $ % & ~ ^ _ { }')
  })

  test('an ampersand that names no entity stays an ampersand', () => {
    expect(escaped('Tom & Jerry')).toBe('Tom & Jerry')
    expect(escaped('R&D')).toBe('R&D')
  })

  test('a comparison operator is not a tag', () => {
    expect(escaped('5 < 6 > 4')).toBe('5 < 6 > 4')
  })

  test('an isolated asterisk is not emphasis', () => {
    expect(escaped('A literal * star')).toBe('A literal * star')
  })

  test('a backslash before an unescapable character is an ordinary backslash', () => {
    expect(escaped('a word\\ and more')).toBe('a word\\ and more')
  })

  test('brackets that cannot form a link are left as brackets', () => {
    expect(escaped('See [1] and [note]')).toBe('See [1] and [note]')
    expect(escaped('a footnote[^first]')).toBe('a footnote[^first]')
    expect(escaped('[^first]: The first footnote body, defined second.')).toBe(
      '[^first]: The first footnote body, defined second.',
    )
  })

  test('a tilde that cannot open strikethrough is left as a tilde', () => {
    expect(escaped('roughly ~ fifty')).toBe('roughly ~ fifty')
  })
})

describe('escaping still escapes what markdown would read as syntax', () => {
  test('an underscore at a word boundary is escaped', () => {
    expect(escaped('a literal _here_ please')).toBe('a literal \\_here\\_ please')
  })

  test('an ampersand that begins an entity is encoded', () => {
    expect(escaped('&amp; and &#39;')).toBe('&amp;amp; and &amp;#39;')
  })

  test('an angle bracket that could open a tag or an autolink is encoded', () => {
    expect(escaped('<div>')).toBe('&lt;div&gt;')
    expect(escaped('<https://example.com>')).toBe('&lt;https://example.com&gt;')
    expect(escaped('</Callout>')).toBe('&lt;/Callout&gt;')
  })

  test('an asterisk that could delimit emphasis is escaped', () => {
    expect(escaped('a 2*3 product')).toBe('a 2\\*3 product')
  })

  test('a backtick is always escaped', () => {
    expect(escaped('a backtick ` alone')).toBe('a backtick \\` alone')
  })

  test('a backslash before escapable punctuation is doubled', () => {
    expect(escaped('\\*not emphasis\\*')).toBe('\\\\\\*not emphasis\\\\\\*')
  })

  test('brackets that could form a link, image or definition are escaped', () => {
    expect(escaped('[a](b)')).toBe('\\[a\\](b)')
    expect(escaped('![a](b)')).toBe('!\\[a\\](b)')
    expect(escaped('[a][b]')).toBe('\\[a\\]\\[b\\]')
    expect(escaped('[ref]: https://example.com')).toBe('\\[ref\\]: https://example.com')
  })

  test('a tilde that could open strikethrough is escaped', () => {
    expect(escaped('~~struck~~')).toBe('\\~\\~struck\\~\\~')
    expect(escaped('roughly ~50 pages')).toBe('roughly \\~50 pages')
  })
})

describe('escaping reports when it relied on the surrounding document', () => {
  // Bracket and tilde relaxations cannot be proved from one text node alone —
  // the other half of the construct may live in the next one. Flagging them is
  // what makes `serializeBody` re-read the document before trusting the result.
  test('a relaxed bracket is flagged as contextual', () => {
    expect(escapeInlineText('See [1]').contextual).toBe(true)
    expect(escapeInlineText('roughly ~ fifty').contextual).toBe(true)
  })

  test('a relaxed underscore or ampersand needs no such check', () => {
    expect(escapeInlineText('data_source & more').contextual).toBe(false)
  })
})
