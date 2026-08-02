# Internals: rendering

For contributors working on `essay-render` or the print pane.

Markdown source → Typst markup → an embedded Typst compiler → SVG pages for
the preview, PDF for export, PNG for eyeballing. No LaTeX, no external
toolchain, no network.

## The pipeline

```text
find_bibliography(root)       references.yml|yaml|bib, bibliography.bib
        │                     decides whether [@key] may fire at all
        ▼
markdown_to_typst(source, …)  convert.rs — mdast → Typst markup
        │                     front matter lifted out, not emitted as body
        ▼
build_main_source(converted)  #import "/template.typ": essay
        │                     #show: essay.with(title: …, author: …, date: …)
        │                     #bibliography("references.bib") after the body
        ▼
EssayWorld::new(main, ESSAY_TEMPLATE, root)
        ▼
typst::compile::<PagedDocument>(&world)
        ▼
typst_svg::svg per page   |   typst_pdf::pdf   |   typst_render (feature-gated)
```

The template is `templates/essay/essay.typ`, pulled in with `include_str!` so
rendering works with zero filesystem setup. Per-project template overrides are
planned, not built.

`convert.rs` handles escaping, `==highlight==`, `[@key]` citations, booktabs
tables and the front-matter lift.

**Why the bibliography lookup happens first.** Typst treats a `#cite` with no
`#bibliography` as a *compile error*, not a missing reference — so whether a
bibliography exists has to be known before conversion, because it decides
whether `[@key]` becomes a citation or stays the text the author typed. Emit
citations unconditionally and an unsaved draft, which has no folder to resolve
against, goes blank the moment its author types one. That is what the `Ctx`
threaded through the emitters carries. It parses with the same `parse_options()` shape that
`essay-markdown` uses. **Those two must agree.** They did not once: front
matter was not enabled in `essay-markdown::index()`, so a YAML block's closing
`---` turned the line above into a setext heading and the whole block landed in
the outline — the outline and the printed page disagreeing about what the
document contained.

## The manual `World`

Typst's `World` trait is the compiler's view of the filesystem, and Essay
implements it by hand in `world.rs` rather than using `typst-cli`'s. It is
about a hundred lines and it is deliberately small.

- **Two in-memory sources**, `/main.typ` and `/template.typ`. Nothing else is
  a source, so a document cannot `#import` an arbitrary file.
- **The author's fonts, then the machine's own**, scanned through `fontdb`.
  `typst-assets`' `fonts` feature is deliberately off: it is an
  all-or-nothing 9.23 MB of Libertinus, New Computer Modern and DejaVu, and no
  other crate in the Typst tree asks for it, so leaving it off keeps those
  megabytes out of every artifact.

  `<app data>/fonts` is loaded **before** the system directories, and the
  order is the decision: Typst resolves a family name to the earliest matching
  face, so someone who installs Libertinus Serif gets theirs rather than the
  system's copy. `essay-render` learns the path through `use_font_dir`, a
  `OnceLock` the desktop shell sets — the crate itself stays free of Tauri,
  and the CLI simply leaves it unset.

  The scanned set lives behind an `RwLock<Option<Arc<FontSet>>>` rather than a
  `OnceLock`, so `rescan_fonts()` can drop it and the next render picks up a
  newly installed face without a relaunch. `EssayWorld` captures the `Arc` at
  construction, so one render still typesets against one consistent set of
  faces even if fonts arrive while it is running.

  Metadata and bytes are loaded separately, and that split is the point.
  Building the `FontBook` needs every installed face's *info*, so every font
  file on the machine is opened once at startup; loading every face's *data*
  would mean holding hundreds of megabytes of fonts nobody asked for. Bytes
  arrive per face on first use and are cached in the slot.

  **The cost is that a document no longer typesets identically everywhere.**
  Typst's own default family, Libertinus Serif, is not installed on a stock
  Windows, macOS or Linux machine, so `templates/essay/essay.typ` names a
  *stack* rather than a family — the intended face first, then the best serif
  each platform actually ships. The fallback is a decision rather than an
  accident, but it is still a fallback, and two machines can produce different
  PDFs from the same Markdown.
- **`file()` resolves against the document's own directory**, and only if a
  root was given. That is how a relative image reference works. A document
  that has never been saved has no root, so file reads fail rather than
  resolving against the working directory.
- **`today()` returns `None`.** A document that typeset differently depending
  on when you compiled it would break the round-trip discipline in a subtler
  place than the serializer.

No package downloads, ever.

## The debounce contract

Invariant 5: typing and navigation never wait on rendering. Three things hold
it together, and all three are needed.

1. **The Tauri command runs on a blocking thread.** `render_document` and
   `export_pdf` both wrap their work in `spawn_blocking`. Full-document
   compilation of a forty-page manuscript is not something to do on the async
   runtime.
2. **The frontend debounces 500ms** after the last change (`usePreview.ts`).
3. **Latest wins.** Every request takes a sequence number, and a response
   whose sequence is not the current one is dropped. Without it, a slow
   compile finishing after a fast one would show older pages.

While a new compile runs, the previous pages stay on screen — `status` moves
to `rendering` but `pages` is untouched — so the pane does not flash. The
preview is only enabled while the print pane is open; switching back to
`write` clears the status but keeps the pages, so switching back is instant.

Compilation is full-document. There is no incremental typesetting and there
should not be until profiling demands it.

## Warnings and errors

`compile()` returns the document plus the compiler's warnings as strings;
errors become `RenderError::Compilation` with the diagnostics joined by
newlines.

The print pane shows an error over the pane when there are no pages, and
beside stale pages when there are — a document that typeset a moment ago is
still worth looking at. **Warnings are carried all the way from the compiler
into `PreviewState.warnings` and then never displayed.** That is a loose end,
not a decision.

An empty source compiles to one page. That is asserted, because "degenerate
input must not error" is easy to regress.

## The PNG feature gate

`render_png_page` is behind `#[cfg(feature = "png")]`, and the feature pulls
in `typst-render` and with it the tiny-skia raster stack.

**The desktop binary does not enable it.** The app needs SVG for the live
preview and PDF for export; it never rasterises. `essay-cli` enables it,
because `essay render --format png` exists to eyeball real typeset output and
because tests use it.

Keeping it out of the default feature set is not tidiness — it is the size
budget. The desktop binary already carries a typesetting engine and its fonts;
adding a rasteriser nothing calls would be paid for by every user. See
[release](./release.md) for how that is measured.

PNG renders one page, at a caller-chosen scale; the CLI asks for page 0 at
2.0.

## Why SVG for the preview

Self-contained (no image server, no blob URLs), crisp at any zoom, and it
carries structure — which is what a future source-to-page mapping will need.
PDF-in-an-iframe was the alternative and loses all three.

Page geometry comes from the template, not from the writing-width preference.
The preference scopes `--essay-measure` to `.essay-prose` only, so the print
pane keeps the template's measure and the printed page looks like the printed
page.

## Testing it

`cargo test -p essay-render` compiles a small sample to SVG and PDF and
asserts the outputs start with `<svg` and `%PDF-`. `fixtures/render-tests/` is
reserved for manuscripts with expected typeset characteristics and is
currently empty.

For a visual check:

```bash
cargo run -p essay-cli -- render fixtures/manuscripts/executive-memo.md --format png -o /tmp/page1.png
```
