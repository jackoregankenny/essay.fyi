# Writing

For anyone writing in Essay who wants to know what the manuscript surface
does.

This page describes behaviour rather than pixels. A UI overhaul is planned, so
the arrangement of the chrome will change; what a keystroke does to a document
is the part worth learning.

## The surface is rich text over a Markdown file

You edit the designed document — real headings, real tables, real checkboxes —
and the file on disk stays plain Markdown. There is no source view to switch
to. Saving serializes what you see back to Markdown, and holding that
serialization honest is a standing discipline rather than a solved problem:
see [markdown support](../reference/markdown.md) for exactly what survives a
save and what does not.

## Front matter is held aside, not shown

If your file opens with a YAML block:

```markdown
---
title: A Memo
author: Someone
---
```

**you will not see it in the editor, and you cannot edit it there.** It is
split off when the file is opened, kept verbatim, and put back byte for byte
when the file is saved.

That is deliberate, and the alternative was worse: the parser behind the
manuscript has no notion of front matter, so left to itself it reads the
opening `---` as a section break and the closing one as a heading underline —
and your metadata comes back as `---` followed by `## title: A Memo` on the
next autosave. Holding it aside destroys nothing; parsing it would.

The typeset preview and the PDF *do* read it: `title`, `author` and `date`
become the document's title block. So the way to change front matter today is
to edit the file in something else. A proper non-prose block in the manuscript
is the intended fix.

The same mechanism holds your file's line endings and its trailing blank
lines, which is why a CRLF document does not come back with every line changed
and a file that ends in a list does not grow a blank line on every save.

## Markdown shortcuts

Typing Markdown at the start of a line turns into the thing it describes:

| Type | Get |
| --- | --- |
| `# ` … `###### ` | Heading, levels 1–6 |
| `- `, `* `, `+ ` | Bullet list |
| `1. ` | Ordered list, starting at the number you typed |
| `[ ] ` or `[x] ` at the start of a list item | Task list |
| `> ` | Quote |
| ```` ```lang ```` or `~~~lang` | Code block |
| `---` on its own line (or `***` / `___` and a space) | Section break |

And inline, as you close the second delimiter:

| Type | Get |
| --- | --- |
| `*text*` or `_text_` | Italic |
| `**text**` or `__text__` | Bold |
| `~~text~~` | Strikethrough |
| `` `text` `` | Inline code |
| `==text==` | A come-back-to-this mark |
| `[text](url)` | A link, when you type the closing parenthesis |

The link rule is Essay's own; the rest come from the editor's standard
extension set.

Typography substitutions are on: straight quotes become curly, `--` becomes an
en dash, `...` becomes an ellipsis. These are changes to your text, and they
are written to the file as the characters you see.

## Tables

`Insert table` from the command palette gives a 3×3 with a header row. `Tab`
moves to the next cell, `Shift+Tab` to the previous. Column widths are not
draggable — the table is a book table, sized by the template, not a
spreadsheet.

What matters for the file: Essay's table serializer writes each cell at its
own width rather than padding every cell to the column width, and does not
re-align the divider row. A table you wrote by hand comes back the way you
wrote it.

## Task lists

`- [ ] ` starts one. Clicking a checkbox toggles it, and the file gets `[x]`
or `[ ]`. A capital `[X]` in a file you open is written back lower-case,
because the editor stores a boolean rather than the character.

## `==come back to this==` marks

Select text and press `Ctrl+Shift+H`, or use the highlighter in the selection
toolbar, or type `==like this==`. The mark is written to the file as
`==text==` — the Obsidian form — so it survives in any other editor and is
visible in a diff.

Every mark in the document is listed in the sidebar's Marks pane, in document
order. Clicking one jumps to it. This is the "I will fix this later" mechanism:
a list of unfinished thoughts that lives in the manuscript rather than in a
separate tool.

## The outline

The sidebar lists every heading with the word count of the section it opens —
heading to the next heading of any depth. The entry you are currently writing
in is highlighted, so the outline doubles as a position indicator. Clicking an
entry moves the cursor there.

The command palette carries the same outline under "Jump to section", which is
usually faster than reaching for the sidebar.

## Focus mode and typewriter scrolling

`Toggle focus mode` in the palette dims every block except the one containing
the cursor, and keeps that line vertically centred as you write. The footer
shows `focus` while it is on; clicking that turns it off.

There is no keyboard shortcut for it, deliberately or not — it is a palette
command only.

## Writing width

The footer has a width selector, and the palette command `Writing width`
cycles through the same options:

| Option | Column |
| --- | --- |
| Auto (default) | Scales with the space available, floored at 34rem and capped at 58rem |
| Narrow | 34rem |
| Normal | 42rem |
| Wide | 52rem |
| Full width | Fills the pane |

Auto responds to the panes, not the window: opening the sidebar or the agent
pane narrows the column the way moving to a smaller screen would.

This is a preference about you, not about the document. It is remembered in
the browser store, never written to the Markdown or the sidecar, and it does
not affect the printed page — the print pane keeps the template's geometry.

## The command palette

`Ctrl+K`. It lists every command with its shortcut, then every heading in the
document. Typing filters both: a title that starts with what you typed ranks
first, then a word that starts with it, then a substring, then keywords.

The commands are the same registry the rest of the chrome will use, so
anything you can do from a menu later is here now. See
[shortcuts](../reference/shortcuts.md) for the full list.

## The print pane and PDF

`Ctrl+J` switches between `write` and `preview`. Preview typesets the whole
document through an embedded Typst compiler and shows real pages — the same
engine the PDF export uses, so what you see is what you get.

Compilation runs in Rust on a background thread, 500ms after you stop typing,
and a stale result is dropped if a newer one is already on its way. Typing
never waits for it. While a new compile runs the previous pages stay on
screen, so the pane does not flash.

`Export PDF…` in the palette writes a finished PDF wherever you choose. There
is no LaTeX and no external toolchain, and it works offline. Typesetting uses
the fonts installed on your machine, so a document may set slightly
differently on a computer with a different set — the template names a
preference order rather than one font.

The footer shows the page count while the preview is open.
