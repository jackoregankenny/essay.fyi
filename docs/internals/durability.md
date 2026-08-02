# Internals: durability

For contributors working on `essay-workspace`, or on anything that writes a
manuscript.

Two rules shape everything in this crate:

1. **The file on disk is canonical.** Every write is guarded by the hash the
   editor last saw.
2. **No edit is lost, whoever made it.** Content is snapshotted before it can
   be replaced, and the in-progress buffer is journalled outside the document
   tree.

## Hash-guarded writes

`read_document` returns `{contents, hash}`, where the hash is blake3 over the
bytes. That hash is the document's identity for the rest of its time open: the
editor hands it back on save as `base_hash`.

`write_document(path, contents, base_hash)` re-reads the file, and if the hash
no longer matches returns `WriteOutcome::Conflict { disk_hash, disk_contents }`
instead of writing. **A conflict is an ordinary outcome, not an error** — the
author asked to save, the world had moved on, and both versions still exist.
The caller decides. That shape is why the WebView can render it as a notice
bar rather than as a failure.

Two deliberate exceptions:

- `base_hash: None` means the caller owns the location outright — a first save
  or a Save As, where the native dialog already asked about replacing.
- A file that has **vanished** is not a conflict. The author's buffer is the
  only surviving copy, and refusing to write would be the lossy choice.

Contents are never normalised in transit: no added trailing newline, no
line-ending rewriting. There is a test for exactly that, because it is the
kind of helpfulness that creeps in.

## Atomic rename

`write_atomic` creates `.<name>.essay-tmp` in the same directory, writes,
`sync_all`s, and renames over the target. `std::fs::rename` replaces an
existing destination on both Unix and Windows. A crash mid-write leaves either
the old document or the new one, never half a manuscript. A failed rename
removes the temp file before returning the error.

Same directory, not a temp dir: a rename across filesystems is a copy, and
loses atomicity.

## The watcher decides by content, never by events

`DocumentWatcher` watches the document's **directory**, not the file — an
editor or agent that replaces the file rather than writing through it would
otherwise take the watch with it. Every event in that directory wakes the
loop, including Essay's own temp file. That is deliberate: filtering by event
path is where watchers get subtle and wrong, and re-reading one small file is
cheaper than being clever.

After a 200ms quiet period the loop reads the file, hashes it, and compares
against `known_hash`. Equal means nothing happened as far as Essay is
concerned. This is what makes a multi-hunk agent write arrive as one change
rather than five, and what makes a `touch` that changes nothing silent.

`notify::recommended_watcher` falls back to a 1s `PollWatcher` when the
platform has no usable native backend — network shares, some Linux
filesystems. Slower, never silently missing a change.

### `expect()` is called before the write, not after

```rust
workspace.watcher.expect(hash_source(&contents));
let outcome = essay_workspace::write_document(file, &contents, base_hash)?;
```

The watcher can observe the file the instant the rename completes, so
announcing the write afterwards would race. Every path that writes the
manuscript does this — the editor's save, and `ChangeSetStore::accept` through
its `before_write` callback. Forgetting it means Essay reports its own save
back to the author as somebody else's edit, which is the most confusing
possible bug in this area.

### Snapshot before notify

In the shell's watcher callback, the arriving content is written to
`SnapshotStore` **before** the event reaches the WebView. That ordering is the
whole guarantee: by the time the author is offered "keep mine or take the
file", neither version can be lost by choosing.

The same callback asks the agent host whether a session was live on that
document, and files the revision as `AgentPatch` by that agent if so. The
attribution is circumstantial — it names the session that was running, not a
request that was made — and the code says so.

## `RootWatcher` is a second watcher, not a generalisation of the first

`roots.rs` watches whole workspace folders so the explorer's tree stays right
when files appear, disappear or are renamed outside Essay. It is deliberately
separate from `DocumentWatcher` because the two answer different questions.
`DocumentWatcher` asks "did the bytes of this one file change?" and hashes to
decide. `RootWatcher` asks "is the listing still right?", where content is
irrelevant and a rename is the entire event.

