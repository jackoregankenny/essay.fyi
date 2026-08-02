# Fixtures

Sample manuscripts and change pairs. Grow this corpus with real-world
documents, awkward syntax, and files that once broke something.

Page counts below are what `templates/essay` currently produces (roughly 200
words to the page); they will move when the template does.

## `manuscripts/`

The document kinds the product brief measures success against, plus the
round-trip adversary.

| File | Exercises | Size |
| --- | --- | --- |
| `the-shape-of-an-argument.md` | Long-form structure: 25 headings, footnotes, tables, task lists, quotes, fences, front matter | 2,049 words / 10pp |
| `executive-memo.md` | Short decision document: recommendation, measured table, action list | 510 words / 4pp |
| `technical-rfc.md` | Specification prose: status block, terminology table, JSON fence, normative language, references | 732 words / 6pp |
| `awkward-syntax.md` | **Round-trip fidelity** — see below | 595 words / 6pp |

`awkward-syntax.md` is the important one. Every construct in it is chosen
because a tool that parses to a tree and serializes the tree back out will
silently normalise it: setext headings, reference links, both emphasis markers,
both hard-break forms, list markers that must not be renumbered, tilde fences,
indented code, raw HTML, footnotes defined out of order, MDX-ish and custom
fenced blocks, and a file that ends without a trailing newline.

Invariant 2 says saving must not gratuitously rewrite the author's Markdown.
This file is how that claim gets tested. The tests live in
`packages/editor/test/roundtrip.test.ts` and run under `bun test`; the other
three manuscripts here are asserted **byte-identical** after a save, and this
one is compared against a recorded golden (see `roundtrip/` below).

### What a save still does to `awkward-syntax.md`

Ranked by how much an author would mind. Everything below is pinned by a test,
so none of it can get quietly worse.

**Destroyed — content or syntax does not survive at all.**

| Construct | What happens |
| --- | --- |
| `<abbr title="…">HTML</abbr>` | Unwrapped to its text; the tag and title are gone. |
| `[ref]: https://…` definitions | Dropped. Every `[text][ref]` is rewritten as an inline `[text](url)`. |

**Block-level raw HTML used to head this table and no longer does.**
`<div class="callout">…</div>`, `<!-- a comment -->`, `<figure>`, a bare
`<br>` and MDX-style `<Callout type="warning">` now all come back byte for
byte, held by a `htmlBlock` node that keeps its own source verbatim
(`packages/editor/src/markdown-html.ts`). Syntax the parser does not read as
HTML was always fine and still is: `:::note` blocks, `{{< shortcode >}}`,
`$$…$$` math and `==highlight==` round-trip exactly.

What remains is **inline** HTML — a tag inside a sentence rather than a block
of its own. That one is not fixable from here: `@tiptap/markdown` intercepts
inline `html` tokens before any extension is consulted, pairing opening and
closing tags and turning what it recognises into marks, so `<abbr>` mid
sentence still loses its tag. Fixing it means changing the library's inline
path rather than adding a node.

**Normalised — the meaning survives, the bytes do not.**

| Construct | Becomes |
| --- | --- |
| `Setext Heading\n===` | `# Setext Heading` |
| `_emphasis_`, `__strong__` | `*emphasis*`, `**strong**` |
| `<https://example.com>`, bare URLs | `[https://example.com](https://example.com)` |
| A backslash hard break | Two trailing spaces |
| `- [X]` | `- [x]` (the schema stores a boolean) |
| `&amp;` | `&` (entities are decoded on the way in and not re-encoded) |
| `\\` before a space | `\` (a backslash only escapes punctuation) |
| Three trailing spaces | Two — the shortest hard break |
| `> a\n> > b` | Gains a `>` line between the levels |
| A loose list | Tightened: the blank line between items goes |
| Two ordered lists separated by a blank line | Merged into one and renumbered — `marked` reads them as a single list, so `1./1./1.` followed by `7./8.` comes back `1.`…`5.` |
| A task list nested two columns in | Re-indented to the six-column checkbox column |

**Still drifting — rewritten again on every save.** Two remain, both upstream,
both pinned by name in the test suite:

- Inline code that contains a backtick (`` ``code with a ` backtick`` ``) comes
  back with a single-backtick delimiter, which no longer closes where it
  should. The serializer derives a mark's delimiter without seeing its content,
  so there is no seam to widen it from.
- A fenced block **inside an ordered list item** gains one space of indent per
  save. The upstream list tokenizer dedents an item's nested blocks by the
  width of the number rather than of the whole `1. ` marker.

Everything else that used to drift now does not: a document ending in a list no
longer grows blank lines (and eventually an `&nbsp;`) on every autosave, a task
item whose text wrapped no longer accumulates a pair of code fences, and a
four-backtick fence keeps its width.

## `roundtrip/`

Golden outputs — what the serializer produces **today**, not what it ought to
produce. They exist so that drift is loud: a change to any construct the round
trip cannot yet preserve shows up as a failing diff rather than as a quiet
change to somebody's manuscript.

- `awkward-syntax.golden.md` — one save of `manuscripts/awkward-syntax.md`.

Regenerate deliberately, and read the diff:

```bash
UPDATE_GOLDEN=1 bun test
```

## `diffs/`

Before/after pairs for text, structural and move-detection diffs, and for the
agent review surface.

- `section-move.before.md` → `section-move.after.md` — one section moves two
  positions. A line diff reports this as a large deletion plus an unrelated
  large insertion; move detection should report it as a move.
- `agent-edit.before.md` → `agent-edit.scoped.md` — one section tightened,
  everything else byte-identical. This is what a well-behaved agent edit looks
  like.
- `agent-edit.before.md` → `agent-edit.rewritten.md` — the *same* editorial
  improvement, produced by regenerating the whole document. Meaning preserved,
  every paragraph reworded, diff proportional to the document rather than to
  the change.

The last two share a base on purpose. They are the test case for "did the agent
edit, or did it rewrite?", and the difference between them is what the review
surface has to make obvious at a glance.

## `render-tests/`

Manuscripts with expected typeset output characteristics. Empty for now; the
Typst pipeline is currently covered by unit tests in `essay-render`.

---

The stable-anchor work (comments and findings surviving edits) is one of the
genuinely hard parts of the product and gets its own evaluation corpus here.
