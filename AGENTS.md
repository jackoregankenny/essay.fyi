# Essay

Local-first desktop writing environment for developing serious documents —
"Superhuman for unformed documents". Tauri 2 (Rust) + React 19 + TanStack
Router + Tiptap 3 (rich manuscript surface) + Tailwind 4 + Typst
(Milestone 2). Bun is the package manager and script runner.
AGPL-3.0-or-later.

The product brief is `docs/product-brief.md`; technical decisions live in
`docs/architecture.md`. Read them before large changes. Deep research
reports (pagination UX, terminal embedding, agent integration/ACP) live in
`docs/research/` — consult before building those areas.

## Commands (run from repo root)

```bash
bun install            # workspace install
bun run dev            # frontend only, Vite on :3000
bun run tauri dev      # full desktop app
bun run build          # frontend production build
bun run typecheck      # tsc over apps/desktop (+ imported packages)
cargo check            # Rust workspace
cargo test             # Rust tests (essay-markdown, essay-diff have real ones)
cargo run -p essay-cli -- outline <file.md>   # working CLI verb
```

## Layout

- `apps/desktop/` — the app: React chrome, file-based routes in `src/routes/`,
  Tauri shell in `src-tauri/` (IPC commands in `src/lib.rs`)
- `packages/editor/` — Tiptap manuscript surface: extension assembly,
  outline/word-count helpers, `prose.css` typography. Framework-agnostic (no
  React); hosts bring their own binding (`@tiptap/react` in the app).
- `packages/theme/` — CSS variables (`--essay-*`), light/dark via
  `prefers-color-scheme`
- `packages/commands|document-ui|typst-preview/` — boundary stubs, grown as
  milestones need them
- `crates/` — Rust core; each crate's `lib.rs` doc comment states its role
- `templates/`, `fixtures/`, `docs/`

## Non-negotiable invariants (from the brief)

1. The canonical document is a plain Markdown file. Never introduce a
   proprietary format; `.essay/` sidecar state must be safely deletable.
2. The manuscript surface is rich text (Tiptap), per Jack's 2026-07-31
   decision overriding the brief's CodeMirror section — Typora-class: edit
   the designed document, file stays Markdown. Round-trip fidelity is a
   standing discipline: saving must not gratuitously rewrite the author's
   Markdown; unknown syntax must survive; grow golden-file tests in
   `fixtures/` with any serializer change.
3. On the Rust side, the file is canonical: `DocumentIndex` is an index
   *over* the source; revisions, diffs and agent patches operate on the
   Markdown file, never on editor state.
4. AI proposes; the author decides. Agent edits arrive as reviewable change
   sets with provenance. No silent rewrites.
5. Typing and navigation never block on rendering or AI.
6. Fully offline-capable: no accounts, no required network, system fonts.

## Current state

Milestone 0 complete plus the first product passes: rich Tiptap manuscript
(headings, book-style tables, task lists, markdown shortcuts, verified
round-trip via `editor.getMarkdown()`), file open/save through native
dialogs (`read_document`/`write_document` commands, Ctrl+N/O/S), and the
Linear/Superhuman-direction chrome: Geist typography (bundled), Phosphor
icons, Base UI primitives (`src/components/ui/`), slim header/footer, and a
**multi-root file explorer** (`ExplorerPane`) built on `@pierre/trees` —
any number of folders, not a single vault; `list_markdown_tree` command
walks each root. Design references of record: diffs.com and trees.software
(Pierre) — plan to use `@pierre/diffs` for Milestone 3/4 review surfaces.
Also done: **command palette** (Ctrl+K — registry preserves registration
order; jump-to-section from the live outline), **selection bubble menu**
(marks + inline link input + highlight), **focus mode with typewriter
scrolling** (current block stays lit and vertically centred;
`setFocusMode`/`TypewriterScroll` in `@essay/editor`), **outline
scroll-spy** with per-section word counts, **==come back to this==
marks** — `@tiptap/extension-highlight` serializes to Obsidian-compatible
`==…==`, surfaced in the sidebar Marks pane — and a **writing-width
preference** (footer select + palette cycle; `lib/measure.ts`, localStorage)
that scopes `--essay-measure` to the manuscript so the print pane keeps the
template's geometry.

**Milestone 2 core is in: Typst rendering.** `essay-render` embeds Typst
0.15 (manual `World` in `world.rs`, mdast→Typst emitter in `convert.rs` with
escaping + `==highlight==` + `[@key]` citations + booktabs tables +
front-matter lift; template embedded from `templates/essay/essay.typ`).
Outputs: SVG pages (live preview), PDF (export), PNG (tests/CLI eyeballing).
Tauri commands `render_document` / `export_pdf` run on blocking threads; the
frontend debounces (500ms, latest-wins) in `usePreview.ts` — typing never
waits. Ctrl+J toggles the print pane; `essay render doc.md --format
pdf|svg|png` works headless. Compiler warnings reach the print pane, grouped
by message (Typst reports per occurrence).

