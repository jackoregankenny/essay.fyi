# Getting started

For anyone who wants to run Essay and write something in it.

There is no installer to download yet. Essay is a pre-1.0 development build,
so running it means building it. That is three commands once the toolchains
are in place.

## What you need

- [Bun](https://bun.sh) — package manager and script runner.
- [Rust](https://rustup.rs) — stable toolchain.
- Tauri 2's platform prerequisites. On Windows that is the WebView2 runtime
  (usually already installed) and the MSVC Visual Studio Build Tools; for
  macOS and Linux see the
  [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/).

## Running it

```bash
bun install
```

```bash
bun run tauri dev
```

The first build compiles an embedded Typst compiler and its fonts, so expect
several minutes. Later builds are fast.

There is also `bun run dev`, which serves only the React frontend on
`http://localhost:3000`. It is useful for looking at the chrome, but it has no
Rust behind it: no file dialogs, no typeset preview, no agents, no history.
Anything in these docs that touches disk needs `bun run tauri dev`.

## Your first document

Essay opens on an untitled buffer. Type into it, then press `Ctrl+S` to choose
where it lives. From then on the file is an ordinary `.md` file — it opens in
any other editor, commits to Git, and is the only copy of your words that
matters.

`Ctrl+O` opens an existing Markdown file. `Ctrl+N` starts a new one.

For browsing rather than opening one file at a time, click the caret beside
the document's name in the header. That popover holds the file explorer, and
it takes **any number of workspace folders** — Essay has no single-vault
notion. Add a folder and it lists the Markdown under it, skipping hidden
directories and `node_modules`, `target`, `dist`, `build` and `out`.

The sidebar (`Ctrl+B`) is a different thing: it is about navigating *this*
document — the outline, and your `==come back to this==` marks.

The full list is in [keyboard shortcuts](../reference/shortcuts.md).

## More than one document

Saved documents you open in a session appear as tabs beside the file browser.
There is only ever one editor behind them: switching tabs re-reads the file
from disk, which is safe because a saved document has already been written by
autosave before you leave it.

Closing a tab is therefore pure bookkeeping — there is nothing to settle.
Closing the one you are looking at moves to its neighbour, or to a blank
document if it was the last.

The untitled buffer is the exception. It has nowhere to be saved to, so
leaving it with unsaved work asks before discarding.

## Saving, and not having to think about it

Once a document has a path, Essay saves it 1.5 seconds after you stop typing.
The status in the bottom right says `saved`, `saving…`, or — for a buffer that
has never been given a name — `not saved yet`.

Separately, and faster, Essay journals whatever is in the editor 600ms after
your last keystroke. That journal is not the file; it is a crash net, and it
lives outside your folders. An untitled buffer has nowhere to be saved to, so
the journal is the only thing protecting it, which is why it runs first.

## After a crash

On the next launch Essay checks its journal against the files on disk and
offers back anything a file does not already contain. It appears as a bar
above the manuscript:

> Unsaved work from your last session: **draft.md**. — **Restore** ·
> **Discard**

Entries that turn out to match their file are dropped silently rather than
offered. After a clean shutdown that is every entry, and being asked to
"recover" work that was already saved is how a prompt teaches you to dismiss
it without reading.

## When the file changes underneath you

Essay watches the open document. If anything else writes it — an agent, a
terminal, `git checkout`, another editor — you get a bar, not a modal:

> **draft.md** changed on disk, and you have unsaved edits. Both versions are
> in this document's history. — **Review changes** · **Use the file** ·
> **Keep mine**

Reviewing is the primary action on purpose. The other two are only safe to
press once you have seen which one costs you something. The version that
arrived was snapshotted into the document's history *before* you were told
about it, so this is a choice between two versions you still have, not a
rescue.

The same bar appears if a save finds the file already changed. Essay refuses
that write rather than overwriting what arrived; see
[history](./history.md) for where both versions end up.

## What `.essay/` is

The first time Essay records history for a document it creates a `.essay/`
folder beside it:

```text
drafts/
├── draft.md            your manuscript
└── .essay/
    ├── .gitignore      written on creation: "# Essay application state — safe to delete."
    └── history.sqlite  snapshots of this folder's documents
```

Deleting `.essay/` loses your revision history and nothing else. It cannot
corrupt a manuscript, because the manuscript was never in it. The folder
gitignores itself on creation so it stays out of your commits; delete that
`.gitignore` if you would rather track it.

Documents on a read-only volume still open, save and print — they simply have
no history. The sidecar is a convenience, never a precondition.

Every other location Essay writes to is listed in
[storage](../reference/storage.md).

## Next

- [Writing](./writing.md) — what the manuscript surface actually does.
- [Working with agents](./agents.md) — if you want Claude Code or opencode
  editing alongside you.
