# Essay documentation

For anyone using or working on Essay. Start here; every page below opens with
a sentence saying who it is for.

Essay is a local-first desktop writing environment whose canonical document is
an ordinary Markdown file. These docs are Markdown too, with no site generator
behind them, so they read in Essay itself as well as on GitHub.

This is a pre-1.0 development build. Where something does not work, the page
that covers it says so rather than leaving you to find out.

## Using Essay

- [Getting started](./guide/getting-started.md) — install, run, open a
  document, and understand what Essay writes beside it.
- [Writing](./guide/writing.md) — what the manuscript surface does: markdown
  shortcuts, tables, marks, focus mode, the outline, the print pane.
- [Working with agents](./guide/agents.md) — starting a session, the two ways
  an agent's edit reaches you, reading the diff, and what to do when sign-in
  lapses.
- [Configuring an agent](./guide/configuring-agents.md) — session options,
  skills you write as files, slash commands.
- [History](./guide/history.md) — snapshots, who a revision is attributed to,
  what is kept and what is thinned, how to get earlier text back.
- [Updates](./guide/updates.md) — when Essay checks, what it downloads, and
  when it installs.

## What is planned

- [Product one-pager](./product-one-pager.md) — the customer promise and the
  internal feature order used to decide what Essay builds.
- [Build list](./roadmap.md) — what is next, what it would cost, and the
  smaller gaps found while writing these docs.
- [Authoring and structured-editing build list](./authoring-backlog.md) — the
  concrete order for selection comments, structural operations, find/replace,
  spelling, images, tables, footnotes and maths.
- [Working material around the manuscript](./long-form-materials.md) — how
  fragments, questions, sources, tasks, decisions and suggestions can support
  long-form work without turning Essay into a general notes app.

## Reference

- [Command line](./reference/cli.md) — every `essay` verb, with output from
  real runs.
- [Keyboard shortcuts](./reference/shortcuts.md) — every binding, and how they
  are spelled on each platform.
- [Where Essay stores things](./reference/storage.md) — every path and browser
  key it writes, and what deleting each costs.
- [Markdown support](./reference/markdown.md) — supported syntax, and the
  round-trip contract in three honest tiers.

## Internals

For contributors.

- [Overview](./internals/overview.md) — the data flow, the six invariants, the
  crate map, and the boundary rule.
- [Durability](./internals/durability.md) — hash-guarded writes, the content
  watcher, the two SQLite stores, pruning.
- [Agents and ACP](./internals/agents-acp.md) — host architecture, filesystem
  interception, session-option normalisation, the fs bypass.
- [Launching an agent](./internals/agent-launching.md) — the pinned adapter
  install, the two Windows launch traps, the probe.
- [Rendering](./internals/rendering.md) — the embedded Typst world, the
  debounce contract, the PNG feature gate.
- [Search](./internals/search.md) — why there is no index, UTF-16 offsets,
  sentence excerpts, and the two coordinate systems a match can live in.
- [Release](./internals/release.md) — the three-platform matrix, signing, the
  tag rule, and what CI does not check.
- [Artifact size](./internals/size.md) — what the binaries and the bundle
  weigh, the size budget, and which levers have been pulled.

## Background

Documents that record why Essay is shaped the way it is. They are not
maintained as user documentation; read them for reasoning, not for current
behaviour.

- [Product brief](./product-brief.md) — the intent and the success criteria.
- [Architecture](./architecture.md) — decisions of record.
- [Document model](./document-model.md) — index-over-source, revisions,
  anchors.
- [How AI models interact with Essay](./how-agents-interact.md) — the
  explainer behind [the agents guide](./guide/agents.md).
- [Agent protocol](./agent-protocol.md) — an earlier plan. Its "native patch
  protocol" section was subsequently dropped on evidence; see
  [agents-acp.md](./internals/agents-acp.md) for what shipped instead.
- [Research](./research/) — deep background on the writing surface and the
  page, terminal embedding, and agent integration.
- [Fixtures](../fixtures/README.md) — the test corpus, including the
  authoritative inventory of what a save still loses.
