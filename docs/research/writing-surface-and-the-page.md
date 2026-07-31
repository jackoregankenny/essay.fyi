# The writing surface and the page

Status: design decision record, 2026-07-31. Synthesizes six competitive research reports (word processors, Markdown writers, typesetting tools, screenwriting tools, modern hybrids, pagination vocabulary). Governs Milestone 2.x work on the editor and `essay-render`.

---

## 1. Positioning

Essay's writing surface stays a **continuous, pageless canvas with ambient page truth drawn onto it** — the Final Draft Normal View / Slugline model, not Word's Print Layout and not Docs' pageless cliff. The evidence for this is unusually consistent. Every pageless-first product without page awareness turns export into its worst-rated feature (Notion's exporter has spawned a Chrome-extension economy; Coda's PDF bug stood three years; Scrivener's compile-only pagination is the most-hated UX in its category). Every fully paginated surface taxes each editing minute with paper chrome, and view-mode churn is radioactive — users bond with their representation (Google walked pageless defaults back; Word users still mourn Draft view). The one genre that solved "calm surface *with* live pages" is screenwriting, where pagination is money: a continuous scrollable column in which page breaks are subtle inline lines with a margin page number, artifacts like (MORE)/(CONT'D) are phantom overlays never written to the file, and full paper simulation is a separate opt-in view. That is exactly Essay's shape: Tiptap canvas = Normal View, Ctrl+J Preview = Page View, canonical Markdown = the Fountain file.

Essay can be the *first* tool to do this for prose, because it uniquely owns both halves. The Markdown-writer family (Typora, Obsidian, Bear, Ulysses) exports blind — Typora issue #1436 ("how can I know where page breaks before export") has sat unanswered since 2018 — and their HTML→PDF engines cannot even honor `break-after: avoid`, so stranded headings are unfixable across the entire family. Essay renders through real Typst, whose 0.12+ engine gives sticky headings and widow/orphan prevention by default and recompiles typical documents in ~30–50 ms. So the positioning is: **calm canvas, truthful ghost pages, and "no stranded headings, ever" as a headline differentiator** — page *feedback* lives in the Write view, page *rendering* lives in Preview, and both are projections of one Markdown file plus one Typst layout pass. The invariant that makes this safe: the writing column never reflows because of pagination — only markers move (screenwriting's proven trick), so typing latency is untouched and invariant 5 holds by construction.

## 2. Page awareness while writing

All affordances below are fed by the existing `usePreview` render loop (500 ms debounce, latest-wins) plus a new source map (§5, step 1). None of them mutate the ProseMirror document — they are decorations and sidebar data. Ranked:

### Must-have

**M1. Ghost break lines with margin page numbers.** A 1px horizontal rule in `--essay-border-subtle` spanning the text column at each computed break position, with the *incoming* page number set small (Geist 510, 11px) in the left margin gutter — Slugline's "subtle gray line… and you'll see the page number there too." Manual breaks (author-inserted, §3) render as a slightly heavier labeled line ("Page break") — Excel's grammar: **dashed/faint = computed, solid/labeled = authored**. Updates ≤1 s after typing pauses (existing debounce). Anti-disturbance rules: rendered as ProseMirror **widget decorations between blocks** — zero effect on line wrapping or block layout; positions are mapped through document edits between renders, and while a render is pending, existing lines dim to 50% opacity rather than disappearing (the Typst-forum lesson: "the second the live preview is lost, the illusion is broken"). Never draw a ghost line mid-paragraph in v1 — snap to the nearest block boundary; intra-paragraph precision is Preview's job.

**M2. Ambient page count in the footer.** "Page 3 of 7" (page containing the caret, of total) in the existing slim footer next to word count — Slugline's bottom-left, fountain-mode's mode line. This is the zero-cost "has my two-page memo become four" signal (Word's status bar precedent). Updates with each completed render; shows a subtle stale dot while a render is in flight. Never a popover, never animated.

**M3. Per-section page spans in the outline.** Each outline entry gains "pp. 3–5" beside its existing word count. This is the top user-requested Highland feature verbatim ("I have three 9-page scenes in a row — I'll want to break those up") and Ulysses proves the demand by shipping "Pages" as a goal unit *faked* from a words-per-page constant; Essay's number is true. Same update cadence as M1; plain text in the existing sidebar, no layout cost.

### Later

**L1. Keep-violation indicators.** When Typst cannot honor a keep rule (an unbreakable table taller than a page, a sticky chain that overflows), show a small amber marker in the margin gutter — InDesign's Keep Violations highlight: admit failure visibly instead of letting invisible rules shove content mysteriously. Note we do *not* need stranded-heading *warnings*: Typst's sticky-heading default means stranded headings don't happen; we only need to surface the rare cases where prevention itself misbehaves.

**L2. Page-weight heat in the outline.** Sections whose span exceeds a configurable page budget get a quiet tint — the Ulysses goal-ring idea (blue/green/red) applied to real pages.

**L3. "Pull back a page" levers.** Fade In's Format > Cheat family (tighten spacing within a threshold to reclaim a widowed page). Pros want to *change* the count, not just see it. Post-Milestone-3; requires template-parameter plumbing.

Explicitly rejected: paper simulation in the Write view (Scrivener's Page View is documented by its own vendor as "an aesthetic preference, not a print preview tool" — a fake page that lies is worse than no page), and any always-on Word-style page chrome.

## 3. Page-break control

The vocabulary is deliberately small: four controls, each reducing exactly to a Typst primitive (`pagebreak(weak:, to:)`, `block(breakable:)`, `block(sticky:)`, `text(costs:)` — anything the UI promises must reduce to these; Typst has no keep-with-next-N-lines or numeric widows, so we don't promise them). Two-layer model throughout, per Word's history and the pandoc ecosystem: **breaks are content (stored inline in the file); keep policies are style (stored in frontmatter or the template)**. Hard breaks that rot under editing are the community's canonical hate object; policies travel with content.

### 3.1 Explicit page break

- **Markdown:** `<!-- pagebreak -->` on its own line.
  Justification against the alternatives: `\newpage` renders as literal garbage text on GitHub/Obsidian; `<div style="page-break-after: always"></div>` is noisy in source and an eyesore in every plain-text diff; `===` is not inert Markdown — under a paragraph it is a **setext heading underline**, so it can silently retitle the author's document in other renderers (disqualifying, despite the Craft/Fountain/Notion-Backups convention); repurposing `---` collides with authors who use thematic breaks as scene dividers (only viable as an opt-in policy, never storage). The HTML comment is Marked 2's `<!--BREAK-->` pattern: **invisible in every other renderer, degrading to nothing rather than to garbage**, zero collision surface, and pandoc-ext/pagebreak proves the one-directive→many-formats mapping is solved prior art. We accept `\newpage`, `\pagebreak`, and the style-div as *import* synonyms (normalized on the next save only if the block is otherwise touched — round-trip discipline).
- **Typst mapping:** `#pagebreak(weak: true)`. Weak, always — AsciiDoc's `<<<` and Typst agree that "skip if the page is already empty" is the correct default; it makes manual breaks idempotent with structural policies and can never stack blank pages. We do not expose a strong/weak distinction (LyX shipped TeX's `\newpage`-vs-`\pagebreak` confusion straight to authors and reaped bug reports; the editor picks the right primitive).
- **Editor UI:** command palette "Insert page break" (the missing gesture the whole Markdown family begs for — Typora #5587, Obsidian's 16k-download `/break` plugin); a `---`-style input rule is *not* provided (see setext risk); renders in the canvas as a slim labeled marker block (Craft's pattern — on-screen divider and hard break, one object, two projections) with a context menu: Remove, and later "Break to odd page" (→ `<!-- pagebreak to=odd -->` → `#pagebreak(to: "odd")`, deferred until duplex/binding support exists).

### 3.2 Keep-with-next (sticky)

- **Default:** free. Typst headings are `block(sticky: true)` out of the box; `convert.rs` inherits it. This is Word's heading-style default reproduced without the author ever learning the feature exists — the single strongest pattern in the word-processor report.
- **Markdown:** nothing stored for the default. Per-instance override (rare) as a directive comment on the preceding line: `<!-- keep-with-next -->` → wrap the element sticky. Ship the default now, the directive later.
- **UI:** none needed in v1. Later: block ⋮ menu toggle.

### 3.3 Avoid-break-inside (keep together)

- **Default policy first, syntax second:** template policy "tables ≤ 12 rows and all figures are unbreakable" via `show table: set block(breakable: false)` (tables are where the page boundary hurts most — the Word/Docs perennial). Tables over the threshold break with a repeated header row (Typst `table.header`).
- **Markdown (per-instance):** `<!-- keep -->` on the line before a block → that block emitted inside `block(breakable: false)`. Comment-directive carrier for the same reasons as 3.1; Pandoc header-attributes were rejected because Obsidian/GitHub render the braces literally.
- **UI:** bubble-menu / block menu "Keep on one page" toggle for tables, figures, and blockquotes.

### 3.4 Widows/orphans and structural break policy

- **Default:** prevention ON — Typst's `text(costs:)` default already matches Word's default-on. Binary in Typst today; we do not promise "minimum 3 lines."
- **Markdown:** document frontmatter only (Quarto precedent — policies in YAML, breaks inline):

  ```yaml
  page-break-before: h1        # off | h1 | h1,h2 — emits show-rule pagebreak(weak: true)
  widows: prevent              # prevent | allow — maps to text(costs:)
  ```

  `page-break-before: h1` is the Ulysses `heading-1 { page-break: before }` / Typora "Page Break Between Top Headings" checkbox, done as data. Because the emitted break is weak, it composes safely with manual breaks.
- **UI:** command palette toggles ("Start H1 sections on a new page") writing frontmatter; surfaced later in a document-settings panel.

**Not supported, on purpose:** keep-with-previous, needspace, weighted break preferences (no Markdown prior art, marginal Typst support, confusing interactions even in InDesign), and per-paragraph widow counts (Typst can't). Per-section page geometry (landscape table pages) is deferred: Typst's `set page` mid-document forces a break by construction — a known footgun we won't expose until the semantics are presentable.

## 4. The preview step's role

Preview (Ctrl+J) is the **truthful page surface** — PanWriter's rule: the preview *is* the export, pixel-identical, never an approximation. What belongs there and not in Write:

1. **Click-to-jump (inverse sync), must-have.** Click anywhere on a rendered page → caret moves to the corresponding Markdown span and Preview closes (or, in a future split view, the editor scrolls). Because `convert.rs` is our own emitter, we can thread source spans through to Typst introspection and beat SyncTeX's line-level approximation with span-accurate mapping — the headline interaction that makes two surfaces feel like one app (tinymist/Edist baseline). Forward sync (open Preview scrolled to the caret's page, that page subtly highlighted) ships with it. Ambient always-on cursor-follow is deferred and, when it comes, gated (tinymist users asked for Ctrl+click damping; collaborative-yank complaints on typst.app).
2. **Page furniture.** Headers, footers, page numbers, running heads, front-matter numbering — visible only here and in export, suspended in Write (Docs pageless/Craft pattern: suspended losslessly, toggled at export).
3. **Per-page diagnostics.** Overflow indicators (content clipped by an unbreakable block), keep-violation flags with jump-to-source, short-page indicators after strong breaks. Preview is where you *manage* pages; Write only *sees* them.
4. **Break editing in place.** Right-click in the gap between two pages → "Insert page break before …" (writes the comment directive at the mapped span). **Drag-a-break is rejected**: in a reflowing text document, dragging a boundary has no stable meaning — Excel's drag works because rows are fixed-height cells. The Fade-In-style levers (L3) are the honest version of "move this break."
5. **Render discipline (hard requirements).** Never reset scroll/zoom across recompiles — update pages in place (Overleaf's browser-viewer reset-to-page-1 is universally hated). On transient converter/Typst errors, keep the last good render on screen with a visible stale badge — never blank, never silently frozen. Render only visible pages ±1 for long documents (tinymist partial rendering) once documents exceed ~30 pages.

## 5. Build order

| # | Step | Scope | Effort |
|---|------|-------|--------|
| 1 | **Source map through the pipeline.** Emit per-block source spans in `convert.rs` (Typst `metadata` + labels or a span sidecar); after layout, query page geometry to produce `{page, y} ↔ markdown byte-range` for every block. Extend `render_document`'s return payload; index by `DocumentIndex` block ids. Everything below consumes this. | `essay-render`, `src/lib.rs` | **L** |
| 2 | **Footer "Page N of M" (M2).** Total pages from the render result; caret-page from the step-1 map. Stale dot while rendering. | `usePreview.ts`, footer | **S** |
| 3 | **`<!-- pagebreak -->` end-to-end (§3.1).** Parse/serialize in `essay-markdown` (+ import synonyms), golden-file round-trip fixtures, emit `#pagebreak(weak: true)`, Tiptap atom node rendering the labeled marker block, palette command "Insert page break", context-menu Remove. | `essay-markdown`, `essay-render`, `@essay/editor` | **M** |
| 4 | **Ghost break lines (M1).** Widget decorations at step-1 break positions, margin page numbers, dashed-vs-solid grammar, position mapping across edits, 50%-opacity stale state. | `@essay/editor`, `usePreview.ts` | **M** |
| 5 | **Outline page spans (M3).** Join step-1 map with the existing outline/word-count helpers; render "pp. 3–5". | `@essay/editor`, sidebar | **S** |
| 6 | **Preview inverse/forward sync (§4.1).** Hit-test SVG pages against the step-1 map; click → caret; Ctrl+J opens at caret's page. Also: preserve scroll/zoom across recompiles, stale badge on error. | `usePreview.ts`, preview pane | **M** |
| 7 | **Frontmatter policies (§3.4).** `page-break-before`, `widows` read in front-matter lift → show rules in the emitted prelude; palette toggles that write frontmatter. | `essay-render`, palette | **S** |
| 8 | **`<!-- keep -->` + table policy (§3.3).** Unbreakable-block directive, default table/figure keep policy with repeating headers, bubble/block-menu toggle. | `essay-markdown`, `essay-render`, `@essay/editor` | **M** |

Steps 2–5 each degrade gracefully if step 1's map is coarse (block-level is sufficient for v1). L1/L2/L3, parity breaks, per-section geometry, and partial-page rendering queue behind these — after autosave and crash recovery, which remain ahead of everything here in the overall roadmap.