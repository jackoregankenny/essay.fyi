/**
 * Round-trip fidelity: open a Markdown file in the manuscript surface, save it
 * again, and compare the bytes.
 *
 * Invariant 2 — the file is canonical Markdown and saving must not
 * gratuitously rewrite it — is the only invariant in the product that a test
 * can hold on its own, so this suite is where it lives. It is in three parts.
 *
 *   What must be byte-identical. Anything an author is likely to have written
 *   and did not touch. A failure here is a regression, full stop.
 *
 *   What must at least be stable. A construct the schema cannot model is
 *   allowed to be rewritten once, on the first save. It is not allowed to keep
 *   changing: a file that drifts on every autosave is a file corrupting itself.
 *
 *   What is still lost, recorded exactly. These read as assertions about
 *   *wrong* behaviour on purpose. They are the inventory in fixtures/README.md
 *   made executable, so that fixing one is a visible, deliberate act and
 *   breaking one further is impossible to miss.
 */
import { describe, expect, test } from 'bun:test'

import { changedLines, golden, readFixture } from './corpus'
import { roundTrip } from './harness'

/** Saving `source` gives back exactly `source`. */
function keeps(source: string): void {
  expect(roundTrip(source)).toBe(source)
}

describe('a save that changes nothing writes the file back unchanged', () => {
  test('keeps an ordered list numbered 1. 1. 1.', () => {
    keeps('1. Ordered\n1. All ones on purpose\n1. Renumbering this would be a rewrite\n')
  })

  test('keeps an ordered list that starts at seven', () => {
    keeps('7. Starting at seven\n8. Continuing\n')
  })

  test('keeps an ordered list written with a closing parenthesis', () => {
    keeps('1) One\n2) Two\n')
  })

  test('keeps asterisk and plus bullets as the author wrote them', () => {
    keeps('* Asterisk bullet\n* Second\n\n- Dash bullet\n- Second\n\n+ Plus bullet\n+ Second\n')
  })

  test('keeps a nested list at the indentation it was written with', () => {
    keeps('- One\n  - Nested\n    - Deeper\n- Two\n')
    keeps('1. One\n   1. Nested\n2. Two\n')
  })

  test('keeps a list item whose text wraps onto the next line', () => {
    keeps('- Realises a claim in section nine depends on evidence that has not been\n  introduced until section fourteen\n- Discovers something else\n')
    keeps('1. **One canonical format.** Manuscripts are plain Markdown from commission\n   onward. Production reads that file directly.\n')
  })

  test('keeps a table cell at its own width rather than the column width', () => {
    keeps('| Ragged | Table |\n| --- | --- |\n| a | b |\n| a longer cell than the header | c |\n')
  })

  test('keeps table alignment markers', () => {
    keeps('| Left | Centre | Right |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n')
  })

  test('keeps the blank lines around a table', () => {
    keeps('Before.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter.\n')
  })

  test('keeps a document that ends in a block rather than a paragraph', () => {
    keeps('Before.\n\n- a\n- b\n')
    keeps('Before.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n')
  })

  test('keeps task list checkboxes, including one whose text wraps', () => {
    keeps('- [ ] Unchecked task\n- [x] Checked task\n')
    keeps('- [ ] What is the right behaviour when a section is deleted between proposal\n      and review?\n')
  })

  test('keeps ==highlight== marks in the Obsidian form', () => {
    keeps("Essay's own ==come back to this== marks.\n")
  })

  test('keeps front matter byte for byte', () => {
    keeps('---\ntitle: A Memo\nauthor: Someone\n---\n\nBody text.\n')
  })

  test('keeps a file that ends without a trailing newline', () => {
    keeps('A file that deliberately ends without a trailing newline.')
  })

  test('keeps CRLF line endings', () => {
    keeps('One.\r\n\r\nTwo.\r\n')
  })

  test('keeps a hard break written as two trailing spaces', () => {
    keeps('This line ends with two spaces  \nand continues here.\n')
  })

  test('keeps an underscore inside a word', () => {
    keeps('The file is data_source.md and snake_case_identifiers must survive.\n')
  })

  test('keeps a bare ampersand and comparison operators', () => {
    keeps('Tom & Jerry, and 5 < 6 > 4.\n')
  })

  test('keeps square brackets that are not a link', () => {
    keeps('See [1] and [note] for the reference list.\n')
  })

  test('keeps footnote references and their definitions', () => {
    keeps('A reference to the second footnote[^second] before the first[^first].\n\n[^first]: The first footnote body, defined second.\n[^second]: The second footnote body, defined first.\n')
  })

  test('keeps emphasis, links and images', () => {
    keeps('*Asterisk emphasis* and **double asterisk** and a [link](https://example.com).\n')
    keeps('![alt text](https://example.com/image.png)\n')
  })

  test('keeps a fenced code block, its language and its fence width', () => {
    keeps('```js\nconst x = 1\n```\n')
    keeps('````markdown\n```\nA fence inside a fence, four backticks outside\n```\n````\n')
  })

  test('keeps a tilde fence', () => {
    keeps('~~~python\ndef survive(): pass\n~~~\n')
  })

  test('keeps an indented code block indented', () => {
    keeps('    An indented code block.\n    Four spaces, not a fence.\n')
  })

  test('keeps syntax the editor has no extension for', () => {
    keeps(':::note\nA fenced custom block. The editor has no extension for this.\n:::\n')
    keeps('{{< shortcode param="value" >}}\n')
    keeps('$$\nE = mc^2\n$$\n')
    keeps('Inline math $a^2 + b^2 = c^2$ and a currency amount $50 that is not math.\n')
  })

  test('keeps escaped punctuation escaped', () => {
    keeps('Literal \\*not emphasis\\* and a literal \\_here\\_.\n')
    keeps('Literal \\[a\\](b) brackets that must not become a link.\n')
  })

  /**
   * Raw HTML, which used to be the worst loss in the suite: the schema had no
   * node for it, so a block came back as whatever the parser recognised
   * *inside* it and a comment came back as nothing at all.
   */
  test('keeps a raw HTML block, wrapper and attributes and all', () => {
    keeps(
      '<div class="callout" data-note="unknown to the editor">\n  <strong>Raw HTML block.</strong> Nothing here is Markdown.\n</div>\n',
    )
  })

  test('keeps an HTML comment', () => {
    keeps('<!-- An HTML comment that must not be eaten. -->\n')
  })

  test('keeps raw HTML sitting between prose', () => {
    keeps('Before.\n\n<figure>\n  <img src="a.png">\n  <figcaption>A caption.</figcaption>\n</figure>\n\nAfter.\n')
  })

  test('keeps a self-closing tag and an unclosed one', () => {
    keeps('<hr class="fancy" />\n')
    keeps('<br>\n')
  })
})

