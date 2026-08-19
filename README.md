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
mechanics — editing, rendering, durability, diffs, search, agent sessions — are
built and exercised, but the interface is still the scaffolding it was built on
top of. A UI overhaul is planned; expect the chrome to change more than the
underlying model does.

Windows is the platform Essay has actually been run on. It now builds and
bundles for macOS and Linux too, and both have their own window chrome, but
neither has been launched by anyone yet — see
[release](docs/internals/release.md#what-is-not-verified) for exactly what that
leaves unverified.

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
- **A revision timeline.** Every save, agent patch and edit made outside
  Essay is snapshotted; the History pane lists them, diffs any of them against
  the document now, and restores one through the same hash guard as any other
  write — so going back is itself undoable.
- **Citations and a bibliography.** Write `[@key]` and put `references.bib`
  beside the manuscript; it typesets with a numbered bibliography. Nothing to
  configure, and no LaTeX.
- **Reviewable AI agent sessions.** Talk to opencode or Claude Code over ACP
  from a side panel. Proposed file writes become an explicit change set you
  accept or reject; edits agents make directly on disk are caught by the
  same file watcher and shown the same way. No agent writes the manuscript
  without you seeing what changed.
- **Search across the manuscript and your folders.** `Ctrl+F` finds a phrase in
  the document you are editing and in every Markdown file in your workspace
  folders, grouped by document and titled by its first heading. No index to
  build and nothing to go stale.
- **A multi-root file explorer.** Any number of folders, never a single vault.
  It remembers what you left open, lists what you opened recently, and updates
  itself when files appear, disappear or are renamed outside Essay.
- **Auto-update.** Signed release checks, background download, restart only
  when you say so. Installers build for Windows, macOS and Linux.

Full documentation — guides, reference, and internals — is in
[docs/README.md](docs/README.md).

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
- Periodic work backs off on battery. Long-form writing happens unplugged;
  see [Battery](#battery) for what that costs and what it deliberately spares.
- File on disk is the source of truth on the Rust side — revisions, diffs,
  and agent patches operate on the Markdown file, never on editor state.

## Battery

Someone writing a long document is doing it for hours, often in a chair with no
socket near it. That is the actual use, so the cost of running is a feature and
not an afterthought.

**What costs battery is wakeups, not work, and not the GPU.** The intuition that
GPU rendering is the expensive part is backwards: a glyph atlas makes redrawing
text nearly free, while compositing the same text on the CPU every frame is not.
What drains a laptop is the processor being pulled out of its idle states over
and over — timers firing, disks being written, subprocesses spawned — each of
which costs more in the waking than in the doing.

By that measure Essay has one dominant cost: **the Typst compile behind the
preview.** Typst is single-pass with no incremental mode across invocations, so
every expiry of the preview debounce re-typesets the whole document. An hour of
writing with Proof open is hundreds of full compiles. Nothing else in the app is
in the same order of magnitude, and — worth saying, because it is the usual
reason to reach for a native UI toolkit — this cost is *identical* whatever
renders the window. It is a Rust thread either way.

So the lever is the interval, not the framework:

- **The preview debounce is 500ms on mains and 1500ms on battery**
  (`lib/usePreview.ts`). 1500ms sits past a between-sentence pause rather than
  inside it, so what it catches is genuinely "stopped typing" and a burst of
  edits collapses into one compile instead of several. The preview is slower on
  battery, deliberately: the author asked for the pane, not for the update rate.
- **Power state is followed live, not sampled once** (`lib/power.ts`). The
  interesting moment is someone unplugging mid-session, which is exactly when a
  check taken at startup is wrong for the rest of the afternoon.
- **The agent pre-warm is skipped on battery** — it spawns a subprocess nobody
  has asked for yet.

Two things are deliberately *not* backed off:

- **The 600ms recovery journal, and autosave at 1.5s.** These are the crash
  safety net. Lengthening them trades someone's unsaved paragraph for a little
  power, which is the wrong way round at any exchange rate.
- **The watcher's poll fallback** (1s document, 2s roots). `PollWatcher` is
  only constructed when the platform's native backend fails — network shares,
  some Linux filesystems — so on a local disk it never runs at all. Making it
  power-aware means tearing down and rebuilding watchers on every plug and
  unplug, for a path most people never take. Known, untuned, and left that way
  on purpose.

**Platform caveat, stated plainly:** battery state comes from
`navigator.getBattery`, which is Chromium's API. It exists in WebView2 and is
absent from WKWebView and WebKitGTK — so today this reads correctly on Windows
and reports "mains" on macOS and Linux. That is two of three platforms, not a
rounding error. Closing it means asking the OS from Rust, which is a new
dependency in a tree kept deliberately small; `source()` in `lib/power.ts` is
the single seam to change when that trade is worth making. Unknown always
resolves to mains, never to battery — guessing "battery" would slow the app for
someone who never asked and give them no way to find out why.

## Layout

```text
apps/desktop/     Tauri 2 app — React chrome + Rust shell (src-tauri/)
packages/         editor (Tiptap surface), theme, commands, document-ui, typst-preview
crates/           Rust core — markdown index, revisions, diff, render, workspace/durability, search, agents, CLI
templates/        Typst document modes (essay, memo, report, rfc)
fixtures/         Test corpus for parsing, diffing and rendering
docs/             Product brief, architecture, document model, agent protocol, research
```

## Status and roadmap

Milestones 0–4 are in: manuscript editing, Typst rendering, the durability
layer, structural diffs, and the ACP agent host — plus citations with a
bibliography, a revision timeline with restore over the existing snapshot
history, fonts the author installs, document and project search, and three
platforms' worth of installers. Next up: maths, a proper find bar with
replace, filename quick-open, and the planned UI overhaul.

The full build list, with what each item would actually cost, is in
[docs/roadmap.md](docs/roadmap.md).

## License

AGPL-3.0-or-later.
