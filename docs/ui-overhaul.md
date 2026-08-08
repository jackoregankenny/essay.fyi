# UI overhaul — direction

> Status: agreed direction (Jack, 2026-08-06), not yet built. Supersedes the
> chrome described in the "Current state" section of `CLAUDE.md`. The
> non-negotiable invariants in that file are unaffected; this document is
> about what is on screen and when.
>
> Governing decision (Jack, 2026-08-06): **authoring first; typesetting
> after, in the flow.** The application is built around the act of writing.
> The typeset document is a later stage of the same document's life — not a
> parallel view competing for attention while the argument is still moving.
> Essay is free; the budget is taste and craft, and it is spent on the
> writing surface before anywhere else.
>
> Positioning (Jack, 2026-08-06): the competition is Notion, Obsidian, and
> their kind, and they fail twice — they don't do **focused writing as
> thinking** (a database wearing a document costume; a graph that happens to
> hold prose), and they don't produce **good outputs** (print, PDF, blog).
> Essay's wedge is being excellent at exactly those two things, in that
> order. Every chrome decision above serves the first; the finishing flow
> serves the second.

The current chrome was derived from a text editor. That is not a styling
observation — every structural decision in it is a VS Code decision, and each
one costs the product something the brief explicitly asks for.

## What is inherited, and what it costs

**Document tabs.** A programmer keeps eight files open because a change spans
eight files. A writer has one manuscript. Tabs make the *file* the unit of
attention where the brief says the unit is the *section*.

**The write ⊕ preview mode switch.** VS Code's markdown preview toggle. The
brief says print is first-class and visible throughout writing; the footer
currently hides the page count unless the author is already in preview mode,
so it is impossible to notice that a two-page memo became four without
leaving the manuscript. A toggle makes print a destination.

**The sidebar as a stack of panes.** Outline + Marks + History in 232px is the
activity-bar model: three unrelated tools in a column too narrow for any of
them. History is a timeline and wants width. The brief's STRUCTURE pane wants
word counts, page weight, change activity, unresolved markers and pending
proposals — none of which fit beside two other panes.

**The agent right rail.** Cursor's layout. `DiffReview` already opens
`absolute inset-0` over the manuscript column, which is the code conceding
that the rail is the wrong home for review.

The deeper miss: all three of the brief's coordinated views exist, and the app
never shows more than two of them or coordinates any of them.

## The spine

Three zones and no others.

```text
┌─┬──────────────────────────────────────┬──────────────────┐
│▏│                                      │ COMPANION        │
│▍│  MANUSCRIPT                          │                  │
│▏│                                      │  one thing:      │
│▎│  The current draft...                │  Structure,      │
│▏│                                      │  Proof, Agent,   │
│▊│                                      │  or History      │
│▏│                                      │                  │
│▎│                                      │                  │
└─┴──────────────────────────────────────┴──────────────────┘
 ▲ the gutter                             ▲ remembered per document
```

### 1. The manuscript — always

The centre, always present, never replaced. Layers open over it; nothing
takes its place.

### 2. The gutter — always, ~14px

A semantic spine, not a minimap. Each section is a tick sized by its word
count; the current section is lit; a dot marks a `==come back to this==`, a
pending agent proposal, or a section changed since the last checkpoint.

This exists to resolve a real tension in the one-companion-slot decision:
navigation is *continuous* — an author wants to know where they are all the
time — but the outline should not therefore win a permanent pane over the
page. The gutter answers "where am I, how long is this, what is pending" for
free, and expands into the companion when the answer needs words.

### 3. The companion — one slot, right side

Exactly one tenant at a time, remembered per document, cycled by keystroke:

- **Structure** — the brief's pane, finally: headings, word counts, page
  weight, change activity, unresolved markers, pending proposals.
- **Proof** — the typeset Typst output. Not a mode; a thing you consult.
- **Agent** — the transcript. A conversation earns persistent adjacency.
- **History** — the revision timeline.

One slot is the whole discipline. Two rails is how a writing tool becomes an
IDE, and it is what today's layout does.

### Layers — full-bleed over the manuscript, Esc to dismiss

Review (`DiffReview`), Templates, Fonts, Explorer. This generalises the
pattern `DiffReview` already proves: a reading task wants full measure and
wants the editor left mounted underneath with its selection intact.

## The flow: writing, then finishing

Decided 2026-08-06: writing and typesetting are deliberately different acts,
and they are *sequenced*, not juxtaposed. A document moves through the flow:

```text
   WRITING ──────────────────────────► FINISHING
   the argument is moving              the argument has landed
   companion: Structure / Agent /      companion: Proof
   History                             layers: Templates, Fonts
   surface: Prose                      surface: Prose or Page
```

