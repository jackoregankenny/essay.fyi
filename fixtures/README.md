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
This file is how that claim gets tested. It has no golden-file test attached
yet — writing one is the next piece of work it exists for.

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
