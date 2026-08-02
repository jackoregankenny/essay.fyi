# Internals: artifact size

For contributors who need to know what Essay's artifacts weigh, why, and which
levers have already been pulled. The CI job that measures them is in
[release](./release.md).

## The size budget, armed

`scripts/size-budget.json` lists artifacts against baseline byte counts, with
a `tolerancePercent` (currently 5).

```json
{
  "tolerancePercent": 5,
  "target/release/essay.exe": 38385152,
  "target/release/essay-desktop.exe": 52202496,
  "apps/desktop/dist": 1640804
}
```

**These are enforced**: exceeding `baseline × (1 + tolerance/100)` fails the
run. Setting an entry back to `null` makes it informational again — the
measured size is printed with a "record this" note and the run never fails on
it, which is what all three did until the levers below were pulled and the
numbers settled.

The baselines were measured on `x86_64-pc-windows-msvc`, which is the target
the `size` job uses too (`runs-on: windows-latest`). One caveat is written
into the file itself and worth repeating: fat LTO output is sensitive to the
compiler version, so a miss of a few percent on the *first* CI run after they
landed is a toolchain difference rather than code growth — take CI's numbers
from the job summary in that case. A miss on any run after that is real.

What a local release build measures (Windows, `x86_64-pc-windows-msvc`):

| Artifact | Cargo defaults | `[profile.release]` | …and system fonts |
| --- | --- | --- | --- |
| `target/release/essay-desktop.exe` | 64.38 MB | 58.96 MB | **49.75 MB** |
| `target/release/essay.exe` | 49.23 MB | 45.79 MB | **36.59 MB** |
| `apps/desktop/dist` | 1.55 MB | 1.55 MB | 1.55 MB |

Those three columns measure the *levers*, each against the same tree. The
recorded baselines are a little above the last column — 49.78 MB, 36.61 MB
and 1.56 MB — because citations, the revision timeline, the author font
directory and the raw-HTML node landed after that comparison was taken. The
gap is the cost of those features, not drift in the levers.

**Those are unpacked binaries, and they are not the number a user downloads.**
The NSIS installer compresses with LZMA, and a binary this full of repeated
codegen compresses hard: `essay-desktop.exe` is 49.75 MB on disk and
**13.82 MB** through `lzma -6`. Judge a download against the second number and
an installed footprint against the first; quoting one for the other is how a
size conversation goes wrong.

For scale, every desktop app Essay competes with ships its own copy of
Chromium and starts around 70–130 MB of installer. Essay uses the OS WebView,
so it can carry a whole typesetting engine and still be several times
smaller.

The workspace `[profile.release]` — `lto = "fat"`, `codegen-units = 1`,
`strip = "symbols"` — is worth 5.42 MB (8.4%) on the shipped binary, and costs
roughly double the cold build time. See the comment on the profile in the root
`Cargo.toml` for why, and for the `lto = "thin"` escape hatch if that link
time ever becomes the bottleneck.

## Fonts: not in the binary any more

`typst-assets`' `fonts` feature is **off**. It was an all-or-nothing 9.23 MB —
one flag, seventeen faces, no way to pick — and no other crate in the Typst
tree enables it, so switching it off removed every byte:

| Family | Was | Reachable by Essay? |
| --- | --- | --- |
| `NewCMMath-*` (3) | 3.79 MB | No — Essay never enters maths mode |
| `NewCM10-*` (4) | 2.55 MB | No — nothing named the family |
| `LibertinusSerif-*` (6) | 1.77 MB | Yes — it was the default text font |
| `DejaVuSansMono-*` (4) | 1.12 MB | Yes — raw blocks |

`world.rs` now scans the machine's own fonts through `fontdb` instead. Measured
saving: **9.20 MB on the CLI, 9.21 MB on the desktop binary** — the whole set.

### What that cost

**A document no longer typesets identically on every machine.** Typst's default
family, Libertinus Serif, is not installed on a stock Windows, macOS or Linux
system, so `templates/essay/essay.typ` now names a *stack* — the intended face
first, then the best serif each platform actually ships. The fallback is a
decision rather than an accident, but it is still a fallback, and the same
Markdown can produce visibly different PDFs on two machines.

For a tool whose pitch is "edit the designed document", that is a real loss and
it should be weighed rather than assumed away.

### The middle option, if determinism matters more than 9 MB

Embed only the two families the template actually names — Libertinus Serif
(1.77 MB) and DejaVu Sans Mono (1.12 MB) — and keep the system database as a
*fallback* for everything they do not cover. Fonts are `include_bytes!` blobs
and compress well:

| Family | Raw | Brotli |
| --- | --- | --- |
| `LibertinusSerif-*` | 1.77 MB | 1.12 MB |
| `DejaVuSansMono-*` | 1.12 MB | 0.56 MB |
| **Core pair** | **2.89 MB** | **1.68 MB** |

That buys back byte-identical output everywhere for about 1.7 MB, still 7.5 MB
lighter than the original, and it is *better* than what shipped before: the old
embedded-only set had no system fallback at all, so a manuscript with Cyrillic
or CJK rendered as blank boxes. Embedded core plus system fallback covers both.

### Why maths was not the reason

Essay never enters Typst's maths mode, and it is easy to assume otherwise. Two
independent reasons: `essay_markdown::parse_options()` is `ParseOptions::gfm()`
plus front matter, and GFM has no maths construct, so `$…$` never parses as
maths; and the `Node::Math` arm in `convert.rs` emits `#raw(…)` — a string
literal in a monospace block — rather than Typst maths, by an explicit decision
recorded in its comment ("show it as code rather than mistranslate"). Rendering
a document containing `$E = mc^2$` prints the dollar signs. The maths faces were
never reachable, so dropping them cost nothing; see
[the build list](../roadmap.md) for what implementing maths would need.