This is a posture, not a mode switch — nothing locks, nothing is hidden, the
author drifts between the two as the work does. But the *defaults* follow the
flow: a fresh document opens in Prose with no typesetting furniture anywhere;
Proof, Templates and Fonts are things the author reaches for when the
document is ready to be dressed. Typesetting never interrupts writing —
it is where writing *goes*.

The surface has two dresses, and the author picks:

- **Prose** (default, and the craft priority) — screen typography, the
  `--essay-measure` preference, generous leading, no page furniture. The
  surface for an unformed document. `prose.css` is already this surface's
  foundation and is good; the overhaul's polish budget deepens it rather
  than replacing it.
- **Page** — the manuscript at the template's real geometry: the template's
  measure and face, page-break rules in the flow, page numbers in the gutter.
  Still Tiptap, still editable, still not an SVG. The surface for late work,
  where composition is the question.

**Proof** — the actual Typst render — is neither. It is a companion tenant you
consult before exporting. The three names do real work: an author who says
"page" means the dress, and "proof" means the output.

Cost, stated: Page mode needs page-break positions mapped out of Typst and
back onto ProseMirror positions. That is the hardest item in this document and
it sits in the finishing half of the flow — Prose mode is the default and the
overhaul is complete without it.

## Where the craft goes: the authoring surface

"Super high taste" is not a coat of paint at the end; it is a list of specific
places where care is perceptible while writing. In priority order:

1. **Type and rhythm.** `prose.css` already holds the right opinions (shallow
   heading contrast, reflowed hard wraps, the accent caret as the one
   saturated element). Deepen: a serif prose option alongside Geist — this is
   essay writing, and the machine's serifs are already scanned by
   `essay-render`'s font machinery; hanging punctuation; real small-caps for
   h5/h6; tuned dark-mode ink rather than inverted grey.
2. **Motion.** One easing curve, one duration scale, applied everywhere:
   layers that settle rather than pop, the gutter's current-section light
   gliding, the companion sliding as one plane. Motion is most of what
   separates Linear-class chrome from Electron-class chrome.
3. **The caret's neighbourhood.** Focus mode and typewriter scroll exist;
   make them feel inevitable — dimming as a gradient of attention rather
   than a binary, the selection toolbar arriving on a beat instead of
   instantly.
4. **The empty and in-between states.** A new document, an empty outline, a
   finished agent turn, "saved". Every one currently a plain string; each is
   a place where tone lives.
5. **Ordinary editing affordances done beautifully** — the audit's gaps:
   table row/column controls on the selection toolbar, image insert with
   drag-drop, find with its two options. Craft includes completeness.

## Templates become a product surface

Today there is one template, `include_str!`'d at compile time, with a fixed
`essay(title, author, date, body)` signature. `templates/memo`, `rfc` and
`report` are README stubs. There is no selection mechanism, no per-project
override, and no UI.

The brief promises "a small set of exceptional templates". The ambition agreed
is stronger than that: templates are part of what makes Essay worth using —
a library with the finish of a design system, not a formatting dropdown.

Three pieces:

**Resolution.** Front matter `template: memo` selects it. Lookup order:
document folder → project `.essay/templates/` → the embedded set. A template
that names itself in front matter is portable with the file, which keeps
invariant 1 — the Markdown still opens anywhere, it just typesets plainly
elsewhere.

**A manifest.** Each template declares its name, description, and the
front-matter keys it accepts (`recipient` for a memo, `status` for an RFC).
The manifest is what lets a surface exist at all: without it a picker can only
list filenames, and the author has to read Typst to learn what a template
wants.

**The picker** — a layer. Each template is shown as a real rendered first page
*of the author's own document*, not a stock sample; `essay-render` already
emits PNG, so this is cheap and it is the single most demonstrable thing in
the overhaul. Choosing a template writes `template:` into front matter and
shows a short form for the keys the manifest declares. "Duplicate and edit"
drops the `.typ` beside the document and opens it.

## What dies

| Component | Replaced by |
|---|---|
| `DocumentTabs` | Quick-open over the recents already recorded |
| `ModeSwitch` | The Prose/Page dress toggle; Proof as a companion |
| `FilesPopover` | Quick-open |
| `Sidebar` pane stack | Gutter + the Structure companion |
| Marks pane | Gutter dots, and a section in Structure |
| Footer stat strip | One quiet status line; counts live in Structure |

## What survives, and how it changes

- **`CommandPalette`** — grows into the primary surface. Commands, quick-open
  and search in one place. It stops being a fallback menu and becomes how the
  application is driven, which is the part of "Superhuman" worth taking.
- **`DiffReview`** — already the right shape. Becomes the model for all layers.
- **`AgentPanel`** — becomes a companion tenant. Must stop being fixed at
  340px and take the slot's width.
- **`PrintPane`** — becomes the Proof tenant, and later supplies page-break
  positions to Page mode.
