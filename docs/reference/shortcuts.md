# Keyboard shortcuts

For anyone who wants the complete list.

`Ctrl` throughout this page; the application bindings also accept `Cmd`. Editor
bindings use ProseMirror's `Mod`, which is `Cmd` on macOS and `Ctrl` elsewhere.

## On a Mac, these are written differently

Essay does not have separate bindings for macOS — the keyboard handler has
always accepted `Cmd` wherever it accepts `Ctrl`. What differs is the **label**.
On macOS every shortcut Essay shows you — in the palette, in tooltips — is drawn
as glyphs in the conventional order: `Ctrl+B` appears as `⌘B`, `Ctrl+Shift+S` as
`⇧⌘S`, with no `+` between them.

| Written here | Shown on macOS |
| --- | --- |
| `Ctrl` | `⌘` |
| `Shift` | `⇧` |
| `Alt` | `⌥` |

The translation happens where a binding is declared (`shortcut()` in
`lib/platform.ts`), not where it is drawn, so every surface that reads the
command registry gets the same label.

## Application

Handled by the window, so they work wherever the focus is.

| Shortcut | Does |
| --- | --- |
| `Ctrl+N` | New document. An untitled buffer with unsaved work asks before discarding it. |
| `Ctrl+O` | Open a Markdown file. |
| `Ctrl+S` | Save. The first save asks where. |
| `Ctrl+Shift+S` | Save as. |
| `Ctrl+B` | Toggle the sidebar. |
| `Ctrl+K` | Command palette. |
| `Ctrl+F` | Find a phrase — opens the palette; see below. |
| `Ctrl+J` | Switch between `write` and `preview`. |
| `Ctrl+Shift+A` | Toggle the agent panel. |

`Ctrl+Shift+A` is shifted deliberately: `Ctrl+A` is select-all, and someone
reaching for it mid-sentence must never lose their selection to a panel.

### `Ctrl+F` opens the palette, not a find bar

There is no find bar. `Ctrl+F` opens the command palette and what you type is
searched — the open manuscript first, then every Markdown file in your workspace
folders, grouped by document under its own title.

The consequences worth knowing:

- Results appear **below** the commands, not instead of them, so a query that is
  also a command name shows you both.
- Nothing happens under two characters, and the folder walk waits until you
  stop typing.
- A hit in another document shows the line it is on; a hit in the document you
  are editing does not. That is deliberate: the open document is searched as
  blocks of text rather than as a file, so its "line 4" is not the file's line
  4, and a number that is nearly right is worse than none.
- Choosing a hit in another document opens it and puts the caret on the phrase.

Not there: find-and-replace, next/previous, regex, and highlighting every match
at once. See [search](../internals/search.md) for why.

### Three bindings used to fire twice

Worth recording, because the shape of the bug recurs whenever a binding is
added. The application handler runs on the window and looked only at the
letter, so the editor's formatting shortcut and the application's own both
took effect on one keypress: `Ctrl+B` bolded *and* toggled the sidebar,
`Ctrl+Shift+B` quoted and toggled it, and `Ctrl+Shift+S` struck through and
opened Save as.

The handler now ignores a keystroke the editor already consumed. It tests
whether the event was *used*, not where it landed — ProseMirror marks
anything it handles, and the editor sees the key first because the
application listener is on `window`, the outermost target. So `Ctrl+B` typed
in the manuscript bolds, and `Ctrl+B` typed in the agent composer still
reaches the sidebar.

Any new application binding that an editor extension also claims will behave
the same way without further work.

## Formatting

Standard editor bindings; they apply to the selection or to what you type
next.

| Shortcut | Does |
| --- | --- |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+Shift+S` | Strikethrough |
| `Ctrl+E` | Inline code |
| `Ctrl+Shift+H` | `==come back to this==` mark |
| `Ctrl+Alt+1` … `Ctrl+Alt+6` | Heading, levels 1–6 |
| `Ctrl+Alt+C` | Code block |
| `Ctrl+Shift+B` | Quote |
| `Ctrl+Shift+7` | Ordered list |
| `Ctrl+Shift+8` | Bullet list |
| `Ctrl+Shift+9` | Task list |
| `Ctrl+Enter` | Hard line break |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` or `Ctrl+Shift+Z` | Redo |

These three — `Ctrl+B`, `Ctrl+Shift+B`, `Ctrl+Shift+S` — are the ones that used
to fire twice. In the manuscript they now format only; from anywhere else they
reach the application binding.

Markdown typing shortcuts — `# `, `- `, `1. `, `> `, `` ` ``, `**bold**`, and
the rest — are in [writing](../guide/writing.md#markdown-shortcuts).

## Lists and tables

| Shortcut | In a list | In a table |
| --- | --- | --- |
| `Tab` | Indent the item | Next cell (adds a row at the end) |
| `Shift+Tab` | Outdent the item | Previous cell |
| `Enter` | Split into a new item | New paragraph in the cell |

## Command palette

| Shortcut | Does |
| --- | --- |
| `↑` / `↓` | Move through results |
| `Enter` | Run the highlighted entry |
| `Escape` | Close |

The palette lists 23 commands, then every heading in the document under "Jump to
section", then the last 12 documents you opened under "Recent files", then
whatever your query finds:

| Group | Commands |
| --- | --- |
| File | New document, Open file…, Save, Save as…, Export PDF…, Mark this version, Find a phrase… |
| View | Toggle preview, Toggle sidebar, Toggle agent panel, Toggle focus mode, Writing width, Toggle dark mode |
| Format | Heading 1, Heading 2, Heading 3, Text, Quote, Code block, Mark to come back to |
| Insert | Insert table, Insert task list, Insert section break |

Five of those have no keyboard shortcut at all and are reachable only here:
**Export PDF…**, **Mark this version**, **Toggle focus mode**, **Writing
width**, and **Toggle dark mode**.

A recent file is matched on its whole path, not just its name, so typing a
folder name is how you tell two `notes.md` apart.

## Reviewing a diff

| Shortcut | Does |
| --- | --- |
| `Escape` | Close the review and return to the manuscript, cursor and scroll intact |

## Agent panel

| Shortcut | Does |
| --- | --- |
| `Enter` | Send the prompt |
| `Shift+Enter` | New line in the prompt |
| `/` at the start of the composer | Offer the agent's slash commands |

## Selection toolbar

Appears over a non-empty text selection outside a code block. In its link
field:

| Shortcut | Does |
| --- | --- |
| `Enter` | Apply the link (an empty field removes it) |
| `Escape` | Cancel and return to the manuscript |
