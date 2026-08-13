# Authoring and structured-editing build list

> Planning record, 2026-08-07. This is the implementation list for the
> manuscript interaction itself. It complements
> [Working material around the manuscript](./long-form-materials.md) and the
> [UI overhaul](./ui-overhaul.md).

## Product decision

Essay should understand blocks without looking like a block editor.

The manuscript already has structure in ProseMirror and Markdown: paragraphs,
headings, lists, quotes, tables, figures and code. That structure should power
selection comments, section moves, agent scope, reliable anchors and local
commands. It should not turn every paragraph into a card, add a drag handle to
every line or make `/` the front door to the product.

The author-facing units are:

- a normal text selection for “we say X here,” critique, rewrite, citation and
  extraction;
- the current block for inserting or changing a figure, table, quote or list;
- a section and its descendants for navigation, status and rearrangement;
- the manuscript for search, finishing, history and whole-document review.

The rule is: **structured operations, not a block-shaped interface**.

## Priority order

### P0 — Make ordinary writing trustworthy

These are credibility requirements, not cleanup after the AI product. They
should advance alongside the document-work features and may interrupt them
when ordinary friction is worse.

#### 1. A real in-manuscript find bar

Current state: `essay-search` searches the flattened live buffer and the
project; `Ctrl+F` routes through the command palette and reveals one result.
There is no next/previous, replace or all-match decoration.

Build:

1. Move `Ctrl+F` to a slim find strip belonging to the manuscript. Keep project
   search and Quick Open in the palette.
2. Reuse `manuscriptText()` and `positionAtOffset()`; add an editor plugin that
   paints every current-buffer match with ProseMirror decorations.
3. Add Enter/Shift+Enter and explicit previous/next controls, a current/total
   count, case sensitivity and whole-word matching.
4. Scroll only the active match into view. Do not disturb the author’s search
   selection when the query changes.
5. Add Replace and Replace all after navigation is solid. Apply replacements
   from the end of the document, in one undo transaction. A match spanning
   block boundaries must be findable but not replaceable until its structural
   semantics are defined.
6. Recompute on editor transactions with a short debounce; decoration work
   stays in memory and never calls Rust while typing.

Acceptance:

- matches that cross bold, italic or link marks are found and highlighted;
- emoji, accented text and em dashes land on the correct ProseMirror range;
- next/previous wrap predictably and replacement is one undo step;
- opening and closing find does not remount the editor or lose the original
  caret;
- a 50,000-word fixture remains responsive.

#### 2. Spellchecking that is explicit and cross-platform

Current state: the manuscript does not explicitly configure spellchecking.
The three WebViews may provide different defaults; the palette alone sets
`spellCheck={false}`. That is not a product guarantee.

Build:

1. Run a macOS/Windows/Linux capability spike: visible misspelling marks,
   context-menu suggestions, language choice, add-to-dictionary and offline
   behaviour. Record the matrix before selecting an engine.
2. If the native WebViews meet the floor, set `spellcheck="true"` explicitly
   on the manuscript, expose document language and keep dictionaries local.
3. If one platform fails the floor, evaluate a local dictionary engine behind
   the same editor decoration boundary. Do not introduce a network grammar
   service or send prose off-device.
4. Keep spellcheck decoration separate from comments, search matches and agent
   locations so one feature can be toggled without rebuilding the others.

Acceptance:

- works offline on all three supported desktops;
- code blocks, URLs and citation keys are not treated as prose;
- spelling marks do not leak into Markdown or print;
- typing does not wait on a dictionary scan.

#### 3. Images that behave like manuscript content

Current state: the Image extension, native picker, relative-path discipline
and Typst `#image()` output exist. A local path still needs a Tauri asset URL at
render time, and drag/drop, broken-image repair and metadata editing are absent.

Build:

1. Add an Image node view that uses `convertFileSrc` only for WebView display
   while retaining the original Markdown `src` in editor state and on save.
2. Add drag/drop and paste-file insertion through the same `imageSrc()` path
   policy as the picker. Never copy or relocate a file without asking.
3. Add a local image toolbar for alt text, title, replace and reveal/open.
   Broken paths remain visible and repairable.
4. Define figures separately. Standard Markdown image syntax has no portable
   caption or width; do not hide proprietary layout state behind a supposedly
   portable image. Choose and document a plain-text figure spelling before
   adding captions or print sizing.

Acceptance:

- relative paths survive save and folder moves;
- the editor and Typst resolve the same file;
- alt text and title round-trip in golden files;
- a missing image never becomes a blank, unselectable node.

#### 4. Tables good enough for real reports

Current state: table insertion, GFM-preserving serialization and add/delete
row/column controls exist. Tables are deliberately non-resizable because GFM
cannot store widths.

Build:

1. Finish keyboard navigation: Tab/Shift+Tab, predictable arrow movement and
   row creation at the final cell.
2. Add row/column selection, insert-before/after, header-row toggle and
   left/centre/right column alignment.
3. Paste TSV/CSV-shaped clipboard data into a selected cell range and copy a
   selection back as tabular text.
