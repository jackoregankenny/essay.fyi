# Essay — Product brief

> Superhuman for unformed documents

This version treats Essay as the product name; the eventual domain can become
its public address without dictating the software's identity.

Essay is a fast, local-first writing environment for developing serious
documents from rough thought into finished work.

It is built for the period before a document is fully formed: when the
argument is still moving, sections are being rewritten, evidence is
incomplete, and the author is working out what they actually think.

Essay combines:

- a genuinely excellent text editor
- plain Markdown files
- print-quality Typst output
- first-class revision history and diffs
- local terminal agents such as Claude Code
- document-aware AI editing
- an extensible editor core that can later be embedded in other applications

It is free, open source and local by default.

The internal shorthand is: **Superhuman for unformed documents.**

The product itself is simply called Essay. The domain can follow later and
may become part of how the product is presented publicly.

## Why Essay should exist

Most writing software assumes one of two things:

1. The document is already understood and now needs formatting.
2. The document is disposable text being written into a web application.

Neither describes serious long-form writing.

A substantial memo, essay, technical proposal, RFC or board paper is
developed through repeated structural revision. Arguments move. Sections
expand and collapse. Evidence is added. Conclusions change. Several people or
AI agents may contribute edits.

Existing tools handle this badly.

Word is powerful but cumbersome, formatting-heavy and difficult to integrate
into local technical workflows.

Markdown is durable and pleasant to write, but most Markdown editors produce
mediocre documents and treat the manuscript as an undifferentiated text file.

AI chat interfaces are particularly poor at long-form editing. They routinely
reproduce entire documents, obscure what changed and make it difficult to
retain editorial control.

Code editors have excellent diffs and agent integrations, but they are
designed around software rather than prose, argument and printed pages.

Essay should combine the strongest properties of each without becoming any of
them.

## Core thesis

Writing is not typing. Writing is the iterative construction of thought.

A serious document has: structure, claims, evidence, references, decisions,
unresolved questions, revisions, contributors, and a final physical or
digital form.

Essay should understand enough of this structure to help the author navigate,
revise and finish the work without taking ownership of the document away from
them.

## Product principles

### The document remains a file

The canonical document is an ordinary Markdown file. It can be opened in
another editor, committed to Git, changed by Claude Code, copied onto a USB
drive or read twenty years from now. Essay must not require a proprietary
document format.

Additional features such as comments, revision provenance and stable anchors
can live in a removable `.essay` sidecar directory. Deleting that directory
may remove Essay-specific history, but it must never destroy or invalidate
the manuscript.

### Local first means local first

Essay should work without: an account, an internet connection, a hosted
workspace, a subscription, or a proprietary AI service.

Documents, history, templates and indexes live locally. Cloud sync and
multiplayer collaboration can be added later, but neither should be required
to use the application properly.

### Print is a first-class view

Essay is not merely a Markdown editor with an export button. The printed
document is visible throughout the writing process.

The author should be able to understand: where a section appears, how many
pages it occupies, whether a heading is stranded, whether a table fits,
whether a two-page memo has become four pages, how a change affected the
final composition.

Typst provides the typesetting engine, but Essay provides the writing
experience around it.

### Diffs are central

Every substantial change should be understandable. Three related forms:

- **Text diff** — the exact words inserted, removed or changed.
- **Structural diff** — sections moved, headings renamed, paragraphs
  reordered, tables replaced or arguments split.
- **Editorial summary** — a concise account of the effect of a revision
  (introduction shortened by 28%; recommendation moved onto the first page;
  two examples removed; one unsupported claim introduced; conclusion
  unchanged).

The semantic summary is additive. It never replaces access to the underlying
text diff.

### AI proposes; the author decides

AI should behave like an editor, not an invisible co-author. An agent may
inspect, search, critique, propose a patch, move sections, shorten a passage,
identify unsupported claims, render the result. Its work arrives as a
reviewable change set. The author can accept, reject or modify each change.

Essay records: who or what proposed the edit, the instruction that produced
it, the affected sections, the exact patch, when it happened, whether it was
accepted. No model silently rewrites the canonical document.

### Speed is part of the design

