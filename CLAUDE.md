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
0.15 (manual `World` in `world.rs`, embedded fonts via typst-assets,
mdast→Typst emitter in `convert.rs` with escaping + `==highlight==` +
booktabs tables + front-matter lift; template embedded from
`templates/essay/essay.typ`). Outputs: SVG pages (live preview), PDF
(export), PNG (tests/CLI eyeballing). Tauri commands `render_document` /
`export_pdf` run on blocking threads; the frontend debounces (500ms,
latest-wins) in `usePreview.ts` — typing never waits. Ctrl+J toggles the
print pane; `essay render doc.md --format pdf|svg|png` works headless.

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
`opencode acp` (native) and `npx -y @agentclientprotocol/claude-agent-acp`
(`CreateProcess` only appends `.exe`, so `.cmd` scripts are re-launched via
`cmd /c`). Commands and `essay://agent-event` / `change-set` /
`permission-request` events are registered in `lib.rs`.

Two Windows launch traps live in `registry.rs::which()`, both earned: PATH
resolution considers **PATHEXT candidates only, never the bare name** — Node
ships an extensionless `npx` (a POSIX sh script) beside `npx.cmd`, and
resolving to it is os error 193 wearing a "Claude Code could not start" coat.
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
optional groups). Verified live: the Claude adapter advertises **Model**
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
file on disk really was rewritten. Claude Code's adapter now **launches and
handshakes verified** (real session id, options advertised); whether it
honours `fs` on writes is still open — the live probe hit "OAuth session
expired and could not be refreshed", so answering needs `claude` signed in
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

Next: the round-trip serializer is the real invariant violation and it is
*ours*, not an agent's — `@tiptap/markdown` re-pads table cells and renumbers
ordered lists on every save. Golden tests over `awkward-syntax.md` belong with
that fix. Then the revision timeline on `SnapshotStore`, search / quick-open,
packaging. A **UI overhaul is planned** (Jack, 2026-07-31: the current chrome
was derived from the text editor and that is not the direction) — so harden
the model, keep new UI minimal, and expect the panel/chrome to be redrawn.
Inline agent presence (highlight where the agent is reading/editing, section
markers for pending proposals) is designed for that pass: `toolCall` events
already carry `locations`, and `SectionChange` names the touched headings.
Claude adapter startup is dominated by `npx -y` resolving against the
registry every launch; the known fix is a one-time install under the app data
dir run via `node` directly — not yet built.
