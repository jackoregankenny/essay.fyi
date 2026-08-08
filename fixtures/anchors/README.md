# Anchor reconciliation corpus

Documents for testing whether a comment's range anchor survives the document
changing underneath it — the evaluation corpus `docs/document-model.md`
promised the stable-anchor work. Consumed by `cargo test -p essay-context`
(`reconcile.rs` reads these with `include_str!`).

The corpus is chosen to be hostile in the two ways real manuscripts are:

- **`the-instrument-argument.md`** — an essay with two `## Objections`
  sections (duplicate headings at the same depth, so only the ordinal can
  tell the corridors apart) and a thesis sentence repeated verbatim in two
  sections ("The instruments a field builds to observe its subject end up
  shaping the subject"), so a quote match without context and corridor is
  ambiguous by construction.

Tests derive edited variants (edits before/inside the selection, section
renames and moves, wholesale rewrites) from these bytes in code rather than
as sibling files, so a fixture edit cannot quietly diverge from the scenario
it is meant to produce.

The one rule under test, from the backlog: ambiguous repeated prose never
receives a silently guessed comment. Zero matches and two matches must both
come back **unplaced**.
