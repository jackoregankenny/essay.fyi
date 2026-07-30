# Essay

Local-first desktop writing environment for developing serious documents —
"Superhuman for unformed documents". Tauri 2 (Rust) + React 19 + TanStack
Router + CodeMirror 6 + Tailwind 4 + Typst (Milestone 2). Bun is the package
manager and script runner. AGPL-3.0-or-later.

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
- `packages/editor/` — CodeMirror 6 manuscript surface. Must stay React-free.
- `packages/theme/` — CSS variables (`--essay-*`), light/dark via
  `prefers-color-scheme`
- `packages/commands|document-ui|typst-preview/` — boundary stubs, grown as
  milestones need them
- `crates/` — Rust core; each crate's `lib.rs` doc comment states its role
- `templates/`, `fixtures/`, `docs/`

## Non-negotiable invariants (from the brief)

1. The canonical document is a plain Markdown file. Never introduce a
   proprietary format; `.essay/` sidecar state must be safely deletable.
2. Never reserialize the manuscript through an AST. Parsed structures
   (`DocumentIndex`) are indexes *over* the source; unknown syntax survives
   unchanged.
3. CodeMirror is the text surface only — not the document model, not the
   revision store.
4. AI proposes; the author decides. Agent edits arrive as reviewable change
   sets with provenance. No silent rewrites.
5. Typing and navigation never block on rendering or AI.
6. Fully offline-capable: no accounts, no required network, system fonts.

## Current state

Milestone 0 (scaffold) complete: monorepo, three-pane workspace shell
(Structure | Manuscript | Print placeholder), CodeMirror Markdown editing
with quiet syntax, heading index in Rust (`essay-markdown`) exposed via the
`index_document` Tauri command and `essay outline` CLI. The UI-side outline
in `apps/desktop/src/lib/outline.ts` is a placeholder to be replaced by the
Rust index. Next: Milestone 1 (open/save real files, command palette,
autosave, crash recovery, search, packaging).
