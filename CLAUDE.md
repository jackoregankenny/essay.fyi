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
scroll-spy** with per-section word counts, and **==come back to this==
marks** — `@tiptap/extension-highlight` serializes to Obsidian-compatible
`==…==`, surfaced in the sidebar Marks pane.

**Milestone 2 core is in: Typst rendering.** `essay-render` embeds Typst
0.15 (manual `World` in `world.rs`, embedded fonts via typst-assets,
mdast→Typst emitter in `convert.rs` with escaping + `==highlight==` +
booktabs tables + front-matter lift; template embedded from
`templates/essay/essay.typ`). Outputs: SVG pages (live preview), PDF
(export), PNG (tests/CLI eyeballing). Tauri commands `render_document` /
`export_pdf` run on blocking threads; the frontend debounces (500ms,
latest-wins) in `usePreview.ts` — typing never waits. Ctrl+J toggles the
print pane; `essay render doc.md --format pdf|svg|png` works headless.

Theme follows Linear's extracted tokens (see git history for the research
report): near-black chrome (`--essay-bg`) with the canvas one step lighter
(`--essay-editor-bg`), two border tokens, Geist weights 510/590, accent
caret. Base UI rc.0 gotcha: Dialog popups don't unmount when controlled
`open` flips false — mount `Dialog.Root` conditionally (CommandPalette).
Next: autosave, crash recovery, search, packaging; then Milestone 3
revisions (plan: @pierre/diffs for review surfaces).
