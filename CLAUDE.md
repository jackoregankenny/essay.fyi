# Essay

Local-first desktop writing environment for developing serious documents —
"Superhuman for unformed documents". Tauri 2 (Rust) + React 19 + TanStack
Router + Tiptap 3 (rich manuscript surface) + Tailwind 4 + Typst
(Milestone 2). Bun is the package manager and script runner.
AGPL-3.0-or-later.

The product brief is `docs/product-brief.md`; technical decisions live in
`docs/architecture.md`. Read them before large changes.

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

Milestone 0 (scaffold) complete, plus the first product pass: three-pane
workspace (Structure | Manuscript | Print placeholder) with a rich Tiptap
manuscript — headings, book-style tables, task lists, blockquotes, asterism
section breaks, Literata typography (bundled, offline-safe), markdown
shortcuts, live outline/word count, verified Markdown round-trip via
`editor.getMarkdown()`. Rust heading index (`essay-markdown`) exposed via
the `index_document` Tauri command and `essay outline` CLI. Next:
Milestone 1 — open/save real files, command palette, autosave, crash
recovery, search, packaging.