- **`ExplorerPane`** — becomes a layer, not a rail. Multi-root browsing is a
  deliberate act, not an ambient one.
- **`FontsPage`** — joins Templates as the typesetting layer.
- **`Notice`**, **`SelectionToolbar`** — unchanged; both are already right.

## Build order

Staged so the application stays usable throughout, and ordered by the flow:
everything an author touches while *writing* lands before anything they touch
while *finishing*.

1. **The spine.** ✅ Done (2026-08-06). New `Workspace` shell: gutter
   (`Gutter.tsx`), manuscript, companion slot (`Companion.tsx`, tenant
   remembered per document under `essay.companion.v1`), layers. Tabs, the
   mode switch, and the files popover are deleted; quick-open lives in the
   palette (recents on empty query, filename match across roots on a query);
   the explorer is a palette-summoned layer ("Browse folders…"). Ctrl+B →
   Structure, Ctrl+J → Proof, Ctrl+Shift+A → Agent. Known step-2 debts:
   `@pierre/trees` carries its own dark surface and reads as a slab inside
   the light explorer layer; the gutter centres its tick stack and will
   overflow past ~40 sections; the agent tenant stacks its own header under
   the companion's switcher row.
2. **The authoring surface.** ✅ Substantially landed (2026-08-06). Type and
   rhythm: serif prose option (`proseFont.ts`, palette "Prose face",
   `data-prose-font` on the root, Charter-first stack in theme.css with a 4%
   x-height compensation), real small-caps h5/h6, editorial blockquote,
   hanging punctuation, heading-proximity margins. Motion: three-speed scale +
   `--essay-ease-swift` in theme.css with usage rules; companion slides in on
   a transform (grid track never animates), tenant switches cross-fade on a
   stage wrapper that never remounts the agent; gutter's light glides and the
   tick stack scrolls past ~40 sections. States: rotating blank-page
   placeholder, outline empty state, footer speaks the durability layer's
   truth ("safe on disk" / "only in memory — ⌘S gives it a home").
   Affordances: table row/column/delete controls in the selection toolbar
   (appears on a bare caret in a table), image insert with document-relative
   path discipline, find's case/whole-word pills (Alt+C/Alt+W) wired through
   `runSearch`. Remaining for later passes: focus-mode dimming as a gradient,
   image drag-drop, an Image node view so absolute-path images preview in the
   webview (asset protocol), motion on the full-bleed layers.
3. **Structure.** Build the brief's pane properly. Fold in marks. Retire the
   Marks pane.
4. **Templates.** Resolution, manifest, picker layer, front-matter form. The
   first finishing-flow surface, and the most demonstrable one.
5. **Page mode.** The second dress. Needs Typst page-break mapping.

There is no separate "style pass" stage any more: with authoring craft as
step 2, the visual language is developed on the surface that matters most and
the finishing surfaces inherit it.

## Direction shift (Jack, 2026-08-07)

The Linear-derived light theme and the bar chrome were placeholder. The
identity now:

- **Dark-first.** `@essay/theme` defines dark at `:root` (deep neutral
  graphite, canvas one step lighter, azure accent); light is the explicit
  choice via `data-theme='light'`. Grotesque sans voice; Typora-class
  clarity with Essay's file management and typesetting as the wedge.
- **No bars.** The top controls and the status line float over the canvas
  (letters, not bars); the canvas runs edge to edge. Both live inside the
  manuscript column so the companion keeps its own frame.
- **The chrome recedes with flow.** Sustained typing (>~1.2s of close-spaced
  doc changes) sets `data-typing` on the root and `.essay-chrome` eases to a
  murmur — slow out, quick back on pointer movement. Distinct from focus
  mode, which is the author's explicit ask (Ctrl+Shift+F now toggles it; the
  typewriter centring glides rather than snaps).
- **The gutter fan** resolves label collisions by isotonic regression —
  labels spread to a 28px rhythm while staying anchored to their ticks.

Wanted next (Jack): cheap-LLM read-through critique surfaced in the sidebar
(read, not edit); top/bottom chrome may be revisited again; macOS
traffic-light rendering needs verification on hardware; table editing to
top-notch.

### Long-form surface rules (2026-08-07)

Jack's correction: Typora earns calm by hiding almost everything in menus;
Essay must keep the calm while bringing its real capabilities to the surface.
The wrong synthesis is a row of permanent tabs or a Notion-style catalogue at
every empty line. The manuscript is the coordinate system, and a capability's
**scope** decides where it appears.

These are load-bearing rules for every feature added from here:

1. **The manuscript is the only persistent plane.** Filename, durability,
   update state, and the command key may remain ambient. Everything else must
   be earned by document state or explicitly summoned.
2. **One secondary reading at a time.** Files, Structure, Proof, Agent, and
   History never accumulate as neighbouring rails. Opening one closes the
   other. Review may coexist with Agent only when the transcript is the
   provenance needed to decide the review.
