# Getting a manuscript between two desks — research for Essay

**Question.** Jack writes on more than one machine and wants his Markdown in
both places. He does not want us to build a cloud service. What is the
smallest thing Essay can do that moves files between devices *safely* — where
safe means invariant 1 (the file is canonical), invariant 4 (nothing arrives
without the author deciding), and invariant 6 (no accounts, fully offline)?

**Answer up front.** Make a workspace root able to be a **git repository with
a remote**, and let Essay do the fetching, committing and rebasing itself,
presenting any divergence through the review surfaces it already has. Until
that exists (and independently of it), folder-replication tools — Syncthing,
iCloud Drive — already work with what Essay ships today, provided one rule is
documented: never sync `.essay/`.

---

## 1. What Essay already has (this is why the answer is cheap)

Every hard part of file sync is already a shipped, tested behavior:

| Sync problem | Already solved by |
| --- | --- |
| Did the other device change this file? | blake3 content hashes everywhere; `DocumentWatcher` decides by comparing listings/hashes, never by counting events |
| The bytes moved under me while I held the buffer | `WriteOutcome::Conflict` — the save refuses, both versions come back |
| What changed, in reading order? | `essay-diff`: line hunks + structural `SectionChange` with `Moved` detection and `looks_like_a_rewrite()` |
| Show me, and let me decide | `DiffReview`, already hosting agent proposals *and* revision restores |
| Don't lose their version while I read | `ExternalEdit` snapshotted **before** the WebView is told |
| Keep machine state out of the transfer | `.essay/` self-gitignores on creation |

The design work is therefore not "build sync" but "aim the machinery that
already catches agents and `git checkout` at one more source of foreign
writes." That framing matters because it bounds the feature: sync is just
another writer whose edits must arrive as a reviewable change set.

## 2. Recommendation: a root is a repo

Per root, opt-in ("Sync this folder…"):

1. If the folder is not a repo, init one; if it is, adopt it. Attach a remote
   the author names — a private GitHub repo, a bare repo on a NAS, a bare repo
   on a USB stick. Essay has no opinion about which and runs no server.
2. **Commit locally on a writing cadence**, not the autosave one.
   `AUTOSAVE_DELAY` is 1500 ms (`Workspace.tsx`) — committing per autosave
   would mint hundreds of commits an hour and make the reflog useless. Use
   the same shape as `SnapshotStore`'s 5-minute session window: one commit
   per run of typing, plus commits at close/blur. Commit messages are
   mechanical (`Essay: session, 214 words changed`) — the *reviewable* unit
   is the diff, not the message.
3. **Fetch + rebase on open and periodically.** An incoming fast-forward is
   ordinary: the working-tree bytes change, `DocumentWatcher` reports an
   external edit, and the existing reload/keep notice handles it. Nothing new
   happens, which is the point.
4. **Divergence stops everything and opens `DiffReview`.** Rebase hits a
   conflict → abort the rebase, leave both versions on disk (ours in the
   buffer, theirs in a temp file or blob), open DiffReview old/theirs → new/ours
   so it reads forwards, and let the author resolve by editing the manuscript
   itself — then the normal hash-guarded save lands the resolution and the
   rebase completes. No automatic merge of prose, ever: invariant 4 applied to
   your own laptop. Section-level `Moved` detection is what makes these
   reviews readable instead of terrifying.
5. `.essay/` never syncs. It self-gitignores already; keep it out of commits
   even when the ignore file was deleted.

### 2.1 The one real problem: writers don't have git

The audience is writers. Shelling out to `git` assumes a dev machine. Three
options, in the order we should try them:

- **`gix` (gitoxide)** — pure Rust, no system dependency, MIT/Apache. The
  plumbing we need (init, add, commit, fetch, rebase, read blobs) is largely
  present; rebase is the least mature corner. Cost: a real dependency, and
  some operations may need hand-rolling.
- **`git2` (libgit2)** — battle-tested bindings, but C toolchain weight in the
  build and the same API awkwardness around rebases.
- **Shell out to system git** — trivial to build, wrong default audience. Could
  be the MVP fallback with a clear "requires git installed" line, exactly like
  the agent picker's honest "not on PATH".