4. Give wide tables a deliberate full-measure/overflow treatment without
   narrowing the rest of the manuscript.
5. Add table captions and widths only after choosing a portable source syntax
   or clearly removable presentation state. Do not imply that GFM stores what
   it does not.

Acceptance:

- every structure command has keyboard and contextual access;
- alignment markers and compact source formatting survive round-trip;
- paste and undo treat one operation as one transaction;
- long cells and wide tables remain editable without breaking the page.

#### 5. First-class footnotes

Current state: footnote-looking syntax survives the editor golden tests as
unknown text. It is not a rich editor feature, and the renderer does not emit
Typst footnotes.

Build:

1. Define the canonical syntax as Markdown references and definitions,
   preserving labels and definition order.
2. Add editor parsing/serialization for a selectable reference and an
   editable definition surface without moving definitions gratuitously.
3. Add Insert footnote at the selection and navigation in both directions.
4. Teach `essay-markdown` to index definitions/references and
   `essay-render` to emit Typst footnotes, including repeated references.
5. Surface missing/orphaned definitions as local manuscript findings, not a
   dashboard.

Acceptance:

- existing out-of-order fixture bytes survive;
- references can be inserted, renamed and deleted without renumbering every
  unrelated note;
- screen and proof agree about note order and content.

#### 6. Maths with an honest compatibility boundary

Current state: `$…$` and `$$…$$` survive as unknown text. The Rust Markdown
parser does not enable maths, and the renderer deliberately emits any math
node as raw monospace because TeX and Typst maths are different languages.

Build:

1. Decide and publish the accepted TeX-flavoured subset, including currency
   disambiguation, before enabling parsing.
2. Add inline and display maths nodes with source editing and a non-blocking
   preview. Preserve unsupported input verbatim with a visible warning.
3. Evaluate a bundled, offline TeX-to-Typst translator against a fixture
   corpus. Never silently approximate unsupported formulae.
4. Enable `essay-markdown` maths parsing and real Typst output only after the
   translator passes the corpus.
5. Guarantee a maths-capable font or diagnose its absence before proof.

Acceptance:

- `$50` remains currency;
- source survives even when rendering fails;
- editor, exported PDF and another Markdown editor see an intelligible form;
- rendering remains debounced and latest-wins.

### P0 — Comment on what the manuscript says

The core act is not “add a note to this paragraph.” It is selecting as much
text as necessary—even several paragraphs—and saying “we say X here,” “this
contradicts the opening,” or “verify this claim.” The comment belongs to that
claim and stays outside the printed manuscript.

#### 7. Multi-block selection comments: the first coherent slice

Supported first: a non-empty text selection across paragraphs, headings,
lists and block quotes in a saved manuscript. Node selections and table cell
selections should receive a clear scoped fallback rather than a comment that
pretends to have an exact text range.

Interaction:

1. A single Comment action joins the existing selection toolbar and command
   registry. It opens one compact composer attached to the selection.
2. The composer shows a short quote, accepts plain text, and offers Comment or
   Cancel. It is not a formatting canvas.
3. Saving clears the selection but leaves a quiet range indication. Hovering
   or opening the comment strengthens the exact highlight; inactive comments
   must not turn a heavily reviewed page yellow.
4. One hollow gutter mark means unresolved author work in a section. A comment
   spanning sections marks every touched section but appears only once in
   Structure, under its starting section, labelled “through …”.
5. Clicking the range or gutter mark opens the thread in Structure’s companion
   slot and scrolls to the selection. Resolve/reopen lives there. Resolved
   comments are hidden by default and remain in history.
6. Overlapping comments share one visual layer and show a count at the active
   location. Never stack floating cards over the prose.

Storage:

```text
comment_threads
  id, document_id, anchor_id, state,
  created_at, updated_at, resolved_at, version

comment_entries
  id, thread_id, actor_kind, actor_id, body,
  created_at, edited_at, version

anchors
  id, document_id, created_hash,
  pm_from, pm_to, selected_text,
  context_before, context_after,
  start_section_ref, end_section_ref,
  source_range, confidence, detached_at, version
```

The first release is local and single-author, but thread/message IDs and actor
fields prevent a future collaboration model from rewriting the schema. No
account, presence or sharing UI appears now. Deleting `.essay/` deletes the
comments and never changes the Markdown.

Anchor behaviour:

- while the document is open, a ProseMirror plugin maps comment decorations
  through every transaction;
- on the exact content hash, stored ProseMirror positions restore the range;
- on changed content, reconciliation searches the recorded quote and context
  inside the recorded start/end section corridor;
- exact unique matches may reattach automatically; ambiguous or low-confidence
  matches become visibly **unplaced**;
- a later source-index phase adds byte ranges, block fingerprints and stronger
  reconciliation. No hidden IDs are written into Markdown.

This is intentionally more capable than the earlier section-only work-item
proposal. Section-only questions and tasks remain useful, but they do not
satisfy passage-level editorial thought.

Acceptance:

- comment on a selection spanning at least three paragraphs, edit before and
  inside it, save, relaunch and return to the right range;
- rename or move the containing section and either reattach correctly or show
  the thread as unplaced;