**Fonts are the machine's, not the binary's.** `typst-assets`' `fonts`
feature is off — it was an all-or-nothing 9.23 MB and Essay reached two of
four families. `world.rs` scans via `fontdb`, loading `<app data>/fonts`
*before* the system's so an author's deliberate install wins a name
collision; `use_font_dir` is a `OnceLock` the shell sets, keeping the crate
free of Tauri. The set is an `Arc` behind an `RwLock` (not a `OnceLock`) so
`rescan_fonts()` works without a relaunch. The cost is real and stated:
a document no longer typesets identically on every machine, which is why
`essay.typ` names a font *stack*.

**Citations: `[@key]` → `#cite`, `references.bib` → `#bibliography`.** Only
the bracketed form — a bare `@key` would swallow email addresses. The trap
worth remembering: **`#cite` with no `#bibliography` is a Typst compile
error**, so the bibliography is looked for *before* conversion and decides
whether citations fire at all; otherwise an unsaved draft goes blank the
moment its author types one. `fixtures/citations/` covers both.

**The durability layer is in: `essay-workspace`.** Every read returns a
blake3 content hash; every write hands it back as `base_hash`. A save whose
guard no longer matches disk returns `WriteOutcome::Conflict` with both
versions instead of overwriting — this is what stops autosave clobbering an
agent, a `git checkout`, or another editor. Writes go through a temp file +
rename, so a crash never leaves half a manuscript. Contents are never
normalised in transit (no added trailing newline, no line-ending rewriting).
Three stores:

- `.essay/history.sqlite` beside the document (`SnapshotStore`) — whole
  content-addressed snapshots, idempotent on hash, with a 5-minute session
  window that folds a run of typing into one revision instead of one per
  autosave. Self-`.gitignore`s on creation. Deletable: you lose history,
  never a document.
- `recovery.sqlite` in the app data dir (`RecoveryStore`) — the in-progress
  buffer, journalled 600ms after the last keystroke. Lives outside the
  document tree because it is machine state, and because an *untitled*
  buffer has no folder yet and is exactly where a crash costs most. Entries
  that match their file are dropped rather than offered.
- `DocumentWatcher` (`notify`, directory-scoped, 200ms quiet period, poll
  fallback) — decides purely by content hash, never by counting events.
  `expect(hash)` is called *before* Essay writes so it never reports its own
  save. An external edit is snapshotted as `ExternalEdit` **before** the
  WebView is told, so the author's choice is never a choice about losing it.

Frontend surfaces this as a `Notice` bar (not a modal): reload/keep on a
disk conflict, restore/discard for recovered buffers. Milestone 3 replaces
the conflict bar with a real diff.

Theme follows Linear's extracted tokens (see git history for the research
report): near-black chrome (`--essay-bg`) with the canvas one step lighter
(`--essay-editor-bg`), two border tokens, Geist weights 510/590, accent
caret. Base UI rc.0 gotcha: Dialog popups don't unmount when controlled
`open` flips false — mount `Dialog.Root` conditionally (CommandPalette).
**The diff engine is in: `essay-diff`.** `diff_documents(old, new)` returns
line hunks (3 lines of context, `similar::grouped_ops`) *and* a structural
`SectionChange` list. Sections are flat (heading → next heading of any depth,
plus a preamble) and matched **by heading text, greedily in order** — which is
what makes a reordered section report as `Moved` rather than as a wall of
deletions beside a wall of insertions. `shifted()` compares relative order
among matched sections, so an insertion above does not report everything below
it as moved.

`churn` = touched sections / total sections, and `looks_like_a_rewrite()`
(≥66%, ≥3 sections) is the label that answers *did the agent edit this or
regenerate it?* Verified on `fixtures/diffs/agent-edit.*`, where the scoped
edit and the wholesale rewrite carry the same editorial improvement: 1/4
sections vs 5/6 and flagged. `essay diff <a.md> <b.md>` prints exactly this.

Fixture corpus lives in `fixtures/` — see its README. `awkward-syntax.md` is
the round-trip adversary (still needs a golden test attached).

Gotcha fixed along the way: `essay_markdown::index()` did not enable
front matter, so a YAML block's closing `---` turned the line above into a
setext heading and the whole block landed in the outline. `parse_options()`
is now shared shape with `essay-render`; the two must agree.

