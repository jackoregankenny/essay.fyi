# Essay

**Superhuman for unformed documents.**

Essay is a fast, local-first writing environment for developing serious
documents from rough thought into finished work: a source-faithful Markdown
editor, print-quality Typst output, durable revision history and reviewable
AI editing in one focused desktop application.

Free, open source (AGPL-3.0-or-later) and local by default: no account, no
internet connection, no subscription required. The canonical document is
always an ordinary Markdown file.

Read the [product brief](docs/product-brief.md) and
[architecture](docs/architecture.md).

## Getting started

```bash
bun install
bun run tauri dev   # desktop app (starts Vite on :3000, opens the Tauri window)
bun run dev         # browser-only frontend dev, no Rust build
```

Production builds:

```bash
bun run tauri build   # bundled desktop app (installer in target/release/bundle)
bun run build         # frontend-only build to apps/desktop/dist
```

Rust workspace:

```bash
cargo check
cargo test
cargo run -p essay-cli -- outline fixtures/manuscripts/forty-page-essay.md
```

## Layout

```text
apps/desktop/     Tauri 2 app — React chrome + Rust shell
packages/         editor (CodeMirror 6), theme, commands, document-ui, typst-preview
crates/           Rust core — document index, revisions, diffs, render, agents, CLI
templates/        Typst document modes (essay, memo, report, rfc)
fixtures/         Test corpus for parsing, diffs and rendering
docs/             Product brief, architecture, document model, agent protocol
```

## Status

Milestone 0: scaffold. The three-pane workspace (Structure | Manuscript |
Print) runs with live outline, word count and quiet-syntax Markdown editing.
Milestone 1 ("a writer worth using") is next: real file open/save, command
palette, autosave, crash recovery, search, packaging.