describe('the corpus manuscripts survive a save untouched', () => {
  for (const name of ['executive-memo', 'technical-rfc', 'the-shape-of-an-argument']) {
    test(`${name}.md is byte-identical after a save`, () => {
      const source = readFixture(`manuscripts/${name}.md`)
      expect(roundTrip(source)).toBe(source)
    })

    test(`${name}.md is unchanged by a second save`, () => {
      const source = readFixture(`manuscripts/${name}.md`)
      const once = roundTrip(source)
      expect(roundTrip(once)).toBe(once)
    })
  }
})

describe('a file that cannot be preserved is at least not eroded', () => {
  test('a document ending in a list does not grow with repeated saves', () => {
    let document = 'Before.\n\n- a\n- b\n'
    for (let save = 0; save < 10; save += 1) document = roundTrip(document)
    expect(document).toBe('Before.\n\n- a\n- b\n')
  })

  test('a task item whose text wraps does not accumulate code fences', () => {
    let document = '- [ ] A task whose text is long enough to wrap onto a second\n      line here.\n'
    for (let save = 0; save < 5; save += 1) document = roundTrip(document)
    expect(document).toBe('- [ ] A task whose text is long enough to wrap onto a second\n      line here.\n')
  })

  test('a code fence that contains a code fence keeps its wider delimiter', () => {
    let document = '````markdown\n```\ninner\n```\n````\n'
    for (let save = 0; save < 5; save += 1) document = roundTrip(document)
    expect(document).toBe('````markdown\n```\ninner\n```\n````\n')
  })

  test('the constructs that are rewritten are rewritten only once', () => {
    const rewritten = [
      'Setext Heading One\n==================\n\nBody.\n',
      'A [reference link][ref].\n\n[ref]: https://example.com/one "With a title"\n',
      '_Underscore emphasis_ and __double underscore__.\n',
      'An <https://example.com/autolink>.\n',
      'This line ends with a backslash\\\nand continues here.\n',
      '> A block quote\n> > containing a nested block quote\n',
    ]
    for (const source of rewritten) {
      const once = roundTrip(source)
      expect(roundTrip(once)).toBe(once)
    }
  })
})

