# Internals: overview

For contributors. One page on how a document moves through Essay, the rules
that are not up for negotiation, and what each crate is for.

Background reading, in this order: [product brief](../product-brief.md) for
intent, [architecture](../architecture.md) for decisions of record,
[document model](../document-model.md) for index-over-source.

## The data flow

```text
  disk                Rust                          WebView
  ────                ────                          ───────
  draft.md  ──read──▶ essay-workspace ──payload──▶  Tiptap parses Markdown
                      (hash the bytes)               │
                                                     ▼
                      essay-markdown ◀──index_document──  outline, structure
                      (index OVER source)
                                                     │ author edits
                                                     ▼
  draft.md  ◀─write── essay-workspace ◀──contents──  editor.getMarkdown()
             (atomic)  (guard on hash)                + the hash it was given
             │
             ├──▶ SnapshotStore   .essay/history.sqlite
             └──▶ DocumentWatcher watches for anyone else's write
```

Read, index, edit, serialize, write. Every read hands back a blake3 content
hash; every write hands that hash back as a guard. That single fact is what
makes autosave, an agent and a `git checkout` unable to clobber each other.

## The boundary rule

**The file is canonical, and the WebView never regenerates it.**

The Rust side reads the source and builds `DocumentIndex` — headings now,
blocks and links as the work needs them — where every entry carries a byte
range pointing into the original source. The index is derived state. Nothing
in Rust ever turns an index back into Markdown.

The WebView is the only thing that serializes, and only from a document it
parsed from that same file. Revisions, diffs and agent patches all operate on
the Markdown file, never on editor state.

The practical test: if you find yourself writing Rust that produces Markdown
from a parsed structure, you are on the wrong side of this line.

## The six invariants

From the product brief. They override convenience.

1. **The canonical document is a plain Markdown file.** No proprietary format;
   `.essay/` must be safely deletable.
2. **Saving must not gratuitously rewrite the author's Markdown.** Unknown
   syntax must survive. Grow golden-file tests in `fixtures/` with any
   serializer change. This is the invariant with a test suite; see
   [markdown.md](../reference/markdown.md).
3. **On the Rust side, the file is canonical.** See the boundary rule.
4. **AI proposes; the author decides.** Agent edits arrive as reviewable
   change sets with provenance. No silent rewrites.
5. **Typing and navigation never block on rendering or AI.** Rendering runs on
   a blocking thread behind a debounce; agent turns are events, not awaits.
6. **Fully offline-capable.** No accounts, no required network, system fonts.

The one asterisk on 6: the Claude Code adapter is an npm package, so its first
install needs the network once. After that it launches offline. That is
documented where a reader hits it, in [the agents guide](../guide/agents.md).

## Crate map

Each crate's `lib.rs` doc comment is the source of truth; these are one-line
summaries of it.

| Crate | Role |
| --- | --- |
| `essay-core` | Positions and identities *within* a source: `TextRange`, `BlockId`, `Fingerprint`. Nothing here is ever used to regenerate a file. |
| `essay-markdown` | Source-preserving parsing and indexing. `index(source)` produces a `DocumentIndex` whose entries point into the bytes. `parse_options()` is shared shape with `essay-render`; the two must agree or the outline and the printed page disagree about the document. |
| `essay-revisions` | The vocabulary of editorial history — `Revision`, `RevisionAuthor`, `RevisionOrigin`, timestamps. Types only; `essay-workspace` owns the store. |
| `essay-diff` | Line hunks and a structural `SectionChange` list, plus `churn` and `looks_like_a_rewrite()`. The only place a diff is computed, so the panel, the CLI and any future surface cannot disagree. |
| `essay-render` | Markdown → Typst markup → embedded compiler → SVG pages, PDF, and (behind a feature) PNG. See [rendering](./rendering.md). |
| `essay-workspace` | Durable file IO, the `.essay` sidecar, revision capture, and external-edit watching. See [durability](./durability.md). |
| `essay-agents` | The ACP client host: launching agents, intercepting their writes as change sets, normalising session options, skills. See [agents-acp](./agents-acp.md) and [agent-launching](./agent-launching.md). |
| `essay-search` | A stub. Project and document search; nothing implemented yet. |
| `essay-cli` | The `essay` binary. Three working verbs; see [cli](../reference/cli.md). |

`apps/desktop/src-tauri` is the shell: it owns the app data directory, wires
the stores and the host together, and exposes 27 IPC commands. It holds no
logic of its own beyond that wiring and the explorer's directory walk.

## Package map

| Package | Role |
| --- | --- |
| `@essay/editor` | The manuscript surface: extension assembly, serializer overrides, outline and word-count helpers, `prose.css`. Framework-agnostic — no React. Hosts bring their own binding. |
| `@essay/theme` | `--essay-*` CSS variables, light and dark. |
| `@essay/commands` | The command registry the palette reads. Registration order is preserved. |
| `@essay/document-ui`, `@essay/typst-preview` | Boundary stubs, grown as milestones need them. |

The serializer overrides in `@essay/editor` — `markdown-lists.ts`,
`markdown-tables.ts`, `markdown-escapes.ts`, `markdown-code.ts` — exist
entirely to hold invariant 2. Read the comment at the top of each before
touching it; every one of them replaces a stock node that normalised something
an author wrote on purpose.

## Where the tests are

- `cargo test --workspace --exclude essay-desktop` — `essay-markdown`,
  `essay-diff`, `essay-workspace` and `essay-agents` have real coverage,
  including the durability and launch-resolution edge cases.
- `bun test` — the round-trip suite. This is the one that guards an invariant
  directly.
- `bun run typecheck` — `tsc` over `apps/desktop` and the packages it imports.