Opening a document, searching it, moving between sections and viewing
ordinary edits should feel immediate. A forty-page document is not large by
software standards; Essay treats it as routine. Rendering may occur
asynchronously, but typing and navigation must never wait for PDF compilation
or AI activity.

### The first application comes before the framework

Essay should be designed with internal component boundaries, but it should
not begin as a generic editing SDK. The first objective is to make Essay
itself excellent. The reusable editor core should emerge from real
requirements. Later, the same engine may be embedded inside a dossier
application, an RFC system or another document product.

## The primary experience

Three coordinated views:

```text
┌──────────────────┬──────────────────────────────┬──────────────────┐
│ STRUCTURE        │ MANUSCRIPT                   │ PRINT            │
│                  │                              │                  │
│ Introduction     │ # Introduction               │      Page 1      │
│ Background       │                              │                  │
│ Argument         │ The current draft...         │  Rendered page   │
│ Proposal         │                              │                  │
│ Objections       │                              │                  │
│ Conclusion       │                              │                  │
│                  │                              │                  │
│ 12 open changes  │                              │   18 pages       │
└──────────────────┴──────────────────────────────┴──────────────────┘
```

**Structure** — more than a table of contents: headings and hierarchy,
section word counts, approximate page weight, recent revision activity,
unresolved comments, proposed AI changes, sections marked as notes or
incomplete. Sections can be navigated and eventually moved without manual
cut-and-paste.

**Manuscript** — a source-faithful Markdown editor. Calmer and more literary
than a code editor while retaining the precision of one. Markdown syntax can
become visually quiet when the cursor is elsewhere, but the source must never
be hidden behind an opaque rich-text representation.

**Print** — the actual typeset document, updating quickly. Selecting a
paragraph locates its printed result; selecting a printed section returns to
its source. Exact bidirectional mapping improves over time, but the
architecture allows for it from the beginning.

## Core capabilities

### Excellent Markdown editing

CommonMark; GitHub-flavoured tables and task lists; frontmatter; footnotes;
citations; mathematical notation; images and figures; fenced custom blocks;
tolerated MDX syntax.

Unsupported or unknown syntax must survive unchanged. Essay never
reserializes the whole document through an AST. The source is canonical;
parsed structures are indexes over that source.

### Opinionated typesetting

A small set of exceptional templates: essay, memo, report, technical
proposal, RFC. Templates handle typography, heading hierarchy, page geometry,
footnotes, references, tables, figures, code, page numbering, widows and
orphans, sensible page breaks. Authors can customise or replace the Typst
template without changing their manuscript.

### Revision history

Editorial history distinct from undo. Undo: "what did I type a few seconds
ago?" Revision history: "how did this document change over the last week?"

Revisions are created by: a focused human editing session, an explicit
checkpoint, an external file change, an agent patch, an imported version, a
branch or experiment. The author can inspect, compare and restore any
revision.

### Agent integration

Work with existing local agents (Claude Code, Codex CLI, Gemini CLI,
arbitrary shell commands, future local models) rather than becoming the model
provider. Two paths: the universal fallback (agent edits the file; Essay
captures before/after) and the native patch protocol (`essay` CLI with
structured patch sets). The native protocol should be better, but the product
must remain useful without it.

### Inline review

Proposed changes reviewable inline, side-by-side, section by section,
revision by revision, or as a whole-document summary. Moves shown as moves.
Large agent changes open with a per-section overview before drilling in.

### Document understanding

Early, deterministic: outline, section lengths, references, repeated phrases,
heading structure, unfinished markers, revision frequency, reading time, page
distribution. Later, optional AI: claims and supporting evidence,
contradictions, assumptions, recommendations, unresolved questions, changes
in tone, weak or repeated arguments. Presented as aids, not objective
judgments.

### Composability

Reusable layers (chrome / workspace / editor UI / document engine / revision
engine / typesetting engine). Hosts register capabilities:

```ts
registerBlock({ type: "linked-study", parse, editorWidget, serialize, renderTypst });
registerCommand({ id: "insert-linked-study", title: "Insert linked study", run });
```

This is enough composability. Essay does not need to become a universal
application platform.

