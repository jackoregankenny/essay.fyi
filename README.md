# Essay

**Superhuman for unformed documents.**

A local-first desktop writing environment for developing serious documents —
memos, essays, technical proposals, RFCs, board papers — from rough thought
into finished work. The canonical file is plain Markdown. The surface you
write on is a rich, Typora-class manuscript editor, not a raw text box. Typst
renders the designed document live alongside it. Coding agents (via ACP —
opencode, Claude Code) can propose edits to the file, but nothing reaches it
without you deciding: every agent change arrives as a reviewable, structural
diff with provenance.

This is a working pre-1.0 development build, not a finished product. Core
mechanics — editing, rendering, durability, diffs, agent sessions — are built
and exercised, but the interface is still the scaffolding it was built on top
of. A UI overhaul is planned; expect the chrome to change more than the
underlying model does.

## What works today

- **Manuscript editing.** Tiptap-based rich text over Markdown — headings,
  book-style tables, task lists, markdown typing shortcuts — with a verified
  round-trip: what you see is what gets saved back as ordinary Markdown.
- **Live Typst preview and PDF export.** The document renders to typeset
  pages as you write (debounced, non-blocking) and exports to PDF, SVG, or
  PNG via an embedded Typst compiler — no LaTeX, no external toolchain.
- **A durability layer.** Every read is content-hashed; every write is
  hash-guarded, so autosave, an agent, and a `git checkout` can never
  silently clobber each other — conflicts surface instead of vanishing.
  Snapshots, crash recovery for in-progress buffers, and a file watcher that
  catches external edits before you're told about them all sit underneath
  this.
- **Structural diffs.** Changes are reported by section, not just by line —
  edited, moved, added, removed — with a churn score that distinguishes a
  scoped edit from a wholesale rewrite.
- **Reviewable AI agent sessions.** Talk to opencode or Claude Code over ACP
  from a side panel. Proposed file writes become an explicit change set you
  accept or reject; edits agents make directly on disk are caught by the
  same file watcher and shown the same way. No agent writes the manuscript
  without you seeing what changed.
- **Auto-update.** Signed release checks, background download, restart only
  when you say so.

## Quickstart

Prerequisites:

- [Bun](https://bun.sh) (package manager and script runner)
- [Rust](https://rustup.rs) (stable toolchain)
- Tauri 2 platform prerequisites — on Windows: the WebView2 runtime (usually
  preinstalled) and the MSVC Visual Studio Build Tools; see the
  [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for
  macOS/Linux.

```bash
bun install            # workspace install
bun run tauri dev      # full desktop app
bun run dev            # frontend only, Vite on :3000, no Rust build
```

Rust workspace:

```bash
cargo check
cargo test                                                # essay-markdown, essay-diff have real coverage
cargo run -p essay-cli -- outline <file.md>               # heading outline
cargo run -p essay-cli -- diff <a.md> <b.md>               # section-level change summary
cargo run -p essay-cli -- render <file.md> --format pdf    # or svg, png
```

## Principles

- The canonical document is a plain Markdown file, always. No proprietary
  format; the `.essay/` sidecar is safely deletable without losing the
  document.
- AI proposes, the author decides. Agent edits arrive as reviewable change
  sets with provenance — never a silent rewrite.
- Typing and navigation never block on rendering or on AI.
- Fully offline-capable: no accounts, no required network, system fonts.
- File on disk is the source of truth on the Rust side — revisions, diffs,
  and agent patches operate on the Markdown file, never on editor state.

## Layout

```text
apps/desktop/     Tauri 2 app — React chrome + Rust shell (src-tauri/)
packages/         editor (Tiptap surface), theme, commands, document-ui, typst-preview
crates/           Rust core — markdown index, revisions, diff, render, workspace/durability, agents, CLI
templates/        Typst document modes (essay, memo, report, rfc)
fixtures/         Test corpus for parsing, diffing and rendering
docs/             Product brief, architecture, document model, agent protocol, research
```

## Status and roadmap

Milestones 0–4 are in: manuscript editing, Typst rendering, the durability
layer, structural diffs, and the ACP agent host. Next up: hardening the
Markdown round-trip serializer (table padding and list renumbering on save
are known rough edges), a revision timeline over the existing snapshot
history, search / quick-open, packaging, and the planned UI overhaul.

## License

AGPL-3.0-or-later.