- ambiguous repeated prose never receives a silently guessed comment;
- resolving a comment changes no manuscript bytes;
- comment decorations, find matches and agent decorations coexist.

### P1 — Structural editing without Notion

#### 8. Section operations in Structure

The first structural operation should be **Move section up/down**, not generic
block dragging. A section includes its heading and all descendant headings up
to the next heading of equal or shallower depth.

Implementation:

1. Add a shared section-range definition to the live outline and Rust source
   index; test nested and duplicate headings.
2. Flush the current buffer, then perform the move as a hash-guarded source
   splice so the moved Markdown bytes remain byte-for-byte intact.
3. Snapshot the operation as a human structural revision, reload without
   losing the logical section selection, and offer ordinary Undo/History.
4. Start with Move up/down commands and keyboard access in Structure. Add drag
   reordering only if it remains precise in a 40-section outline.
5. Reconcile comments, material links and pending suggestions after the move;
   unresolved anchors must move with their section or become unplaced.

Later operations, after move is trustworthy: promote/demote heading, extract
selection as a new section, merge with previous section and lift selection to
material. Each must name the Markdown transformation and round-trip tests
before it earns UI.

Explicitly avoid:

- permanent paragraph handles;
- per-block backgrounds, cards or hover chrome;
- a universal block-type menu at every empty line;
- stable IDs embedded in Markdown;
- treating paragraphs as database records or independent documents.

### P1 — Foundations that prevent later rework

#### 9. Stable document identity

Path alone cannot own comments or chats because Save As, rename and move are
normal writing operations. Add a sidecar document ID with path/hash aliases,
then implement rename, Move to, Save As and Duplicate as explicit guarded
commands. Reconcile external moves by content hash plus sidecar location; ask
when identity is ambiguous.

#### 10. Persistent agent chats and review bundles

Persist document-scoped conversations independently of ACP process sessions,
support `session/load` when the adapter does, and offer an honest new-session
continuation otherwise. A single author request that touches Markdown, Typst,
bibliography or settings becomes one review bundle with per-file diffs,
provenance, dependency order and an atomic-or-explicitly-partial accept path.

#### 11. The document work map

Compose outline, marks, manuscript tasks, comments and review state in
Structure. Derived state lands first; new comments join as soon as they exist.
This is one section-keyed reading, not separate Notes, Tasks and Comments
panels.

### P2 — Materials, evidence and finishing

After the manuscript interaction is credible: linked Markdown materials,
source/citation validation, editable templates, visual typography review and
finishing preflight. These stay in the order described in
[the long-form plan](./long-form-materials.md); they must not displace the P0
authoring floor.

## Recommended release sequence

The smallest sequence that proves the product without building a generic
notes app is:

1. **Find properly** — find strip, all-match highlighting, next/previous.
2. **Comment on a passage** — one durable multi-block comment, resolve/reopen,
   Structure and gutter presence, visible detachment.
3. **Replace safely** — replace one/all with formatting and cross-block tests.
4. **Make embedded content credible** — local image preview/drop/metadata and
   the table interaction pass.
5. **Guarantee language basics** — ship the cross-platform spellcheck result.
6. **Move a section** — one source-preserving structured operation.
7. **Footnotes, then maths** — complete editing and proof in vertical slices.
8. **Persist chats and multi-file review** — durable agent work on the same
   anchor/review foundations.

Find comes first because its editor-decoration layer is shared by comments,
spellcheck and agent presence. Comments come before a general editorial-work
schema because they validate the hardest and most valuable anchor. Section
move comes after that anchor can survive it. Footnotes precede maths because
their canonical Markdown syntax and Typst target are clearer.

## Parallel work packages

These packages can be audited or implemented independently once their shared
types are agreed:

| Package | Deliverable | Primary seams |
| --- | --- | --- |
| A. Decoration substrate | One plugin API for find, comments, spelling and agent ranges with deterministic precedence | `packages/editor/src/`, `prose.css` |
| B. Find and replace | Find strip, navigation, highlights, replacement transactions and performance tests | `essay-search`, `manuscriptText`, `Workspace.tsx` |
| C. Selection comments | Comment composer/thread, `ContextStore`, live mapping and anchor resolver corpus | `SelectionToolbar.tsx`, `essay-core`, `essay-markdown`, new context crate/store |
| D. Images and tables | Local image node view/drop/metadata; table keyboard, selection, alignment and paste | editor extensions, `images.ts`, toolbar, render fixtures |
| E. Language features | Native spellcheck matrix and fallback recommendation; footnote/math parser/render designs | desktop shells, editor extensions, `essay-markdown`, `essay-render` |
| F. Structural source edits | Section subtree ranges, guarded splice, snapshot/reload and anchor reconciliation | `essay-markdown`, `essay-workspace`, Tauri commands, Structure |

## Release gate

Run one 30–50 page manuscript containing repeated phrases, nested headings,
long comments, tables, images, footnotes, citations and maths. The release is
not credible unless an author can find, comment, revise, rearrange and proof
that document without ordinary UI friction, silent source drift or losing the
place where a comment belongs.