## Architecture (summary)

See [architecture.md](./architecture.md) for the working document.

- **Desktop shell**: Tauri 2 (Rust backend, OS WebView).
- **UI**: React + TypeScript + Vite; small frontend; Radix/Ariakit
  primitives; CSS variables; xterm.js only when the terminal arrives.
- **Text editor**: CodeMirror 6 — the text surface, never the canonical
  model or revision database.
- **Rust core**: filesystem, autosave, watching, parsing/indexing, revision
  storage, diffs, external edit capture, agent processes, Typst compilation,
  search, PDF, crash recovery.
- **Markdown**: markdown-rs (source positions; CommonMark/GFM/MDX/math/
  frontmatter); `pulldown-cmark` as fallback.
- **Typesetting**: Typst embedded via Rust; full-document compile after
  debounce; PDF.js preview first; cache by revision + template hash.
- **Storage**: SQLite sidecar; manuscript never lives only in SQLite.
- **Foundational crates**: tokio, serde, notify, rusqlite, similar,
  portable-pty, tracing, thiserror — replaceable behind Essay-owned
  interfaces.

## Milestones

1. **A writer worth using** — open/save, CodeMirror manuscript, outline
   navigation, command palette, autosave, crash recovery, search, light/dark,
   packaging for macOS/Windows/Linux. The editor must feel unusually good
   before adding AI.
2. **Beautiful documents** — Markdown→Typst, one excellent template, live PDF
   preview, export, figures/tables/footnotes/references, page and word
   counts, section-level editor↔page navigation.
3. **History and diffs** — automatic snapshots, revision timeline, text diff,
   side-by-side, restore, external edit capture, initial structural diff.
4. **Agents** — `essay` CLI, agent-readable outline/section inspection,
   structured patch format, inline accept/reject, provenance, optional
   terminal, Claude Code workflow demonstration.
5. **Long-document intelligence** — document map, section density, change
   activity, unresolved markers, move detection, improved anchors, editorial
   summaries.
6. **Extensible editor core** — custom block API, custom command API,
   host-provided panels and Typst renderers, chrome/core separation, a small
   second host proving the boundary (a proof, not another product).

## What is easy / what is hard

Easy (implementation, not research): Tauri scaffolding, file operations,
CodeMirror setup, highlighting, outline, search, basic templates, PDF export,
word counts, command palette, basic text diffs, file watching, packaging.

Hard: making the editor feel exceptional (details compound); reconciling
external edits into reviewable changes; stable identity in plain text;
source-to-print mapping; structural diffs that show moves as moves;
consistently excellent typesetting.

## Open-source position

Free and open source. A genuinely open-source licence cannot prohibit
commercial use. Practical objective: prevent capture as a closed proprietary
product while keeping Essay free to use.

- AGPL-3.0-or-later for the application and reusable core
- Essay name and visual identity under a separate trademark policy
- no CLA permitting unilateral proprietary relicensing
- official plugins and templates under compatible open licences
- public roadmap, issue tracker and design discussions
- legal review before the first formal release

## Non-goals (initially)

Not a Word replacement, note-taking knowledge graph, team wiki, website
builder, desktop publishing suite, generic IDE, hosted AI writing service,
real-time multiplayer editor, regulatory dossier system, or
everything-document platform.

## Measures of success

Someone can write a forty-page essay, a two-page executive memo, a technical
RFC, or a proposal with tables/figures/references — without leaving the
application for ordinary editing, revision review or final PDF creation.

Tests: the manuscript remains an ordinary Markdown file; opening and
navigation feel immediate; print output is excellent without manual
formatting; external agent changes are understandable; no AI edit is
accepted invisibly; the author can explain how the document changed;
unsupported syntax is not destroyed; the application works fully offline;
the project can be forked and maintained by its community; another host can
eventually reuse the editor without inheriting Essay's entire interface.

## Product statement

Essay is an open-source, local-first environment for forming serious
documents. It combines a fast Markdown editor, print-quality Typst output,
durable revision history and reviewable AI editing in one focused desktop
application.

Or, internally: **Superhuman for unformed documents.**