## Where the code goes

`cargo bloat` over a non-LTO build (`.text` = 35.7 MiB of a 64.4 MiB file, so
proportions rather than absolutes — LTO takes roughly 8% off the top):

| Share of `.text` | Size | Crate | Used? |
| --- | --- | --- | --- |
| 15.3% | 5.5 MiB | `typst_library` | Yes — this is the engine |
| 8.6% | 3.1 MiB | `std` | Yes |
| 5.8% | 2.1 MiB | `tauri` | Yes |
| 3.5% | 1.2 MiB | `citationberg` | **No** — CSL citation styles |
| 3.4% | 1.2 MiB | `hayagriva` | **No** — bibliography engine |
| 2.8% | 1.0 MiB | `typst_layout` | Yes |
| 2.6% | 956 KiB | `agent_client_protocol` | Yes |
| 2.3% | 858 KiB | `wasmi` | **No** — Typst's WASM plugin host |
| 2.2% | 823 KiB | `tokio` | Yes |
| 2.1% | 768 KiB | `krilla` | Yes — PDF backend |
| 1.7% | 605 KiB | `hayro_interpret` | **No** — PDF *reading* |
| 1.5% | 557 KiB | `hayro_syntax` | **No** |
| 1.4% | 503 KiB | `rustls` | Yes — the update check |
| 1.3% | 462 KiB | `wasmparser` | **No** |
| 1.2% | 456 KiB | `reqwest` | Yes — the update check |
| 0.8% | 292 KiB | `hayro_svg` | **No** |
| 0.7% | 260 KiB | `hayro_jbig2` | **No** — JBIG2 decoder |
| 0.7% | 252 KiB | `hayro_jpeg2000` | **No** — JPEG 2000 decoder |

Three clusters stand out as capability Essay does not use:

- **Bibliography, ~2.4 MiB of code** plus its CSL style data. Entirely
  unreached — nothing in `convert.rs` emits `#cite` or `#bibliography`.
- **WebAssembly, ~1.3 MiB.** Typst can host WASM plugins; Essay never calls
  `plugin()`.
- **PDF reading, ~2.0 MiB** across the `hayro_*` crates, including JBIG2 and
  JPEG 2000 decoders — needed only to embed an existing PDF as an image.

None of it can be switched off. `typst`, `typst-pdf` and `typst-layout` expose
**no cargo features at all**, so removing any of it means patching Typst
rather than configuring it. That is the real ceiling on this binary: about
6 MiB of reachable-by-nobody code that only an upstream feature flag, or a
fork, can remove.

Everything else — about 49.7 MB — is the Typst compiler, Tauri, and the
embedded frontend. That number is why a sub-30 MB unpacked binary is not
reachable by configuration: deleting *every* font still leaves 49.7 MB, and
closing the remaining gap would need a 40% cut in compiled code.
`opt-level = "s"` and `panic = "abort"` together might manage 30% on a good
day, and the first of them slows the one hot path in the app. Getting under
30 MB unpacked means not linking Typst into the shell — a sidecar process —
which moves the bytes rather than removing them and buys IPC for something
that already runs off-thread.

`essay-cli` additionally carries the raster stack behind the `png` feature;
the desktop binary deliberately does not (see
[rendering](./rendering.md#the-png-feature-gate)).

## The frontend chunks

**The frontend is not a size problem and cannot become one.** Tauri embeds
`dist` brotli-compressed: 1.55 MB becomes 0.50 MB inside the binary, under 1%
of it. Tiptap and ProseMirror are the largest group in the bundle — 1.19 MB of
the 3.70 MB of source, 31% — and still contribute roughly 0.16 MB to a 59 MB
binary. Nothing here is worth trading editor capability for.

What the frontend *does* cost is launch parse time, and that is worth
managing. `apps/desktop/dist` is 1.55 MB and that number barely moves, because
nothing was removed — but what the window parses at launch went from 1.36 MB
to 0.93 MB (−31%) by splitting three surfaces out with `React.lazy`:

| Chunk | Size | Loaded when |
| --- | --- | --- |
| `ExplorerPane` | 249 KB | The file popover is first opened |
| `DiffReview` | 11 KB | A diff is first shown |
| `PrintPane` | 6 KB | The print pane is first opened |

`ExplorerPane` is the one that matters: the tree widget behind it is the
single heaviest import in the app, for a surface an author touches
occasionally.

The rule for what may be split is narrow — a component that renders only
behind an explicit action **and** holds no state anyone needs while it is
closed. `AgentPanel` is the counter-example and must stay eager: it stays
mounted so a running turn survives the pane being shut, and so the count of
decisions waiting can reach the header while it is closed. Making it lazy
would trade a guarantee for a number.

Two things measured and deliberately *not* done: `@phosphor-icons/react`
already tree-shakes to 109 KB and needs nothing, and `tailwind-merge` (103 KB)
is load-bearing — `AgentPanel`'s toggle passes two conflicting `text-`
utilities and relies on `twMerge` to resolve them, so it cannot simply become
`clsx`. Dropping the unused Cyrillic and Vietnamese font subsets would save
about 57 KB but means hand-maintaining `@font-face` rules, which is a poor
trade for a page loaded from local disk.

A missing artifact with a baseline is a failure; a missing artifact with no
baseline is not.

Two naming traps the file documents in its own `_note` fields, worth repeating:
`essay-cli`'s `[[bin]]` is named `essay`, so it builds to
`target/release/essay.exe`, not `essay-cli.exe`. `essay-desktop` has no `[[bin]]`
override, so its binary matches the package name.

The script runs under both `bun` and `node` and has no dependencies. Paths are
resolved from the script's own location, so the caller's working directory does
not matter.