3. **Empty surfaces never occupy space by default.** A missing bibliography
   does not reserve a bibliography region and an empty outline never opens on
   launch. But an explicitly summoned reading must answer: Structure may say
   that headings will gather there. Minimalism must not make a visible control
   appear broken.
4. **Placement follows scope.** Selection acts (link, citation, footnote,
   highlight) live at the selection. Block acts (list, table, figure, quote,
   section or page break) live at the current block's margin. Document
   furniture (bibliography, headers, footers, template, pagination) lives in
   the finishing flow beside Proof. Project and machine acts (files, folders,
   fonts) are summoned layers or menus.
5. **No generic feature drawer.** The command registry is shared plumbing,
   not the product's information architecture. The palette remains a fast,
   complete escape hatch; frequent acts also appear at their natural locus.
   A slash menu is allowed only if later evidence shows that the block margin
   cannot carry block insertion with less interruption.
6. **Expose state before containers.** The progression is state → quiet mark
   → local verb → larger reading. Agent work first appears as a section mark
   or pending count; only an author's action opens the transcript. Citations
   first appear in prose; management opens from one of those citations or
   from finishing.
7. **Cards are exceptional.** A surface gets a fill only when it must occlude
   arbitrary prose (palette, review, destructive notice). Files and companion
   readings use the manuscript canvas, flat type, and at most one hairline.
8. **Opening tools must not cover words.** A persistent reading claims a real
   layout track and may reflow the manuscript once; the editor stays mounted
   with its selection and scroll intact. Transient review layers may cover the
   manuscript only because reading the review is the task.
9. **Long-form geometry is a feature.** This is a working manuscript, not a
   reader-mode article: Auto uses 92% of the available canvas up to 58rem.
   Narrow and Normal are deliberate reading measures; Full is available for
   wide tables, technical work, and author preference. The first line begins
   between 8rem and 11rem from the top.
10. **Persistent state owns real space.** Word, section and known page counts,
    durability, and pending agent decisions never sit over editable text.
    Their row has no separate material, but it is reserved in layout and its
    view verbs stay legible: Structure, Proof, Agent, History.
11. **Motion explains origin, then disappears.** A summoned reading settles
    2–4px from its trigger in 100–180ms. No bounce, scale spectacle, or
    continuous motion while typing; reduced motion preserves the state change.

The current shell follows those rules as one continuous-material workspace:
the running head and status own reserved rows; Files and the active document
panel own real grid tracks; manuscript, Files and panel use the same canvas
without framing borders or separate fills. Structure, Proof, Agent and History
remain explicitly switchable in quiet type. Opening Files closes the document
panel so the manuscript is never squeezed between two peripheral surfaces.

The short rule: **expose verbs, not containers; expose them where their effect
lives.**

### Agent presence is local; review expands with risk

Agent is not merely a fourth document view. ACP provides a transcript and
session control, but Essay's product value is that an agent acts visibly on a
specific part of a long manuscript and the author retains editorial control.

- Invocation begins with a selection, or the current section when there is no
  selection. The section/selection is named in the composer before work starts.
- `toolCall.locations` light the blocks being read or edited through editor
  decorations and the semantic gutter. Activity belongs beside the prose, not
  only in a chat transcript.
- A proposal attaches persistent markers to the sections named by
  `SectionChange`. A direct on-disk write gets a firmer marker because the
  bytes have already landed and the available decision is Review/Revert.
- A scoped edit opens its diff at the affected section. Multi-section edits or
  anything `looks_like_a_rewrite()` escalate to the existing full-width
  `DiffReview`, beginning with the structural overview.
- The transcript remains available and mounted while an agent works, but it is
  secondary to location, proposal, provenance and diff. Closing the transcript
  never hides that an author decision is waiting.

The surface hierarchy therefore has three scopes: global commands above the
document; document readings such as Structure, Proof and History; and local
agent activity attached to selections and sections. They may share command
plumbing, but they must not be flattened into one generic feature drawer.

## Gaps that fold into this

From the 2026-08-06 audit, capabilities that are built but unreachable, each
with a natural home in the new spine:

- **Search options** (`caseSensitive`, `wholeWord`) — implemented in
  `essay-search`, typed in `lib/search.ts`, never set by any caller. They
  belong in the palette's search mode. Cheapest gap in the project.
- **Table editing** — `TableKit` is loaded and `insertTable` exists, but there
  is no row/column/delete affordance anywhere. A table selection should give
  `SelectionToolbar` table controls.
- **Image insert** — the `Image` extension round-trips, but there is no
  command, no drag-drop, no picker. Belongs in Insert, and in a drop handler.
- **`index_document`** — a registered Tauri command with no caller. Either the
  Structure pane starts using the Rust index, or it should be deleted.