**The ACP host is in: `essay-agents`.** `agent-client-protocol` 2.0.
`AgentHost` advertises `fs.readTextFile`/`fs.writeTextFile` and turns
`fs/write_text_file` into a pending `ChangeSet` instead of a write — for
*every* path, not just the open manuscript, because a write Essay cannot show
is the silent rewrite invariant 4 forbids. `fs/read_text_file` serves the
newest pending proposal for a path if there is one, or the agent reads back
its own edit missing and writes again. Accepting goes through the hash-guarded
`write_document` and snapshots as `AgentPatch`/`Agent{name}`; on `Conflict`
the change set stays `Pending` rather than vanishing. Registry covers
`opencode acp` (native) and the Codex adapter — `node <pinned install>`
where `install.rs` has one, `npx -y @agentclientprotocol/Codex-agent-acp`
until then (`CreateProcess` only appends `.exe`, so `.cmd` scripts are
re-launched via `cmd /c`; `node.exe` needs neither). `available` follows the
same rule, so the picker's "not on PATH" line stays true when the launcher is
missing but the install is not. `prepare_adapters(app_data_dir)` in the shell's
setup does the install on a background thread — never a gate in front of a
launch. Commands and `essay://agent-event` / `change-set` /
`permission-request` events are registered in `lib.rs`.

Two Windows launch traps live in `registry.rs::which()`, both earned: PATH
resolution considers **PATHEXT candidates only, never the bare name** — Node
ships an extensionless `npx` (a POSIX sh script) beside `npx.cmd`, and
resolving to it is os error 193 wearing a "Codex could not start" coat.
And a resolved `.cmd`/`.bat` goes through `cmd /c`. A connection that dies
before the handshake answers now reports its real reason on the start button
(the ready channel is shared with the connection task in `acp.rs`), not
"exited during startup". Diagnose launches with
`cargo run -p essay-agents --example probe_claude [agent-id]`; set
`ESSAY_ACP_LIVE_PROMPT=1` to spend one real turn.

**Session options are normalised and exposed.** ACP advertises knobs two ways
— session modes (`session/set_mode`) and config options
(`session/set_config_option`) — and `acp.rs` flattens both into
`SessionOption` lists (`kind: select|toggle`, current value, choices with
optional groups). Verified live: the Codex adapter advertises **Model**
(with pricing), **Effort**, **Agent persona**, and Mode — the last both ways,
which is why `SessionContext` stores `mode_state` and `configs` separately
and the config copy shadows the mode-state one on read (dedup is load-bearing,
not cosmetic). opencode advertises its whole model catalog the same way.
Changes stream back as `options` events (whole-state, never deltas — agents
change these on their own too); `available_commands_update` crosses as
`commands` events and surfaces as slash-completion in the composer.
`agent_session_options` / `set_agent_session_option` are the Tauri commands.
Mid-turn `SetOption` is deliberate: switching out of plan mode while the
agent works is the point of modes.

⚠️ **Advertising `fs` does not mean the agent uses it.** opencode 1.17.8
acknowledges the capability and then writes files with its own tools — zero
`fs/*` requests, zero permission requests, file changed on disk (verified
twice, once by raw JSON-RPC probe; see §8 of the research doc). So agent edits
arrive by **two** paths: intercepted `ChangeSet`s, and the `DocumentWatcher`
catching a direct write after the fact. The watcher path is why the research
ranked file-watch first and said *keep forever*. Be precise about the claim:
nothing is lost, and the author reviews before it reaches the editor — but the
file on disk really was rewritten. Codex's adapter now **launches and
handshakes verified** (real session id, options advertised); whether it
honours `fs` on writes is still open — the live probe hit "OAuth session
expired and could not be refreshed", so answering needs `Codex` signed in
again. That auth failure surfaces in the panel with a what-to-do line
(`absorb()` pattern-matches authentication errors); the fix is the author's
terminal, not Essay.

Frontend: `AgentPanel` is a 340px right column (`Ctrl+Shift+A`, Robot toggle,
palette command); the diff opens `absolute inset-0` over the *manuscript
column only*, so review happens at full measure with the transcript still
beside it. At 1280px the grid is `232px 708px 340px` and prose keeps its full
672px. The panel stays mounted when closed so a running turn survives. The two
arrival paths read differently on purpose: a `PROPOSAL` offers Accept/Reject
and can be dismissed; an `ON DISK` edit offers **Revert**/Keep it and cannot,
because the bytes have landed. `absorb()` folds the event stream — thoughts
arrive *one word per event*, so this is load-bearing.

Panel details that are decisions, not accidents: the agent's knobs live
behind a faders toggle in the header (`OptionsStrip` renders whatever
`SessionOption`s arrive — power, tucked away), option changes are optimistic
locally because a select that snaps back mid-round-trip reads as broken, and
**opening the pane pre-warms the last-used agent** (`essay.agent.v1` in
localStorage) so the adapter's startup seconds pass while the author is still
composing — skipped on battery via `navigator.getBattery`, and never after
the author ends a session, because that was an answer. An idle ACP session
costs tokens only when prompted.

