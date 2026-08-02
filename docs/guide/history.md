# History

For anyone who wants to know what Essay remembers about a document, and how to
get an earlier version back.

Editorial history is not undo. Undo answers "what did I type a few seconds
ago?"; history answers "how did this document change over the last week, and
who changed it?"

**There is no revision timeline in the interface yet.** The store underneath
it is complete and has been recording since the first time you opened a
document; the surface that reads it is not built. This page describes what is
being kept and how to reach it in the meantime.

## Where it lives

One SQLite file per folder, shared by the Markdown files in it:

```text
drafts/
├── draft.md
├── notes.md
└── .essay/
    └── history.sqlite    snapshots for both documents, keyed by file name
```

Snapshots are whole documents, addressed by content hash. A forty-page
manuscript is well under a megabyte, and correctness beats clever delta
storage until there is evidence otherwise.

Deleting `.essay/` loses the history and never a document. See
[storage](../reference/storage.md).

## What gets recorded

A revision is written when:

- **You save.** Autosave and `Ctrl+S` both record.
- **You open a document Essay has history for and the bytes have moved on.**
  Something edited it while Essay was not running; that is an external edit,
  not an import.
- **An agent's proposal is accepted**, with the agent's name and the
  instruction that produced it.
- **Anything else writes the file while it is open** — an agent, a terminal,
  `git checkout`. This one is recorded *before* you are told about it, so the
  choice on the notice bar is never a choice about losing something.

Snapshotting is idempotent on content: saving a document that already matches
the newest revision returns that revision rather than growing the timeline.

### Sessions, not autosaves

A run of typing with no five-minute pause collapses into a single revision,
rewritten in place as you go. Without that, a morning's work would be a
hundred rows one keystroke apart. The revision carries the word counts against
its parent, so the timeline can read "+214 / −96 words" for a session rather
than for a save.

The folding only applies to your own typing. An agent patch, an external edit,
an import, a checkpoint or a restore always starts a new revision.

## Who a revision is attributed to

There are no accounts, so the author of your own revisions is whatever the
operating system calls you (`USERNAME` or `USER`), falling back to `you`.

Origins are one of `human_session`, `agent_patch`, `external_edit`, `import`,
`checkpoint`, `restore`. An edit that arrived while an agent had a session
open on that document is filed as `agent_patch` with the agent's name and the
prompt that was running — circumstantial, because the agent never asked
Essay's permission, but more useful than "unknown". Anything else that arrives
from outside is `external_edit` by `unknown`.

## What is kept forever, and what is thinned

Ordinary typing is kept in full for **90 days**. Past that, Essay keeps one
revision per document per calendar day and drops the rest. The newest revision
of a document is always the last one of its own day, so a manuscript nobody
has touched in a year still opens onto the state it was left in.

Thinning touches **only plain human typing** — `human_session`, a human
author, and no recorded instruction. Everything else is kept indefinitely:

- agent patches
- external edits the watcher caught
- the import that starts a timeline
- checkpoints and restores

Those are the revisions somebody goes looking for a year later ("what did the
agent do to chapter three?"). A Tuesday afternoon's autosaves are not. Where
the author is anything but plainly human, or an instruction was recorded, the
row stays: a revision whose value cannot be judged is one to keep.

Housekeeping runs at most once a day per sidecar, when the store opens, and
cannot fail the open — a store that cannot tidy itself must still hand back
your timeline.

## Getting earlier text back

Three routes today, in order of how much you already have.

**The version that just arrived.** When a document changes on disk, the notice
bar's **Review changes** shows exactly what differs, and **Use the file** /
**Keep mine** choose between them. Both versions are in history either way.

**An agent's edit you want undone.** In the agent panel, an `on disk` row
offers **Revert**, which writes your version back over the agent's. It writes
the buffer as it stands now, not a snapshot from when the edit landed — you
may have kept typing, and "mine" means what is on the screen.

**Anything older.** The **History** pane in the sidebar (`Ctrl+B` if it is
closed) lists the document's revisions newest first, each saying what kind of
event it was, who did it, when, and how many words moved. Click one to see it
compared with the document as it stands — old is the revision and new is now,
so the diff reads forwards, as *what has happened since*. **Restore this
version** in that review puts it back.

Restoring is a new state, not a rewind. It goes through the same guard as any
save, so if the file moved while you were reading you get the ordinary
conflict conversation rather than a silent overwrite; and the version you
replaced stays in the timeline, so restoring is itself undoable.

**Mark this version** (in the pane, or the palette) records the document as it
stands as one worth keeping — the draft you sent, the version you read aloud.
It saves first if anything is unsaved, so the mark lands on what you are
looking at.

**By hand.** The data is in `.essay/history.sqlite`, and it is plain SQLite
with two tables:

```bash
sqlite3 .essay/history.sqlite \
  "SELECT id, origin, author_name, datetime(created_at/1000,'unixepoch'), words_inserted, words_removed FROM revisions WHERE doc='draft.md' ORDER BY id DESC LIMIT 20;"
```

```bash
sqlite3 .essay/history.sqlite \
  "SELECT content FROM blobs WHERE hash=(SELECT source_hash FROM revisions WHERE id=42);"
```

Copy what you want back into the document. Essay does not need to be closed to
read the file, but do not write to it by hand.

## What history is not

It is not a backup. It lives beside the document, so it goes when the folder
goes, and it holds nothing your Markdown file does not already hold in its
newest version. It is not synced anywhere, because Essay has no account and
needs no network.

And it is not the crash net. Unsaved buffers are journalled somewhere else
entirely — see [getting started](./getting-started.md#after-a-crash) and
[storage](../reference/storage.md).
