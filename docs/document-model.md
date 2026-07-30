# Document model

## The document remains a file

The canonical document is an ordinary Markdown file. It opens in other
editors, commits to Git, gets edited by Claude Code, and reads in twenty
years. No proprietary format, ever.

Essay-specific state lives in a removable `.essay` sidecar:

```text
my-essay/
├── essay.md            canonical manuscript (portable)
├── references.bib
├── assets/
├── essay.typ           optional template override
└── .essay/             regenerable application state
    ├── history.sqlite
    ├── metadata.json
    ├── cache/
    └── changes/
```

Deleting `.essay/` may lose history; it must never corrupt the manuscript.

## Index over source

`essay-markdown` parses the source into a `DocumentIndex` (blocks, headings,
links, references). Every entry carries a `TextRange` pointing into the
original bytes. The index is derived state — Essay never serialises the index
back into the file. This is what guarantees unsupported syntax survives.

## Revisions

Editorial history is distinct from undo. Revisions are immutable snapshots
with provenance (`essay-revisions::Revision`): author (human/agent),
optional instruction, origin (HumanSession, AgentPatch, ExternalEdit,
Import, Checkpoint, Restore). Diffs come in three additive forms: text
(exact words), structural (between indexes: moves, renames, reorders) and
editorial summary (never a replacement for the text diff).

## Stable anchors (hard problem)

Comments, suggestions and findings anchor to content that has no inherent
IDs. An anchor combines: document revision, source range, containing block
identity, nearby text context, structural path and content fingerprint.
Reconciliation after edits exposes confidence and permits manual
reattachment. This gets its own test suite and evaluation corpus under
`fixtures/`.