The discipline is the same, though: **an event is never trusted.** It marks a
root as worth re-reading, and a re-walk of that one root decides by comparing
listings. That is what stops Essay's own autosave redrawing the explorer every
1.5 seconds — a save fires events, the root is re-walked, the listing is
identical, nothing is reported — and it makes Windows' remove+create rename
pairs, whose ordering is not guaranteed, a non-issue rather than a special case.

Quiet period 400ms, longer than the document watcher's 200ms because the work
behind it is a directory walk rather than one small read, and because an author
who has just created a file is not watching the millisecond it appears. Events
under hidden and build directories are dropped before they wake the thread, or
`.git` churn would dominate. The new listing travels with the `RootChange`
event, so nothing asks for the tree again.

`markdown_tree` — the walk itself — lives in this crate rather than in the
shell, so the explorer and the watcher cannot disagree about what a folder
contains.

## Two stores, and why they are separate

| | `SnapshotStore` | `RecoveryStore` |
| --- | --- | --- |
| Lives in | `.essay/history.sqlite`, beside the document | `recovery.sqlite`, in the app data directory |
| Holds | Editorial history of a document | This installation's unsaved buffers |
| Written | On every save and every external edit | 600ms after the last keystroke |
| Scope | Per folder, keyed by file name | Per installation, keyed by path or an untitled session id |

History describes a document and belongs beside it. The journal is machine
state, and it has to work for a document that has **no folder yet** — an
untitled buffer is exactly where a crash costs most.

`RecoveryStore::pending()` drops entries that match their file rather than
offering them. After a clean shutdown that is every entry, and being asked to
recover work that was already saved teaches an author to dismiss the prompt
without reading it.

## WAL and `synchronous = NORMAL`

Both stores set them, and the reasoning is the same in both places, sharper in
the journal.

These stores ride the typing cadence — the snapshot store on every autosave,
the journal 600ms after the last keystroke, on a connection an author is
holding down a key in front of. A full fsync per write is a stall the author
feels as a dropped character, and invariant 5 says typing never blocks. WAL
keeps readers off the writer's back; `NORMAL` hands the decision about when
bytes reach the platter to the OS.

The risk bought is bounded: a power cut can cost the last transaction or two
of *history*, and history is not the document. The Markdown file is, and it is
written separately through a temp file plus `sync_all`.

## Snapshots

Whole sources, content-addressed in a `blobs` table, referenced by a
`revisions` row. Idempotent on hash: snapshotting a source the newest revision
already holds returns that revision.

**The session window.** A `human_session` snapshot that continues the newest
revision — same origin, same author, within `SESSION_GAP_MS` (5 minutes) —
rewrites that revision in place rather than inserting. Word counts are
recomputed against the *parent's* source, so a session reads as "+214/−96
words" for the whole run. Rewriting orphans the source the revision used to
point at, so `prune_orphan_blobs` runs after — by "nothing references this",
never by "the revision I just changed used to", because blobs are shared.

## Pruning

Housekeeping runs in `for_document`, which is called on every save, so the
common path must be one primary-key lookup against a `housekeeping` table that
says "already done today". It is best effort and cannot fail the open:
refusing to hand back a timeline because a maintenance query failed would
trade the author's history for tidiness.

The policy: plain typing older than **90 days** is thinned to the last
revision per document per **UTC calendar day**.

Three parts of that are load-bearing.

- **`PLAIN_TYPING`** is `origin = 'human_session' AND author_kind = 'human'
  AND instruction IS NULL`. Everything else carries provenance and is kept
  forever. A revision whose value cannot be judged is one to keep.
- **UTC, not local time.** The grouping only decides which of a day's
  autosaves survives three months later; a store that thinned differently
  depending on the machine's timezone would be harder to reason about.
- **`relink_parents` runs before the delete.** A survivor whose parent is
  going away inherits the nearest ancestor that stays. Afterwards there is
  nothing left to ask who the deleted row's parent was, and `parent_source` —
  how a continuing session works out its word counts — would find a dangling
  id.

`VACUUM` only when more than 50 rows actually went. It rewrites the whole
file, and paying that on every open is the stall the daily interval and the
row threshold exist to avoid.

The newest revision of a document is always the last one of its own day, so it
always survives: a manuscript nobody has touched in a year still opens onto
the state it was left in.