describe('what a save still loses, recorded so it cannot get quietly worse', () => {
  test('a setext heading becomes an ATX heading', () => {
    expect(roundTrip('Setext Heading One\n==================\n\nBody.\n')).toBe(
      '# Setext Heading One\n\nBody.\n',
    )
  })

  test('a reference link is inlined and its definition disappears', () => {
    expect(
      roundTrip('A [reference link][ref].\n\n[ref]: https://example.com/one "With a title"\n'),
    ).toBe('A [reference link](https://example.com/one "With a title").\n')
  })

  test('an inline HTML tag is unwrapped to its text', () => {
    expect(roundTrip('Inline <abbr title="HyperText Markup Language">HTML</abbr> too.\n')).toBe(
      'Inline HTML too.\n',
    )
  })

  test('underscore emphasis is rewritten as asterisk emphasis', () => {
    expect(roundTrip('_Underscore emphasis_ and __double underscore__.\n')).toBe(
      '*Underscore emphasis* and **double underscore**.\n',
    )
  })

  test('an autolink becomes an ordinary inline link', () => {
    expect(roundTrip('An <https://example.com/autolink>.\n')).toBe(
      'An [https://example.com/autolink](https://example.com/autolink).\n',
    )
  })

  test('a backslash hard break becomes two trailing spaces', () => {
    expect(roundTrip('This line ends with a backslash\\\nand continues here.\n')).toBe(
      'This line ends with a backslash  \nand continues here.\n',
    )
  })

  test('an HTML entity is replaced by the character it names', () => {
    expect(roundTrip('An ampersand &amp; entity.\n')).toBe('An ampersand & entity.\n')
  })

  test('a nested block quote gains a separating marker line', () => {
    expect(roundTrip('> A block quote\n> > containing a nested block quote\n')).toBe(
      '> A block quote\n>\n> > containing a nested block quote\n',
    )
  })

  test('a loose list is tightened', () => {
    expect(roundTrip('1. An ordered item\n\n   with a loose paragraph inside it\n\n2. Second item\n')).toBe(
      '1. An ordered item\n\n   with a loose paragraph inside it\n2. Second item\n',
    )
  })

  test('a nested task list is re-indented to the checkbox column', () => {
    expect(roundTrip('- [ ] Outer\n  - [ ] Inner\n- [ ] Outer two\n')).toBe(
      '- [ ] Outer\n      - [ ] Inner\n- [ ] Outer two\n',
    )
  })

  test('a capital X checkbox is lower-cased', () => {
    expect(roundTrip('- [X] Capital X checked\n')).toBe('- [x] Capital X checked\n')
  })
})

describe('the two constructs that still drift on every save', () => {
  // Both are upstream: the code mark has no way to widen its delimiter, and
  // the ordered-list tokenizer dedents an item's nested blocks by the width of
  // the number rather than of the whole marker. Pinned here so the day either
  // is fixed, this test is what says so.
  test('inline code containing a backtick loses its wider delimiter', () => {
    const once = roundTrip('Inline ``code with a ` backtick``.\n')
    expect(once).toBe('Inline `code with a ` backtick`.\n')
    expect(roundTrip(once)).not.toBe(once)
  })

  test('a fenced block inside an ordered list item gains a space of indent', () => {
    const once = roundTrip('1. An item\n\n   ```js\n   const x = 1\n   ```\n')
    expect(once).toBe('1. An item\n   ```js\n    const x = 1\n   ```\n')
    expect(roundTrip(once)).not.toBe(once)
  })
})

describe('the round-trip adversary', () => {
  const source = readFixture('manuscripts/awkward-syntax.md')

  test('awkward-syntax.md serializes to its recorded golden output', () => {
    const actual = roundTrip(source)
    expect(actual).toBe(golden('roundtrip/awkward-syntax.golden.md', actual))
  })

  test('only the two known drifting constructs move on a second save', () => {
    const once = roundTrip(source)
    const twice = roundTrip(once)
    const moved = changedLines(once, twice).map(line => once.split('\n')[line - 1])
    expect(moved).toEqual([
      'Inline `code`, `code with a ` backtick`, and `triple ` inside`.',
      'self-closing   ',
    ])
  })
})
