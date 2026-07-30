# Architecture

See [product-brief.md](./product-brief.md) for the full brief. This file is
the working summary of the technical shape.

## Layers

```text
Essay application
├── Application chrome        apps/desktop/src (React, TanStack Router)
├── Document workspace        apps/desktop/src + packages/document-ui
├── Editor UI                 packages/editor (CodeMirror 6, React-free)
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
- **CodeMirror 6, not a rich-text editor.** The manuscript is source-faithful
  Markdown; syntax gets visually quiet, never hidden behind an opaque
  rich-text representation. CodeMirror is the *text surface only* — never the
  canonical document model or revision database. (The original scaffold used
  Tiptap; it was replaced because ProseMirror's document model requires
  reserializing the manuscript, which the brief forbids.)
- **Source is canonical.** Parsers produce indexes *over* the source
  (`essay-markdown::DocumentIndex` points into it). Essay never regenerates
  the file through an AST. Unknown syntax survives unchanged.
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
