# Keyboard shortcuts

For anyone who wants the complete list, including the one place two bindings
collide.

`Ctrl` throughout; the application bindings also accept `Cmd`. Editor bindings
use ProseMirror's `Mod`, which is `Cmd` on macOS and `Ctrl` elsewhere.

## Application

Handled by the window, so they work wherever the focus is.

| Shortcut | Does |
| --- | --- |
| `Ctrl+N` | New document. An untitled buffer with unsaved work asks before discarding it. |
| `Ctrl+O` | Open a Markdown file. |
| `Ctrl+S` | Save. The first save asks where. |
| `Ctrl+Shift+S` | Save as. |
| `Ctrl+B` | Toggle the sidebar — **and bold the selection**, see below. |
| `Ctrl+K` | Command palette. |
| `Ctrl+J` | Switch between `write` and `preview`. |
| `Ctrl+Shift+A` | Toggle the agent panel. |

`Ctrl+Shift+A` is shifted deliberately: `Ctrl+A` is select-all, and someone
reaching for it mid-sentence must never lose their selection to a panel.

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
| `Ctrl+B` | Bold — also toggles the sidebar |
| `Ctrl+I` | Italic |
| `Ctrl+Shift+S` | Strikethrough — also opens Save as |
| `Ctrl+E` | Inline code |
| `Ctrl+Shift+H` | `==come back to this==` mark |
| `Ctrl+Alt+1` … `Ctrl+Alt+6` | Heading, levels 1–6 |
| `Ctrl+Alt+C` | Code block |
| `Ctrl+Shift+B` | Quote — also toggles the sidebar |
| `Ctrl+Shift+7` | Ordered list |
| `Ctrl+Shift+8` | Bullet list |
| `Ctrl+Shift+9` | Task list |
| `Ctrl+Enter` | Hard line break |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` or `Ctrl+Shift+Z` | Redo |

`Ctrl+Shift+S` collides the same way `Ctrl+B` does: it strikes through the
selection *and* opens Save as.

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

The palette lists 21 commands and then every heading in the document under
"Jump to section":

| Group | Commands |
| --- | --- |
| File | New document, Open file…, Save, Save as…, Export PDF… |
| View | Toggle preview, Toggle sidebar, Toggle agent panel, Toggle focus mode, Writing width, Toggle dark mode |
| Format | Heading 1, Heading 2, Heading 3, Text, Quote, Code block, Mark to come back to |
| Insert | Insert table, Insert task list, Insert section break |

Four of those have no keyboard shortcut at all and are reachable only here:
**Export PDF…**, **Toggle focus mode**, **Writing width**, and **Toggle dark
mode**.

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
