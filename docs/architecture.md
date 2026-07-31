# Architecture

See [product-brief.md](./product-brief.md) for the full brief. This file is
the working summary of the technical shape.

## Layers

```text
Essay application
├── Application chrome        apps/desktop/src (React, TanStack Router)
├── Document workspace        apps/desktop/src + packages/document-ui
├── Editor UI                 packages/editor (Tiptap/ProseMirror, framework-agnostic)
├── Document engine           crates/essay-markdown, essay-core
├── Revision engine           crates/essay-revisions, essay-diff
└── Typesetting engine        crates/essay-render (Typst embedded)
```

The first application comes before the framework: boundaries exist from the
start, but the reusable core is extracted from Essay's real requirements
(Milestone 6), not designed up front.

## Decisions of record

- **Tauri 2** desktop shell: Rust backend, OS WebView frontend. We do not
  build a native text-layout engine; browser text infrastructure (IME,
  accessibility, shaping, clipboard) is decades of work we inherit for free.
  *Watched alternative (2026-07-31):* GPUI (Zed's Rust UI framework) — fully
  native apps are appearing on it. Not viable for Essay's manuscript surface
  (no rich-text editor; would forfeit Tiptap/ProseMirror), but a candidate
  for performance-critical native sub-surfaces (e.g. terminal rendering) if
  the webview ever becomes the bottleneck. See
  `docs/research/terminal-embedding.md` for the current webview-vs-native
  analysis.
- **Rich-text manuscript surface (Tiptap/ProseMirror), decided by Jack
  2026-07-31, overriding the brief's CodeMirror section.** You edit the
  designed document — real headings, tables, task lists — Typora-class; this
  is also the seed of the spin-out ambition: the best top-of-funnel editor
  competing with Word. The file on disk stays plain Markdown
  (`@tiptap/markdown`: parse on open, `editor.getMarkdown()` on save).
  **The accepted cost:** saving serializes through ProseMirror, so round-trip
  fidelity is a standing engineering discipline — golden-file round-trip
  tests in `fixtures/`, raw passthrough for unsupported syntax, and
  conservative serializer settings. Known normalization today: table columns
  are re-aligned on serialize. A CodeMirror "view source" mode can return
  later (the implementation lives in git history at the initial commit).
- **On disk, source is canonical.** The Rust side never regenerates the file:
  `essay-markdown::DocumentIndex` is an index *over* the source. Revisions,
  diffs and agent patches operate on the Markdown file, not on editor state.
- **markdown-rs** for parsing (source positions, CommonMark + GFM + MDX +
  math + frontmatter). Fallback if constraining: `pulldown-cmark`.
- **Typst embedded as a Rust library** (Milestone 2). Full-document
  compilation after a short debounce; no incremental typesetting until
  profiling demands it. Preview via PDF.js first, page SVGs later. Typing and
  navigation never wait on rendering or AI.
- **SQLite** for the `.essay` sidecar (revisions, comments, provenance,
  anchors, caches). The manuscript itself must never live only in SQLite.
- **Immutable snapshots** at meaningful boundaries; correctness before
  delta-storage cleverness.
- Planned foundational crates when needed: `tokio`, `notify`, `rusqlite`,
  `similar` (in use), `portable-pty`, `tracing`, `thiserror` (in use). Keep
  all of them replaceable behind Essay-owned interfaces.

## Repository map

```text
apps/desktop/          Tauri app: React chrome + src-tauri shell
packages/editor/       CodeMirror 6 manuscript surface (React-free)
packages/document-ui/  Reusable workspace components (grown over time)
packages/commands/     Command registry backing the palette
packages/typst-preview/ Print view (Milestone 2)
packages/theme/        Design tokens (CSS variables)
crates/                Rust core: see each crate's lib.rs doc comment
templates/             Typst document modes (essay, memo, report, rfc)
fixtures/              Test corpus: manuscripts, diffs, render tests
```

## The hard parts (budget attention here)

1. Making the editor *feel* exceptional — details compound
2. Reconciling arbitrary external edits into reviewable changes
3. Stable block identity in plain text without polluting the manuscript
4. Source→Typst→page mapping (section-level first)
5. Structural diffs that show moves as moves
6. Consistently excellent typesetting across awkward real documents