**The `essay` MCP server is not planned** — research recommendation #2 is
dropped, on evidence. Asked to tighten one section of the 22-section fixture,
opencode used `search`/`read`/`edit` and changed **1/22 sections, +7/−8 words**.
It edits rather than regenerates, so the problem `propose_patch` was meant to
solve is not one real agents have. It would not have enforced anything either:
a process with filesystem access can ignore any tool you hand it. Only the
watcher plus the pre-change snapshot actually holds, and that works for agents
that do not exist yet. Re-open this only if churn measurements say otherwise.

Be clear about what ACP earns, too: **not** interception (opencode ignores it)
but a structured transcript, session control, and provenance for watcher-caught
edits. A writer is not the audience for an embedded terminal; that, not
enforcement, is the argument for the panel.

**The revision timeline is in.** A History pane in the sidebar over
`list_revisions`/`revision_source`, with `restore_revision` and
`checkpoint_document` added — which is what finally produces
`RevisionOrigin::Restore` and `::Checkpoint`. Clicking a row opens the
existing `DiffReview` (its `provenance` prop always anticipated "a
revision"); old is the revision, new is now, so the diff reads forwards and
restoring is the way back. Restore is hash-guarded like any write, so it
cannot clobber an edit that landed while the author was reading. Checkpoint
is a *store* method, not a `snapshot()` call: autosave has usually already
recorded those bytes, so idempotence would swallow the mark — relabelling the
existing revision is the honest reading. The pane queries only while open;
the timeline refreshes off `baseHash` rather than from four call sites.

Round-trip: **block-level raw HTML now survives** (`markdown-html.ts`, a
`code: true` node holding its source verbatim, routed by
`markdownTokenName: 'html'`) — `<div>` with attributes, comments, `<figure>`,
`<br>`, and MDX `<Callout>` as a free consequence. **Inline** HTML survives too
now (`markdown-html-inline.ts`) — the earlier "cannot from here" was wrong. It
is true that `@tiptap/markdown` intercepts inline `html` tokens before
extensions are consulted, so the fix is to stop marked *emitting* one: a
`markdownTokenizer` is registered as a marked inline extension, and marked tries
those ahead of every built-in tokenizer. The rule is transcribed from marked's
own `tag` rule so the claimed bytes are unchanged, and the tag becomes a
`code: true` **mark** on its own source rather than an inline node — a node
would close an enclosing link at the tag and reopen it after, turning one link
into three. Price: `<em>word</em>` no longer becomes italic formatting, it stays
literal source. Table re-padding and list renumbering are fixed;
`awkward-syntax.md` has a golden.

**Search is in: `essay-search`.** `search_text` over the open buffer,
`search_project` across the workspace roots, no new third-party dependency — no
regex engine, no index, no directory walker. An index would buy a writer no time they could
perceive and would add a thing that can be stale when an agent rewrites a file
behind Essay's back. Four decisions carry weight. **Offsets are UTF-16**,
because the only consumer that turns an offset into a caret is ProseMirror,
which counts that way; a byte offset lands mid-character on any em dash. For
the same reason the case fold is one char to one char rather than
`to_lowercase`, which changes length on `ß` and shifts every offset after it.
**The excerpt is the sentence, not the line** — a Markdown paragraph is usually
one very long line, so quoting the line is quoting the paragraph; block markers
are stripped as marker-*plus-space* so `**bold**` opening a paragraph is not
mistaken for a bullet. **The open document is searched flattened, not as
Markdown** (`manuscriptText` in `@essay/editor` flattens with a run map, and
`positionAtOffset` is a lookup, not a second search) because an author looking
for "the quick brown" expects to find it whether or not "quick" is bold, and
does not expect a hit inside a link's URL. And **`.essay/` is skipped** — not
tidiness: the sidecar holds every snapshot of every document, so searching it
would answer with every draft that ever contained the phrase. Ctrl+F opens the
command palette and typing runs the search (180ms debounce, min 2 chars, stale
answers dropped); results are *appended* below the commands rather than
re-scored, because the command scorer drops most case-insensitive hits.
Project hits carry a file line number, in-document hits deliberately do not —
the buffer is searched by block, so its "line 4" is not the file's line 4.
Clicking a project hit opens the file and re-finds the phrase in the loaded
buffer, since a file offset says nothing about a ProseMirror position.
Deliberately out: regex, find-and-replace, a persistent find bar, in-editor
highlighting of every match, filename quick-open, and an `essay search` CLI
verb (the crate API is shaped for that last one).

**Essay builds for all three desktops now.** `bundle.targets` is `nsis`, `app`,
`dmg`, `deb`, `appimage` — one list, because tauri-bundler filters configured
types against the host and silently drops the rest. `app` is not decorative:
the macOS updater artifact is `Essay.app.tar.gz` and only exists when that
target is bundled; `appimage` is there because `.deb` is not an updatable
format. `release.yml` is guard → bundle (matrix) → announce, and two things in
it are load-bearing: the matrix is `max-parallel: 1` because tauri-action
builds `latest.json` by read-modify-write on the release's copy and two jobs
finishing together lose a platform's entry — which is not an error anywhere,
just an OS that quietly stops being offered updates — and the release is
**drafted, then published by a final job**, because the updater reads
`releases/latest/download/latest.json` and publishing after the first platform
finishes offers everyone else an update that does not list them. `ubuntu-24.04`
is pinned, not `ubuntu-latest`: the build host sets the glibc floor of every
artifact. macOS builds are unsigned and unnotarised (no Apple secrets), so a
first launch needs right-click → Open; auto-updates are unaffected, since the
minisign key is Essay's own. CI gained a `desktop-linux` job — apt deps,
frontend build (`generate_context!` embeds `dist`), `cargo check -p
essay-desktop` — because until it existed the Tauri shell had never been
compiled on anything but Windows. `check`, not `build`: a Linux-only *link*
error still slips through, and that gap is stated in the comment.

**Cutting a release is `bun run release <patch|minor|major>`.** The version is
written down twice — `tauri.conf.json`, which is the number `latest.json`
serves and the guard job checks, and `[workspace.package]` in `Cargo.toml`,
which nothing checks and which therefore drifts. `scripts/release.mjs` sets
both from one argument, refreshes `Cargo.lock`, commits and tags. It does not
push: pushing is the irreversible half (three platform builds, then a public
release that installed copies fetch within the hour), so `--push` is opt-in and
the undo commands are printed instead. Signing secrets are already on the repo;
as of 2026-08-17 no tag has ever been pushed, so the pipeline is untested end
to end.

**target/ is garbage-collected now, because cargo never does it.** Cargo
addresses artifacts by a metadata hash over the crate's configuration and keeps
every hash it has ever built, forever. Measured 2026-08-17: 34.4 GB, of which
`debug/incremental` alone was 21.4 GB over 353 directories — 229 untouched for
a fortnight against 12 written that day. `scripts/prune-target.mjs` deletes an
entry only if **both** nothing has written to it for `--min-age-days` (7) *and*
it is not among the newest `--keep` hashes for its crate. Both halves are
load-bearing and neither alone is safe: age alone is `cargo sweep --time` and it
is wrong here, because cargo does not touch an artifact it finds fresh, so the
Typst rlib that the next build will link has a six-week-old mtime and deleting
it is minutes of codegen for nothing; hash-rank alone would evict the other
branch the moment you switched, which is what caching is for. Age-based rather
than a size cap despite `size-budget.json` setting the opposite precedent —
enforcing a cap means walking every byte in `target/`, and this runs in front of
`bun run app`. First run reclaimed 17.54 GB. Wired into `dev`/`build`/`tauri`/
`app` as `prune:auto`, throttled to once per 12h by a stamp file, and never
fatal: disk hygiene failing is not a reason to stop someone building.

**There are two Essays, and they can be open at once.**
`tauri.dev.conf.json` is a fourth platform-style config (same RFC 7396 merge,
same repeated-window-geometry cost) and it overrides four things. `identifier`
is the load-bearing one: Tauri derives the app data directory from it, so
`fyi.essay.app.dev` is what gives the dev build its own `recovery.sqlite`,
fonts and pinned adapters. Sharing them is the version that loses a manuscript —
two processes journalling the same buffer, one of them restarted on every
rebuild. Then `productName`, so the installer writes a second app rather than
replacing the one being written in; the window `title`; and the updater, both
halves (dev channel endpoint, `createUpdaterArtifacts` off) — the dev build is
*rebuilt*, never updated, and left on the stable channel it would find the real
release and "update" to it, which now installs a second app instead. The icon
is `icon-dev.svg`, bright red: the ground carries the discrimination because two
icons differing only in one small stroke are two icons you click at random when
tired, and red rather than merely inverted because this is the build that may be
mid-refactor when you reach for it. The window title is the other half of that —
Essay runs `decorations: false` on Windows, so the OS title surfaces only in
Alt-Tab and the taskbar tooltip, which is exactly where you switch between two
copies; `lib/appName.ts` asks the backend for the product name rather than
hardcoding it. Cost, unavoidable: `identifier` is baked in by `tauri-build`, so
alternating between `bun run app` and a plain `tauri dev` recompiles the shell.
`bun run bundle:dev` makes an installable one.

**Window chrome is per-platform, by config file, not at runtime.**
`tauri.macos.conf.json` (decorations on, `titleBarStyle: Overlay`,
`hiddenTitle`) and `tauri.linux.conf.json` (decorations on, the WM draws the
frame); `tauri.conf.json` is untouched so Windows is bit-for-bit what it was.
The reason it is config: `set_decorations` and `set_title_bar_style` have
runtime setters but **`hidden_title` is builder-only** — a window fixed up
after creation would paint the macOS title string across the document tabs with
no way to turn it off. Cost, stated in the `lib.rs` comment: Tauri merges these
with RFC 7396, which replaces arrays wholesale, so `app.windows` cannot be
partially overridden and the platform files repeat the window geometry.
`WindowControls` renders on Windows only, and the header reserves
`TRAFFIC_LIGHT_INSET` (78px) on macOS so the sidebar toggle is not under the
close button. `lib/platform.ts` reads the UA once, synchronously, at module
load — `@tauri-apps/plugin-os` is more authoritative but answers a promise, and
chrome that decides where the buttons go a frame late visibly jumps — and
`shortcut()` translates labels at the point a binding is *declared*: `Ctrl+B`
displays as `⌘B` and `Ctrl+Shift+S` as `⇧⌘S`, in macOS's fixed modifier order.
Nothing there branches on behaviour; the handler always accepted `metaKey`, so
only the labels were lying. Not verified without the hardware: that Overlay
really renders traffic lights over the transparent header, that 78px is right
(macOS has moved it), and whether Linux `decorations: true` reads as a double
titlebar on GNOME/KDE.

**The explorer is finished.** Expansion state persists per root
(`essay.workspace.expanded.v1`, 250 dirs, pruned when folders are saved) — it
had been resetting constantly because the pane is lazy-loaded and unmounts with
its popover. The trap: `initialExpansion` and `initialExpandedPaths` are
*additive* in `@pierre/trees` and `resetPaths` keeps the former, so leaving
`initialExpansion: 1` would silently re-open every top-level folder the author
collapsed, on first render and on every live refresh; the tree is now
`'closed'` plus an explicit set. `loadExpandedDirs` returns `null`, not `[]`,
for an unseen root — "never recorded" and "collapsed on purpose" are different
answers. **Recent files** (12, `essay.recent.files.v1`) are recorded inside
`openDocumentByPath`, the one funnel every open goes through, so no surface can
forget to call it; an entry that fails to open is dropped there rather than
stat-ing every row on render. **`RootWatcher`** (`essay-workspace::roots`) is
deliberately not a generalisation of `DocumentWatcher`: that one asks "did
these bytes change?" and hashes, this asks "is the listing still right?", where
content is irrelevant and a rename is the whole event. Same discipline though —
an event only marks a root dirty, and a re-walk decides by comparing listings,
which is what stops autosave redrawing the explorer every 1.5s and makes
Windows' remove+create rename pairs a non-issue. 400ms quiet period; events
under hidden and build directories are dropped before they wake the thread, or
`.git` churn would dominate. `walk_markdown` moved out of the shell into the
crate as `markdown_tree`, so the explorer and the watcher cannot disagree about
what a folder contains.

**Mermaid diagrams are not planned**, on measurement. A ```` ```mermaid ````
fence already round-trips byte-exactly (`markdown-code.ts` keeps the author's
fence width) and `convert.rs` typesets it as a `#raw` listing, so nothing is
lost — it is simply not drawn. Drawing it costs mermaid, which is 83.5 MB
unpacked across 1171 files and ships a ~2–3 MB chunk bundling d3, dagre,
cytoscape and langium: roughly double `apps/desktop/dist`, which is 1.7 MB
entire. A Typst diagram package (CeTZ, fletcher) is cheap in bytes and does not
answer the question — it is a different authoring language, so it draws no
mermaid and helps the editor not at all, and `world.rs` has no package
resolution, so Typst Universe is out under invariant 6 and it would have to be
vendored. The PDF path is worse again: Typst cannot call a JS library, so it
would mean rendering SVG in the WebView, caching it under `.essay/` for
`#image()` to find, and leaving headless `essay render` printing source for
every diagram the app has not drawn yet. Re-open only if diagrams turn out to
be something authors are actually writing.

**Typesetting is the weakest link, and it is written down.** Rendering has
worked since Milestone 2; every *choice* around it is missing. One template,
welded in with `include_str!` and no override path (the constant's own comment
has promised one since it was written); `templates/memo|report|rfc` are README
files, not templates; `FontsPage` installs families but nothing binds one to a
document, so an author can install a typeface and still have no way to set
their document in it; and there is no flow from "written" to "looks like the
thing I send". `docs/typesetting-backlog.md` has the shape of the answer — a
*format* as a file you can hand to someone, resolved most-specific-first with
the built-in as the fallback rather than the only path, the document's face as
a *stack* (same reasoning that made `essay.typ` name one), and Proof as the
place it all happens. Two invariants bound it: the format is referenced and
never inlined, and importing one is reading a file, never a fetch.

**The welcome is the empty state, and there is a help tab.** `welcome.md` used
to appear exactly once, behind an `essay.welcomed` flag — which meant the person
most likely to want it back, someone who opened Essay, looked around and closed
it, was the one person who could not have it. It is now what an untitled buffer
holds until `hasRealDocuments()` is true (`lib/welcomeState.ts`: a flag set on
the first save, *or* a non-empty recents list, so nobody already using Essay gets
re-welcomed by the change landing). `HelpPanel` lives *in* the footer, at its
trailing edge. It was first built as an absolutely positioned tab in the
bottom-left corner, which put a button over the manuscript at a spot the footer
already owned — two surfaces claiming one corner, and the floating one read as
dropped rather than placed. The footer already housed the one control that is
not a fact about the document, so help is its counterpart (same 13px, same
faint ink, same hover) rather than a new thing to notice — and it sits at the
*opposite* end rather than beside it, because stacked together the two read as
a toolbar forming in the corner and push the word counts off their own margin.
Bracketing keeps the document's facts in the middle and puts the least urgent
control in the room at the far corner, which is where the eye arrives last.
Fixed on the way past: the footer's `ml-auto` was on the status line, which is
`hidden lg:inline`, so under 1024px the element carrying the push disappeared
and everything meant for the right edge packed back against the counts — it now
belongs to a wrapper that always exists. It shows *and* opens: the
newest release's summary and section chips are parsed out of
`content/changelog.md` by `lib/changelog.ts`, because a hand-maintained summary
of a changelog disagrees with it eventually and the wrong copy is always the one
nobody opens. The buttons then open the changelog and the welcome as pathless
manuscripts — Essay's best surface for reading a document is the one it spent
all its effort on, and a reader reimplemented inside a popover would be a worse
one sitting next to it; pathless means you can scribble on the changelog and
nothing is written over. Trap worth keeping: **`Tip` cannot wrap a
`Popover.Trigger`** — it mounts its child through Base UI's `render` prop and
takes the element over, producing a button that tooltips correctly and never
opens. `FilesPanel` hit the same wall; both use the native `title` attribute.

**Discoverability pass, and it was one bug in two places.** Essay's good parts
were reachable by keys nobody had been told about. The Structure panes made it
worse by rendering *only when non-empty* — an author with no tasks was shown
nothing at all about tasks, so "how do I add a todo?" had no answer on screen.
Marks and Tasks now render whether or not they hold anything (an empty pane is
not clutter when it is the only thing saying the feature exists), each pane
header carries a `+` (`SidebarCreate`, routed to the same commands the palette
runs — a second door, not a second implementation), and the two that need a
passage show *disabled with the reason* rather than hidden, because a control
that appears only under conditions you have not worked out is the problem
restated. `ShortcutHints` is the other half: two bindings at a time in the
footer, chosen by what is hardest to discover — comment and mark with a
selection, palette and find without one. Two, never more; a row of eight is a
toolbar with the buttons taken away, and the palette is the honest home for the
long tail. It only ever *describes* — the bindings live in `Workspace`'s keydown
and Tiptap's own `Mod-Shift-h`, and a hint that could drift from its handler
would be worse than none. Comments already had `Ctrl+Alt+M` (what Word and Docs
both bind); it had simply never been visible.

Three UI bugs fixed alongside. The agent option dropdown had `min-w` and no
`max-w`, so an agent catalogue's paragraph-long descriptions set the width —
on a wide monitor, the whole window — and `truncate` never engaged because
there was nothing to truncate against; it now matches `PrintPane`'s
`w-[19rem] max-w-[calc(100vw-2rem)]`. **`color-scheme` was never set**, so
scrollbars, input carets and native focus rings followed the *operating system*
rather than Essay's theme — a light machine running Essay's dark theme got pale
scrollbars down every popup, which is exactly what reads as "this menu is not
themed"; `applyTheme` now sets it, in JS rather than CSS because that is where
`system` is resolved and the two must not disagree. And the comment composer
outlived the author's attention: it is a manuscript layer at the `float` tier,
above `canvas-owner`, so a card left open painted over the Proof pane at widths
where the companion takes the whole canvas. Lowering the tier would be the
wrong fix — it genuinely is cursor-anchored furniture — so it dismisses on an
outside `pointerdown` instead, **only when empty**, because a stray click must
not discard a half-written comment. `pointerdown` rather than focusout:
`onSaveFirst` opens a native dialog, which blurs the window and would read as
leaving.

**The blue that crept in was a missing token.** `--essay-accent-tint` is the
ground for `.essay-action` — "the one verb a surface exists for" — but the
palette had `surface` and `surface-hover` and *nothing* for "this is the
current value". So every control that needed to show a chosen option reached
for the tint, because it was the only thing in the palette that stood out: the
settings segmented controls, the agent skill toggles. A theme picker left a
blue chip sitting in the panel saying nothing except that it had been chosen,
and the one saturated element that is supposed to be the caret turned up in
every panel at once. `--essay-surface-selected` is the fix — a lightness step
past hover at the same near-zero chroma (0.008 against the tint's 0.04), down
in the dark theme's direction and up in the light theme's, because on paper the
ground is already near-white. The rule is written beside `.essay-action` since
that is where the next person will look: **accent marks what you would press;
elevation marks what is merely true.** Deliberately still on the tint: primary
buttons, and the two rewrite signals in `DiffReview` (the callout and the
badge), which flag something worth a second look rather than reporting a state
— both already carry comments saying so.

**And the deeper half: the neutrals were never neutral.** Every grey in the
chrome carried a little blue — chroma 0.003–0.008 at hue 250–260 — invisible on
a border and quite visible across a panel, a popup and a window of chrome. Two
things were wrong with it. That hue is *fixed* while the accent is an author
preference, so choosing violet produced a purple caret in a blue-grey room: two
colours arguing, when the theme's whole claim is one saturated element on a calm
page. And the app read as faintly blue everywhere without anything having
decided to be blue. All nine chrome tokens in both themes are now `oklch(L 0 0)`.
The light theme had already made this exact argument for a single token — its
prose ink is "a near-black that sits on paper without the blue cast that makes
long reading feel like a screen" — and simply never generalised it. Warmth stays
where it was chosen on purpose: the paper canvas (hue 72/90), the prose inks
(75–85), the highlight (92). Those hues are the document; the chrome is not.

**Tasks is a tenant now, in two halves.** It was a third of Structure's shared
column and rendered only when non-empty; Structure is the shape of the argument
and the state of the work is a different question. The pane's *halves* are the
design, and so is the line between them. Above: the document's own `- [ ]`
checkboxes, real Markdown, and they are now **tickable from the pane**
(`setTaskChecked` in `@essay/editor` — `setNodeMarkup` on the item, no selection
change, because someone triaging a list did not ask for the caret to move).
Below: a scratch note in `.essay/`, which is *not* in the document and never
reaches it. Both halves look like notes and behave like notes and exactly one
survives sending the file, so each is labelled with **the consequence** rather
than the storage: "In the document. These travel with the file." against "Not in
the document. Stays on this machine, beside the file." A surface that blurred
them would eventually put a private aside in a published draft, or lose a real
task to a deleted sidecar. Storage is a `scratch` table in `essay-context` —
one row per document, overwritten in place, no history and no tombstone,
deliberately unlike everything else in that store: comments are claims about the
manuscript and must survive being wrong, a scratch note is thinking-out-loud and
versioning it would be filing someone's shopping list. Clearing deletes the row
rather than blanking it, so cleared and never-written are the same state and
`.essay/` carries nothing for a document the pane was merely opened on. Untitled
buffers are gated exactly as comments are — the note lives beside the file.
Structure keeps a one-line count that *points* at the tenant rather than
duplicating the list, because two surfaces listing the same checkboxes is how
they drift.

Next: maths, in-editor find affordances beyond the palette (a find bar,
find-and-replace, match highlighting), and the `essay
inspect / read / search / propose / status` CLI verbs, which still print "not
implemented yet". The **UI overhaul is underway** — direction and build order
in `docs/ui-overhaul.md`, which supersedes the chrome described above. Step 1
(the spine) landed 2026-08-06: gutter + one companion slot
(Structure/Proof/Agent/History, remembered per document) + summoned layers;
document tabs, the write/preview mode switch, and the files popover are gone —
moving between documents is the palette's quick-open (recents + filename
match), and the explorer is a palette-summoned layer. Jack's framing
(2026-08-02): the current UI is a **POC for evaluating features** — build the
feature roughly, end to end, and the style pass makes it good — so features
are worth taking to a usable surface now, and polish is not. Authoring craft
is the overhaul's step 2 and its centre of gravity (Jack, 2026-08-06:
authoring first; typesetting after, in the flow).
Inline agent presence (highlight where the agent is reading/editing, section
markers for pending proposals) is designed for that pass: `toolCall` events
already carry `locations`, and `SectionChange` names the touched headings.
Codex adapter startup used to be dominated by `npx -y` resolving against the
registry every launch; it is now a one-time pinned install under the app data
dir run via `node` directly (`install.rs`, measured 1.3s vs 2.7s to handshake).
