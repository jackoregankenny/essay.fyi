# Command line

For anyone driving Essay's document engine without the app — scripts, agents,
or a contributor checking behaviour.

`essay` is the binary from `crates/essay-cli`. It shares the Rust core with
the desktop app, so a diff it prints and a diff the review panel shows are the
same computation.

## Building and running

```bash
cargo run -p essay-cli -- outline fixtures/manuscripts/executive-memo.md
```

For a standalone binary, `cargo build -p essay-cli --release` produces
`target/release/essay` (`essay.exe` on Windows) — the `[[bin]]` is named
`essay`, not `essay-cli`. Everything below was run against that release build.

Running it with no arguments prints the usage and exits `1`:

```text
essay — inspect and edit Essay documents

Usage:
  essay outline <document.md>            Print the heading outline
  essay diff <before.md> <after.md>      Section-level summary of what changed
  essay inspect <document.md>            (planned) Document metadata and stats
  essay read <document.md> --section <s> (planned) Read one section
  essay search <document.md> <query>     (planned) Search the document
  essay propose <document.md> --patch <changes.json>
                                         (planned) Submit a structured patch set
  essay render <document.md> [--format pdf|svg|png] [-o <output>]
                                         Typeset via the embedded Typst compiler
  essay status <document.md>             (planned) Pending changes and revisions
```

Three verbs work: `outline`, `diff`, `render`. The five marked `(planned)`
exit `1` with a note; `propose` in particular is unlikely to arrive — see
[agents-acp.md](../internals/agents-acp.md#what-was-dropped-and-why).

## `essay outline`

Every heading, with the line it starts on and indentation by depth.

```bash
essay outline fixtures/manuscripts/executive-memo.md
```

```text
    8  Reducing Time-to-First-Draft
   18    Recommendation
   26    What we measured
   43    Why it happens
   52    What we propose
   62    Cost and risk
   77    Decision requested
```

Front matter is parsed as front matter, so a YAML block's closing `---` does
not turn the line above it into a heading.

## `essay diff`

The section-level summary of what changed between two versions — the same view
the review surface shows, so an agent can check its own work before proposing
it.

A well-behaved, scoped edit:

```bash
essay diff fixtures/diffs/agent-edit.before.md fixtures/diffs/agent-edit.scoped.md
```

```text
      edited  The practice  +9/-17 words

1/4 sections, +5/-6 lines, +9/-17 words
```

The *same editorial improvement*, produced by regenerating the whole document:

```bash
essay diff fixtures/diffs/agent-edit.before.md fixtures/diffs/agent-edit.rewritten.md
```

```text
       added  Why the ear catches what the eye misses  +70/-0 words
      edited  The practice  +21/-37 words
       added  What it won't catch  +50/-0 words
     removed  Why the ear catches what the eye does not  +0/-72 words
     removed  What it will not catch  +0/-56 words

5/6 sections, +15/-16 lines, +45/-69 words

This reads as a rewrite, not an edit (83% of sections touched).
```

Those two are the point of the verb. The meaning is preserved in both; only
one of them replaced the author's sentences.

A pure reordering is reported as movement rather than as deletions and
insertions:

```bash
essay diff fixtures/diffs/section-move.before.md fixtures/diffs/section-move.after.md
```

```text
       moved  Proposed stages
       moved  Risks

2/7 sections reordered; no words written or deleted
```

Statuses are `edited`, `moved`, `moved+edited`, `added`, `removed`; unchanged
sections are not printed. Content before the first heading appears as
`(preamble)`. Identical files print `No changes.`

Sections are matched by heading text, greedily in order. Renaming a heading
therefore reads as a removal plus an addition — a visible failure mode rather
than a silent one.

The rewrite line appears when at least two thirds of the sections are touched
and there are at least three of them. It is a label, not a verdict.

## `essay render`

Typesets a document through the embedded Typst compiler. No LaTeX, no external
toolchain, no network.

```bash
essay render fixtures/manuscripts/executive-memo.md --format pdf -o memo.pdf
```

```text
memo.pdf
```

`--format` is `pdf` (the default), `svg`, or `png`. `-o` / `--output` sets the
output path; without one it is the input path with the extension replaced.
Each written file is printed on its own line.

SVG writes one file per page. The first takes the name you gave, and the rest
get a numbered suffix:

```bash
essay render fixtures/manuscripts/executive-memo.md --format svg -o memo.svg
```

```text
memo.svg
memo-2.svg
```

PNG renders **only the first page**, at 2× scale. It exists to eyeball real
typeset output, not to export a document. It is also the one format that needs
a feature flag: `essay-cli` enables `essay-render/png`, and the desktop binary
deliberately does not carry the raster stack — see
[rendering](../internals/rendering.md).

Relative paths inside the document (images, data files) resolve against the
document's own folder.

Compilation errors go to stderr with the compiler's message and exit `1`:

```text
essay render: typst compilation failed:
…
```

## Exit codes

`0` on success. `1` for a missing or unreadable file, a missing argument, an
unknown format, a compilation failure, a planned-but-unimplemented verb, and
for the usage message.