Auth is the second half of the same problem: SSH keys are a developer ritual.
HTTPS + a personal access token pasted once into the OS keychain (Tauri
keyring plugin) is the writer-shaped path for GitHub; a NAS or USB remote
needs no credentials at all, which makes it the best demo and probably the
best default story.

### 2.2 Prior art (2025–2026)

This exact pattern shipped recently and validates demand: **Tolaria**
(2026) auto-inits every vault as a git repo and treats any remote as sync;
**GitJournal** built its whole product on mobile-Markdown-over-git years ago,
and its maintainer's complaint — "decent desktop apps to sync the data"
don't exist — is precisely the gap an Essay implementation fills. Nobody in
the space is doing git-sync **with a human-review merge surface** rather than
auto-merge; that combination is the differentiator, and we already own the
hard half of it.

## 3. The near-zero-code answer: folder replication, done honestly

Syncthing (device-to-device, no cloud), iCloud Drive, Dropbox: point the
*folder* at them and Essay keeps working, because every inbound change is
just an external edit and the watcher decides by hash.

What we should do now, without building anything:

- Document the setup, with the rule: **exclude `.essay/` from replication.**
  Syncing live SQLite WAL files mid-write corrupts them; the stores are
  disposable by design, but corruption is uglier than absence. Syncthing
  takes `.stignore`; iCloud needs the folder pattern avoided.
- State the honest limitation: this path is last-writer-wins with a conflict
  bar, not a diff review. Safe (the pre-change snapshot means nothing is
  lost — the losing version is always in History) but not *good*. That gap is
  the argument for §2.

## 4. Considered and rejected

- **A hosted sync service.** Forbidden by the brief (no accounts, offline);
  also a permanent operational liability for a product of one.
- **CRDT text merging (Yjs/Automerge/Evolu-style).** The canonical document
  would stop being the file — a shadow representation would be the truth and
  Markdown a projection, breaking invariant 1 at the root. Field evidence
  agrees it's the wrong trade for solo multi-device: Obsidian LocalSync's own
  docs (2026) report interleaved paragraph merges on concurrent edits and
  non-deterministic outcomes when delete races edit — exactly the silent
  rewrite class invariant 4 exists to forbid. "Both edits preserved" sounds
  like safety; for prose it is usually neither sentence reading well.
- **WebDAV/S3 homebrew transport.** Reimplements git's hard problems
  (convergence, conflict detection, atomicity) worse, with a bespoke server
  config surface writers also won't enjoy.
- **Real-time collaboration.** Out of scope of the question; nothing here
  helps or blocks it later except that §2 keeps identity per-file-and-hash,
  which long-form-materials.md already established as the syncable shape.

## 5. Suggested build order

| Slice | Contents | Size |
| --- | --- | --- |
| S0 | Docs page: "Using Essay across devices" (Syncthing/iCloud + the `.essay/` exclusion rule). Ships alone. | S |
| S1 | Repo awareness: detect a root inside a git repo; show it in Settings/root UI; manual "Commit now" using system git if present. No sync yet. | S–M |
| S2 | Bundled engine via `gix`: init/adopt, session-window commits, fetch + ff-only pull on open, incoming handled through the existing external-edit path. | L |
| S3 | Divergence UX: abort-and-review rebase flow wired into `DiffReview`, resolution landing through the hash-guarded write. | M–L |
| S4 | Remote management UI + keychain token auth for HTTPS remotes. | M |

S2 is the risk gate (gix maturity, especially rebase); if it stalls, S1+S0 are
still a coherent release and shell-out-to-git remains the fallback for Jack's
own machines.

## 6. Open questions

- Per-root or per-folder granularity — roots are already the unit of watching
  and listing; repos should follow roots, not subfolders.
- Does History (`.essay/history.sqlite`) want to *import* git history so the
  timeline shows office-machine revisions? Probably yes eventually; snapshots
  are content-addressed, so importing is a walk, not a migration.
- Windows line endings and git's `core.autocrlf` — Essay round-trips CRLF
  deliberately; the repo-side config must never normalize (`* -text` in
  `.gitattributes` written on init, mirroring the `.gitignore` move).
