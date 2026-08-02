# Build list

For whoever picks up the next piece of work. Ordered by what the evidence
says is cheapest per unit of value, not by ambition.

Everything here is *planned*. Nothing on this page describes current
behaviour; for that, start at [the docs index](./README.md).

## Already paid for, not yet shipped

These have their engine compiled into every Essay binary today, because Typst
brings it whether or not Essay calls it. The work is wiring, not dependency
selection — see [artifact size](./internals/size.md) for the measurements.

### ~~Citations and bibliography~~ — shipped

`[@key]` emits `#cite`, and a `references.bib` beside the manuscript emits
`#bibliography` after the body. See
[markdown](./reference/markdown.md#supported-syntax) for the syntax and
`fixtures/citations/` for the corpus.

One finding worth keeping, because it shapes anything built on top: **`#cite`
with no `#bibliography` is a compile error in Typst, not a missing
reference.** So the bibliography is looked for *before* conversion and decides
whether `[@key]` may fire at all — otherwise an unsaved draft, which has no
folder to resolve against, would go blank the moment its author typed a
citation.

Still open: prefixes and locators (`[see @smith, p. 33]`), which stay literal
today, and a way to pick a CSL style.

### Fonts the author installs

**Step 1 is done.** `<app data>/fonts` is scanned alongside the machine's own,
learned through a `OnceLock` the desktop shell sets. The author's faces load
first, so a font installed deliberately wins a name collision with the
system's copy, and the scanned set sits behind an `RwLock` rather than a
`OnceLock` so installing a face does not mean relaunching to use it. The rest
of this section is unbuilt.

Since [fonts moved to the system](./internals/size.md), Essay typesets in
whatever the machine has, and the same Markdown can set differently on two
computers. The fix is not to embed nine megabytes again — it is to let the
author add faces, and to say when a document wants one that is missing.

**The whole mechanism is already compiled in.** `tauri-plugin-updater` pulls
`reqwest`, `rustls`, `minisign-verify`, `zip` and `flate2` for its own use, and
`fontdb` exposes `load_fonts_dir`. A signed, downloadable font pack therefore
costs **approximately zero additional bytes** — it is wiring, not dependencies.

Three parts, in the order they are worth building:

1. ~~**Load a font directory.**~~ Done, as above.
2. **Add fonts from disk.** A file picker that copies faces into that
   directory. No network at all, and it is the half that matters for an author
   with licensed fonts they already own.
3. **Fetch a curated pack.** Libertinus Serif and DejaVu Sans Mono — the two
   families `templates/essay/essay.typ` names — as a signed archive from the
   release endpoint, verified with `minisign-verify` against the key already in
   `tauri.conf.json`. Both are redistributable (OFL and the Bitstream Vera
   licence) and the NOTICE travels with them.
4. **Browse and install from font registries.** See below.

### Get fonts: which registry, and why

Checked against the live APIs rather than assumed.

| Source | Serves | Verdict |
| --- | --- | --- |
| **`github.com/google/fonts`** | Unsubsetted **variable TTFs** plus `OFL.txt` and `METADATA.pb` per family — e.g. `LibreBaskerville[wght].ttf`, 171 KB, every weight in one file | **Use this.** ~1,900 families, no API key, licence ships alongside |
| `fonts.google.com/metadata/fonts` | The family catalogue as public JSON — category, subsets, axes | Use for the browse list; pair with raw.githubusercontent for files |
| **Fontsource** (`api.fontsource.org`) | woff2, woff **and ttf**, but **split by subset** — `latin-400-normal.ttf` | Careful. A subset TTF cannot set `é` or `—`. Fine for the web, wrong for typesetting. Use only for families Google does not carry |
| **Nerd Fonts** (GitHub releases) | Per-family `.zip` (11–13 MB) and `.tar.xz` (2–5 MB) | Usable — we already link `zip`; we do **not** link `xz`, so take the zip and warn about the size. Monospace and icon faces, so this is a code-block feature, not a prose one |
| **Geist** | `vercel/geist-font` releases carry full OTF/TTF | Its own release, not Fontsource, for the same subset reason |

The subset finding is the load-bearing one: the obvious integration (Fontsource,
because the app already depends on it for UI fonts) is the wrong one for a
typesetting engine, and the failure would be silent — a font that installs,
looks right in the picker, and then drops accented characters.

Four things to get right, none of them optional:

- **Licences travel with the font.** OFL requires it. `OFL.txt` sits beside
  the TTFs in the Google repo, so install it into the family's folder and show
  it in the panel. A tool that silently installs licensed material on an
  author's behalf is doing something they cannot audit later.
- **Nothing here can be signed.** The adapter install and the updater both
  verify with `minisign`; third-party font files cannot. HTTPS plus a parse
  check is the honest ceiling — hand the bytes to `fontdb`/`ttf-parser` and
  refuse anything that is not a font before it reaches the directory.
- **The catalogue fetch is a network call in an offline-first app.** Fetch on
  panel open, never in the background, cache to disk, and degrade to "you are
  offline; installed fonts still work" rather than an error. No telemetry.
- **Size warnings.** A Nerd Font family is 11–13 MB zipped. Say so before the
  download, not after.

Invariant 6 survives this: the network stays optional, because the system-font
path renders with nothing downloaded. What must not happen is a first run that
*needs* the pack.

The part that makes it a feature rather than a workaround: **a document can say
which faces it wants**, and Essay can notice they are absent and offer to
install them, instead of silently substituting. That turns "this PDF looks
different on your machine" from something an author discovers late into
something the app says up front.

### Maths

**Cost already borne: the New Computer Modern maths faces, if fonts are ever
embedded again.** Essay has no maths today, in two independent places, and
both must change:

1. `essay_markdown::parse_options()` is `ParseOptions::gfm()` plus front
   matter, and GFM has no maths construct — so `$…$` never parses as maths.
2. `convert.rs`'s `Node::Math` arm emits `#raw(…)`, a monospace string
   literal, rather than Typst maths. The comment records why: "show it as code
   rather than mistranslate."

So the work is: enable the construct, then write a TeX-to-Typst translation
worth trusting. That second part is the real job — Typst's maths syntax is not
TeX's, and a half-translation that silently renders the wrong formula is worse
than the honest monospace fallback that ships today.

Two consequences to plan for:

- The round-trip suite currently asserts `$$…$$` survives a save as plain
  text. That assertion is about the editor's parser (`marked`), which is a
  different parser from `essay-markdown` — so rendering maths and *editing*
  maths are two separate pieces of work, and the first does not disturb the
  goldens.
- Since fonts now come from the system
  ([`world.rs`](../crates/essay-render/src/world.rs)), maths would need a
  maths-capable face to be present, or a bundled one to come back
  deliberately for that purpose.

## Smaller gaps found while documenting

Each of these is a thing the code does, or fails to do, that no other document
mentions.

- **Front matter is invisible and uneditable.** It is split off on open and
  restored byte-for-byte on save, because the editor's parser would otherwise
  destroy it. The proper fix is a non-prose block in the manuscript. See
  [writing](./guide/writing.md#front-matter-is-held-aside-not-shown).
- **`Ctrl+B` does two things.** It bolds the selection *and* toggles the
  sidebar, because the window keydown handler runs on the same event the
  editor already handled. `Ctrl+Shift+B` and `Ctrl+Shift+S` collide the same
  way. See [shortcuts](./reference/shortcuts.md#three-bindings-fire-twice).
- **Code blocks highlight on the printed page but not in the editor.** The
  print pane runs Typst's syntect-backed highlighting; the manuscript surface
  shows the same block unstyled.
- **A wrapped bullet breaks out of its list on the printed page.** `emit_list`
  in `essay-render/src/convert.rs` passes an embedded newline through
  unindented, and Typst ends the list item at it — so a bullet whose text
  wraps in the source typesets as a bullet followed by a stray paragraph.
  Affects any real manuscript with wrapped bullets.
- **Inline raw HTML still does not survive a save.** The block-level case is
  fixed; a tag inside a sentence is intercepted by `@tiptap/markdown` before
  Essay is consulted. See
  [markdown](./reference/markdown.md#tier-3--destroyed).

Fixed since this page was written: the revision timeline (a History pane over
`list_revisions`/`revision_source`, with restore and checkpoint), Typst
warnings in the print pane, the three shortcut collisions, block-level raw
HTML, and citations.

## Everything Essay ships and does not use

Compiled in, reachable by no input. Each is either something to use or
something to remove — none of it should stay in this state by default.

### Typst capability (cannot be switched off)

`typst`, `typst-pdf`, `typst-layout` and `typst-svg` expose no cargo features,
so none of this can be gated without patching upstream. Sizes are `.text` from
`cargo bloat`; see [artifact size](./internals/size.md).

| Capability | Cost | Status |
| --- | --- | --- |
| Bibliography and citations | ~2.4 MiB (`hayagriva`, `citationberg`) + CSL data | **In use.** `[@key]` emits `#cite`; a `references.bib` beside the manuscript emits `#bibliography` |
| WebAssembly plugins | ~1.3 MiB (`wasmi`, `wasmparser`) | Essay never calls `plugin()`; no plan to |
| PDF reading and embedding | ~2.0 MiB (`hayro_*`, incl. JBIG2 and JPEG 2000 codecs) | Only needed to place an existing PDF as an image |
| Typst scripting for authors | 351 KiB (`typst_eval`) | Per-project template overrides are planned, not built |
| Typst packages (`@preview`) | — | `EssayWorld` has no package resolver, so `#import "@preview/…"` fails |

### Essay's own unfinished surfaces

| Thing | Where | Status |
| --- | --- | --- |
| `DocumentIndex.blocks`, `.links`, `.references` | `essay-markdown` | Declared on the struct, **never populated** — `index()` returns headings only |
| `RevisionOrigin::Checkpoint`, `::Restore` | `essay-revisions` | **Produced**: `Restore` by restoring a revision, `Checkpoint` by marking one |
| `list_revisions`, `revision_source` | Tauri commands | **In use** by the History pane, alongside `restore_revision` and `checkpoint_document` |
| `PreviewState.warnings` | `usePreview.ts` | **Rendered** above the pages in the print pane, grouped by message |
| `SkillScope::Section` | `essay-agents` | Recorded on a skill and **never checked against the diff**, though its doc comment is the argument for having it |
| `essay-search` | crate | A doc comment and nothing else |
| `essay inspect / read / search / propose / status` | `essay-cli` | Print "not implemented yet" and exit 1 |
| `templates/memo`, `report`, `rfc` | templates | README stubs saying "planned" |
| `templates/skills/*.md` | templates | Two usable preference skills **referenced by no code and no doc** until recently |
| `@essay/document-ui`, `@essay/typst-preview` | packages | Boundary stubs |
| `essay-render/png` feature | crate | Used by the CLI only, deliberately not by the desktop binary |

### Why GPUI would not help

Worth recording because it comes up. Replacing Tauri with GPUI (Zed's Rust UI
framework) would remove `tauri` (2.1 MiB) and the compressed frontend
(~0.5 MB) — roughly 3 MB of a 49.75 MB binary — and add a GPU renderer, a text
shaping and layout stack, and font rasterisation, none of which Essay pays for
today because the OS WebView provides them. **It would grow the binary, not
shrink it**, and it would forfeit ProseMirror and with it IME, accessibility,
clipboard and text-selection behaviour that took the browser decades. See the
GPUI note in [architecture](./architecture.md) for the standing position.

## Not planned, deliberately

- **An `essay` MCP server / native patch protocol.** Dropped on evidence; see
  [agents-acp](./internals/agents-acp.md#what-was-dropped-and-why).
- **Sub-30 MB unpacked binaries.** Not reachable while Typst is linked in, and
  the download is already 17.66 MB. See
  [artifact size](./internals/size.md).
