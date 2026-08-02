# Markdown support

For anyone who needs to know exactly what Essay will and will not do to their
file when it saves.

The canonical document is an ordinary Markdown file, and invariant 2 says
saving must not gratuitously rewrite it. That is a discipline rather than a
finished job, and this page is the honest state of it.

The claims below come from
[`packages/editor/test/roundtrip.test.ts`](../../packages/editor/test/roundtrip.test.ts),
which runs under `bun test` — 71 tests, all passing. The narrative inventory
lives in [`fixtures/README.md`](../../fixtures/README.md) and is the
authoritative version of the tiers below.

## Supported syntax

CommonMark plus GitHub flavour: headings, emphasis, strong, strikethrough,
inline code, fenced and indented code, links, images, ordered and bullet
lists, task lists, tables with alignment, block quotes, horizontal rules,
footnotes, and YAML front matter.

Two beyond that:

- `==highlight==` — Essay's come-back-to-this mark, in the Obsidian form, so
  it survives in other editors.
- `[@key]` — a citation, in Pandoc's form. Put `references.bib` (or
  `references.yml`) beside the manuscript and it typesets as a numbered
  citation with a bibliography after the body. `[@one; @two]` cites both.

  Only the bracketed form counts. A bare `@key` mid-sentence is **not** a
  citation, deliberately: `@` is too common in ordinary prose — addresses,
  handles, `10 @ £4` — for an unbracketed match to be anything but a trap.
  `[see @smith, p. 33]` is not one either; prefixes and locators are not
  supported yet, so that stays literal text.

  With no bibliography file to resolve against, `[@key]` stays exactly as
  typed and the document still typesets. That is why an unsaved draft — which
  has no folder to look in — prints its citations as plain text rather than
  failing to print.

**Maths is not supported.** `$…$` and `$$…$$` survive a save byte-for-byte,
but only because nothing recognises them: the parser runs with GFM
constructs, where maths is off, so they are ordinary paragraph text all the
way through. The typeset page and the PDF print them literally, dollar signs
and all. Round-trip safety here is an accident of not being parsed, not a
feature.

## Tier 1 — byte-identical

These survive a save exactly, including a second and a tenth save. A
regression here is a bug, full stop.

- All three corpus manuscripts (`executive-memo.md`, `technical-rfc.md`,
  `the-shape-of-an-argument.md`) come back byte for byte.
- Ordered lists keep their numbering: `1. 1. 1.` stays all ones, a list
  starting at `7.` starts at seven, and `1)` keeps its parenthesis.
- Bullet markers stay as written — `*`, `-` and `+` are three different
  characters, not three spellings of one.
- Nested lists keep the indentation they were written with, and a list item
  whose text wraps keeps its continuation indent.
- Tables keep each cell at its own width rather than being padded to the
  column, keep their alignment markers, and keep the blank lines around them.
- Task list checkboxes, including one whose text wraps.
- Front matter, byte for byte — because it is never shown to the parser at
  all. It is split off on open and restored on save, which also means it is
  **invisible and uneditable in the editor**; see
  [writing](../guide/writing.md#front-matter-is-held-aside-not-shown).
- A file that ends without a trailing newline stays that way. CRLF line
  endings stay CRLF. Two trailing spaces stay two. These are held aside by the
  same mechanism rather than round-tripped.
- Fenced code keeps its language and its fence width, including a
  four-backtick fence around a three-backtick one; tilde fences stay tildes;
  an indented code block stays indented.
- Syntax the editor has no extension for: `:::note` blocks,
  `{{< shortcode >}}`, `$$…$$` and inline `$…$`, and a bare `$50` that is not
  math.
- Block-level raw HTML, with every attribute: a `<div>`, an HTML comment, a
  `<figure>` between two paragraphs, a bare `<br>`, a self-closing `<hr />`,
  and MDX-style `<Callout type="warning">`.
- Escaped punctuation stays escaped. An underscore inside `snake_case` is not
  emphasis. A bare `&`, `<` and `>` stay bare. `[1]` and `[note]` are not
  links.
- Footnote references and definitions, including definitions written out of
  order.

## Tier 2 — normalised once, then stable

The meaning survives; the bytes change on the first save and never again. If
you open one of these files and save it, expect a one-time diff.

| You wrote | You get |
| --- | --- |
| `Setext Heading` over `===` | `# Setext Heading` |
| `_emphasis_`, `__strong__` | `*emphasis*`, `**strong**` |
| `<https://example.com>` | `[https://example.com](https://example.com)` |
| A backslash at end of line | Two trailing spaces |
| Three trailing spaces | Two |
| `- [X]` | `- [x]` |
| `&amp;` | `&` |
| `> a` then `> > b` | A `>` line between the levels |
| A loose list | Tightened: the blank line between items goes |
| A task list nested two columns in | Re-indented to the six-column checkbox column |
| Two ordered lists separated by a blank line | Merged into one and renumbered |

That last one is the least obvious: the parser reads them as a single list, so
`1./1./1.` followed by `7./8.` comes back `1.`…`5.`

## Tier 3 — destroyed

| You wrote | What is left |
| --- | --- |
| `<abbr title="…">HTML</abbr>` mid-sentence | `HTML` — the tag and its title are gone |
| `[ref]: https://…` definitions | Dropped, and every `[text][ref]` is rewritten as an inline link |

**Block-level raw HTML used to be the whole of this section and is now in
tier 1.** A `<div>` with arbitrary attributes, an HTML comment, a `<figure>`
between two paragraphs, a bare `<br>`, a self-closing `<hr />` and MDX-style
`<Callout type="warning">` all come back byte for byte. Essay holds them in a
block that keeps its own source verbatim; in the editor they appear as
markup behind a dashed rule, which is Essay saying it does not understand
this and is keeping it exactly as written. You can edit it there.

What is left is **inline** HTML — a tag inside a sentence rather than a block
of its own. `@tiptap/markdown` intercepts inline HTML before Essay is
consulted, pairing tags and converting what it recognises into marks, so the
tag itself does not come back. This one needs a change to that library rather
than to Essay.

**If your documents lean on inline HTML tags you cannot afford to lose, that
part is still unsafe.**

## Two constructs that still drift

Everything above is stable after one save. These two are rewritten again on
every save, and both are upstream problems:

- Inline code containing a backtick — `` ``code with a ` backtick`` `` — comes
  back with a single-backtick delimiter that no longer closes where it should.
  The serializer derives a mark's delimiter without seeing its content.
- A fenced block **inside an ordered list item** gains one space of indent per
  save. The upstream tokenizer dedents an item's nested blocks by the width of
  the number rather than of the whole `1. ` marker.

Both are pinned by name in the test suite, so the day either is fixed, a
failing test is what says so.

## What Essay never does to a file

- No added trailing newline, and no line-ending rewriting. Contents pass
  through the write path unnormalised — what the editor serialized is exactly
  what lands on disk.
- No writing over an edit that arrived since the editor last read the file.
  That is a conflict, surfaced to you, not an overwrite.
- No regeneration from the Rust side. `DocumentIndex` is an index *over* the
  source and is never serialized back.

## If you find a new loss

Add it to `fixtures/manuscripts/awkward-syntax.md`, run
`UPDATE_GOLDEN=1 bun test`, and read the diff. The goldens record what the
serializer produces *today*, not what it ought to produce, so that drift shows
up as a failing diff rather than as a quiet change to somebody's manuscript.
