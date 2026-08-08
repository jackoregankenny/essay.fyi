# Working material around the manuscript

> Product and implementation direction, 2026-08-07. This extends the
> manuscript-first UI direction in [ui-overhaul.md](./ui-overhaul.md); it does
> not turn Essay into a general note-taking product.

## Decision

Essay should become better at the work that surrounds a long document, but it
should not become a notes app.

The distinction is not semantic. A notes app begins with a library of peer
items and asks the user to organise them. Essay begins with one manuscript and
asks what is preventing that manuscript from becoming clear, supported,
decided and finished. Notes are useful here only as **working material around a
document**: fragments to place, evidence to use, questions to answer, decisions
to remember and suggestions to review.

The manuscript remains the only persistent plane and the only object that can
be finished, typeset and exported. Working material is always visibly related
to a manuscript or one of its sections. There is no All Notes destination, no
ambient note list, no knowledge graph and no second product hiding in a
sidebar.

The short product rule is:

> Essay is not where all your notes live. It is where the material for this
> document becomes the document.

This sharpens rather than broadens “Superhuman for unformed documents.” An
unformed document is not merely an early text file. It is a manuscript plus a
field of unresolved work.

## The product boundary

Essay needs four distinct classes of state. They should share a document work
map in the UI, but they should not be collapsed into one generic `Note` model.

### 1. The manuscript

One canonical Markdown file, open in the main surface. Headings, prose, inline
tasks intended to appear in the document, marks and citations remain in it.
This is the only source used for typesetting.

### 2. Manuscript signals

Facts derived from the manuscript without adding storage:

- headings, hierarchy and section word counts;
- `==come back to this==` marks;
- `- [ ]` and `- [x]` task-list items;
- `[@key]` citations and whether their bibliography entries resolve;
- sections changed since a checkpoint;
- sections touched by a pending or already-applied agent change.

These are indexes over the file, not entities in a second database. Their
source syntax remains the thing the author can inspect in any editor.

### 3. Editorial work

Questions, comments, non-printing tasks, decisions and saved critiques. These
are process records anchored to the manuscript or a section. They may live in
the removable `.essay/` sidecar for the same reason comments and provenance
were always allowed there: deleting them loses workflow, never prose or
research.

Document-scoped agent conversations belong here too. A chat is durable working
memory: the author must be able to close Agent, relaunch Essay and revisit what
was asked, answered, tried and proposed. It is not manuscript content and it is
not a material note unless the author explicitly saves part of it as one.

An editorial task is deliberately different from a Markdown task-list item.
The former is work *about* the draft and never prints; the latter is content in
the draft and may print. Essay must name that distinction at creation rather
than silently moving one kind to the other.

### 4. Materials

Fragments, research notes, interview notes, source extracts and other
substantive content outside the manuscript. Every material is an ordinary
`.md` or `.markdown` file. Material contents must never live only in SQLite.

An Essay-created material should contain a visible ordinary Markdown link back
to its manuscript (and a visible source link when it came from elsewhere).
For example:

```markdown
# Pilot interview: Aoife

For: [Distribution and Trust](../distribution-and-trust.md)
Source: [Interview recording](../assets/interviews/aoife.m4a)

The important failure was not accuracy but uncertainty about who would read
the result.
```

The sidecar may cache the relationship, its section anchor, lifecycle and
provenance. If `.essay/` is deleted, the file and its human-readable
relationship survive; only Essay's richer organisation is lost. Existing
Markdown files can also be attached without being rewritten, at the accepted
cost that deleting the sidecar forgets that attachment.

## What Bear is useful for

Bear is a strong interaction reference and the wrong product model.

Useful lessons:

- **Capture has almost no preamble.** A new item starts as text, not a form.
- **The library feels local because retrieval is immediate.** Search-as-you-
  type and Quick Open make navigation feel cheaper than maintaining a filing
  system.
- **Formatting is present without dominating.** The writing surface is calm,
  and advanced functions reveal themselves when they have a reason to.
- **A secondary information reading is enough.** Bear groups note statistics,
  table of contents and backlinks in one Info panel rather than surrounding
  the editor with permanent tools. Essay's single companion slot is an even
  stricter version of the same idea.
- **Capture can stay private and local.** Bear's current web clipper performs
  extraction on-device, can capture a whole page or selection, and can retain
  source metadata. Essay should eventually use that shape for evidence
  capture, with the current manuscript as the default destination.
- **Context can narrow the library.** Bear's tag workspace hides unrelated
  notes. Essay should get this benefit automatically: the open manuscript is
  the workspace, so unrelated material never appears unless the author
  searches for it.

What Essay should explicitly avoid:

- a three-column library → note list → editor hierarchy;
- treating the manuscript, a clipped article and a grocery list as peer notes;
- tags as the primary information architecture, including a permanent nested
  tag tree;
- backlinks, unlinked mentions and a graph as ends in themselves;
- an unscoped inbox, daily notes, pinning systems and generic personal task
  management;
- making Markdown an export format rather than the file that is already on
  disk;
- rich cards and previews that make collecting feel more finished than using;
- equating sync with the product. Local files and local speed have to be
  complete before another device is involved.

Tags may later be useful as optional metadata inside material Markdown and as
search filters. They must not become the top level of Essay's navigation. A
tag tells the author what a note resembles; a manuscript/section relationship
tells them why it is here.

Bear references consulted:

- [Get started with Bear](https://blog.bear.app/2023/07/get-started-with-bear/)
- [Search and Quick Open](https://bear.app/faq/how-to-search-notes-in-bear/)
- [Info panel, table of contents and backlinks](https://bear.app/faq/how-to-use-the-info-panel-table-of-contents-and-backlinks-in-bear/)
- [Bear Web Clipper](https://bear.app/faq/browser-extensions/)
- [Bear 2.9: Use Tag as Workspace](https://blog.bear.app/2026/07/bear-2-9-use-tag-as-workspace/)

## The interaction model

### The manuscript remains the coordinate system

Every piece of work answers two questions:

1. Which manuscript is this for?
2. Where in that manuscript does it matter?

The second answer may be a selection, block, section or the whole document.
The first answer is never optional in the initial product. Essay should not
offer a global quick-capture inbox until evidence shows authors need one; a
global inbox is the moment the product becomes responsible for somebody's
whole note life.

When a saved manuscript is open:

- a selection-scoped action can mark the text, ask a question about it, save a
  copy as material, attach a source or invoke an agent against it;
- a section-scoped action can add a question, editorial task or material to
  that section;
- a document-scoped action can capture material whose destination is not yet
  known, inspect open work or ask for a read-through;
- a project-scoped action such as browsing files remains a summoned reading.

Untitled manuscripts can use portable inline marks and tasks, but cannot own
sidecar work or material until saved. The UI should say this at the action,
not create hidden application data that has no document to travel with.

### Structure becomes the document work map

Do not add a fifth `Notes` or `Materials` tenant to the companion. Structure
is already the place that expands the semantic gutter. It should become the
single reading of the document's shape **and the work attached to that shape**.

Each section row remains a heading first. To its right is word weight; beneath
it, only when non-empty, one quiet line such as:

```text
2 questions · 1 source · change waiting
```

Disclosure expands the row in place to show the actual work. Marks, manuscript
tasks, editorial questions, materials and pending changes are not five boxed
panes. They are flat rows under the section they affect. Document-level and
unplaced work appears after the last section and only when non-empty.

The top of Structure may carry one sentence of aggregate state — “6 open in 3
sections” — but not charts, progress rings or a dashboard. A long document's
status is a reading of its argument, not project-management telemetry.

Selecting a material shows a compact preview in the same Structure tenant,
beside the still-mounted manuscript. Back returns to the work map. Full
editing of a material, when added, is a deliberately summoned layer with a
clear return to the manuscript; it is not another tab or a peer document left
open beside it.

### The gutter compresses, it does not classify

The gutter must not become a vertical Christmas tree. It may communicate at
most three facts about a section:

- the current section (the existing accent light);
- unresolved author work (one quiet hollow mark, regardless of count/type);
- an author decision waiting on an agent or external change (one firmer solid
  mark, which wins when both exist).

Recent change activity may alter the section tick's weight or add one neutral
notch, but it must not add another colour. Hovering the fan spells the state
out in words; clicking opens Structure at that section. Precise categories and
counts belong in the expanded reading, not in fourteen pixels.

### Capture is fast and already scoped

The default capture command is “New material for _this manuscript_,” not “New
note.” With a selection it begins with the selected text and its manuscript
location; without one it begins empty and attaches at document level. The
author types a title only if the material grows enough to need one. Saving
creates an ordinary Markdown file atomically in a visible materials folder
chosen for that manuscript; Essay may suggest `materials/`, never hide the
content under `.essay/`.

Later capture paths use the same command:

- clipboard text or a dragged file;
- browser selection or article, extracted locally;
- an agent message the author explicitly chooses to keep;
- prose lifted from the manuscript as a fragment.

Capture copies by default. “Lift out of manuscript” is a separate destructive
verb that previews the deletion before committing it. Capturing never removes
source text as a side effect.

### Material has to move toward prose

A material preview offers a small set of verbs whose effects are concrete:

- **Insert at cursor** — place selected material text into the manuscript;
- **Quote with source** — insert a block quote plus a link/citation candidate;
- **Link** — keep the material separate and link it;
- **Mark used** — record that it informed the draft without inserting it;
- **Detach** — remove the relationship, never delete the file.

Insertion is an author action and can use the editor's ordinary undo. When an
agent authored or transformed the text, insertion opens a focused diff first
and keeps its provenance. Material is never auto-deleted after placement; its
lifecycle becomes `placed`, and the exact placement revision is recorded so
the author can answer where it went.

### Questions, tasks and decisions have a lifecycle

An editorial work item has one short body, a kind, an anchor and a state:

```text
kind: question | task | decision | comment | finding
state: open | resolved | superseded
```

This is intentionally smaller than a generic note schema. There are no due
dates, assignees, reminders, priorities or board columns. If Essay later has
collaboration, an author identity may be displayed; it should not turn the
item into a project-management ticket.

Resolving a question or task records when and against which manuscript
revision it was resolved. A decision records its text and may be superseded by
a later decision rather than overwritten. The history is useful because
long-form work often changes direction; it remains sidecar state because the
manuscript does not depend on it.

### Comments may span the argument they describe

A comment is not merely a work item attached to one paragraph. The author may
select several paragraphs—or a passage crossing section boundaries—and write
“we say X here.” Essay must preserve that scope. One comment thread owns one
range anchor; every touched section may show unresolved author work, but the
thread appears once in Structure under its starting section.

The live editor maps the range through ProseMirror transactions. Persistence
records the exact document hash, selection positions, selected quote, nearby
context and its start/end section corridor. On a changed document, only an
exact, unique reconciliation may attach automatically. Ambiguity becomes a
visible unplaced comment with manual reattachment. A plausible but wrong
attachment is data corruption.

The detailed interaction, storage shape and acceptance tests are specified in
[the authoring backlog](./authoring-backlog.md#7-multi-block-selection-comments-the-first-coherent-slice).

### Sources and citations are adjacent, not identical

A source is a piece of material with origin metadata. A citation is syntax in
the manuscript resolved against `references.bib`/`references.yml`. Essay
should connect them but not pretend that clipping a page has produced a valid
bibliographic record.

- A citation in prose can open its bibliography entry and any linked source
  material.
- A source preview can offer “Create citation entry,” with fields the author
  can verify before `references.bib` changes.
- Missing citation keys and uncited source material appear in Structure only
  when either exists.
- Agents may suggest sources or entries, but adding a citation is a reviewable
  manuscript/file change, never an invisible enrichment.

### Agent output stays in its own category

Agent activity must not flood the material system.

- the visible conversation transcript persists locally and can be revisited;
- streamed chunks are coalesced into stable entries before storage, just as
  `AgentPanel.absorb()` already coalesces them for display — do not store one
  database row per word;
- protocol/debug noise remains ephemeral, while author prompts, agent
  messages, visible thought/plan entries, final tool-call summaries and
  proposal links form the durable chat;
- a read-through finding becomes editorial work only when the author saves it
  or when a dedicated critique command explicitly promises durable findings;
- an edit stays a `ChangeSet`, with Accept/Reject or Revert/Keep semantics;
- accepted changes become revisions with provenance, as they do now;
- pending proposals and watcher-caught decisions should eventually persist in
  `.essay/` until answered, because unresolved editorial work cannot vanish on
  relaunch;
- “Save as material” is explicit and retains the agent, prompt and timestamp.

Closing Agent may hide the conversation. It must never hide that a decision
is waiting; the affected section and the global waiting count continue to say
so.

The Agent tenant needs a small document-scoped conversation switcher: current
chat title, New chat, and a flat recent list when summoned. It is not a global
chat product and does not add another rail. Returning to a chat restores its
transcript, scroll position, agent/model metadata and links to its proposals.

An Essay chat and an ACP process session are not the same identity. The chat
always survives locally. After relaunch:

1. if the adapter advertised ACP `session/load`, Essay loads the recorded ACP
   session and lets the adapter replay/continue it;
2. if the adapter cannot load the session, the old chat remains readable and
   “Continue in a new session” starts a visibly new continuation with a
   compact handoff of the author-visible conversation;
3. Essay never claims model continuity when it only replayed context.

The current ACP dependency already contains `LoadSessionRequest` and agents
advertise a `load_session` capability, but `acp.rs` currently discards the
initialisation capability response and always sends `session/new`. Supporting
durable chats therefore needs capability retention and a load path; it is not
only a frontend persistence task.

### Agents can work on typography

Typography is part of the document, not decorative application chrome. An
agent should be able to help with hierarchy, measure, spacing, page economy,
template choice and template code, under the same “propose; author decides”
rule as prose.

The target interaction is concrete: “Make this a crisp two-page investor
memo” may produce proposed front-matter changes, a local Typst template edit
and prose cuts. Essay reviews each file, then renders the old and proposed
outputs side by side with page count and warnings before acceptance.

Hard limits:

- an agent edits document/project typography (`.typ`, template manifest and
  document front matter), not the app's global UI theme;
- a text diff is necessary but insufficient for typography — acceptance also
  needs a visual proof comparison;
- a project template change must name every manuscript it can affect;
- missing fonts are reported. An agent may select installed fonts or propose a
  requirement, but downloading/installing a font remains an explicit author
  action;
- typography work never blocks typing and never silently changes the active
  template.

This depends on the template resolution/manifest/picker work already planned
in `ui-overhaul.md`. Today the only real template is embedded and an agent has
no editable `.typ` target. Interception covers every path only when an agent
uses ACP filesystem requests; an agent that writes a template with its own
tools bypasses it, just as opencode bypasses it for manuscripts. The current
`DocumentWatcher` watches only the open Markdown file, while `RootWatcher`
compares listings rather than file contents. Typography work therefore also
needs an explicit tracked-file set for the resolved template, manifest and
document settings: snapshot before the turn, compare hashes after writes/turn
end, and surface direct edits as On disk/Revert review. Visual review alone
cannot be the durability mechanism.

## Hard surface rules

These rules extend the long-form surface rules in `ui-overhaul.md`:

1. There is no permanent Notes destination. Material appears through the
   manuscript, Structure, search or an explicit capture command.
2. A piece of work without a manuscript relationship is out of scope for the
   initial product.
3. Structure owns document work. Do not add parallel Marks, Tasks, Sources,
   Decisions or Materials companion tenants.
4. Every state first appears at its narrowest honest scope: prose mark,
   section/gutter mark, then Structure detail. A container never appears just
   to advertise an empty capability.
5. No more than one secondary reading is open. Material preview replaces the
   Structure list within the same tenant; it does not open another rail.
6. Selection actions stay at the selection. Section work can be added from the
   expanded section row or the palette. Do not put a Notion-style catalogue at
   every empty paragraph.
7. The selection toolbar gets at most one new annotation/material entry point,
   not one permanent button per work kind. The palette carries the complete
   set.
8. Materials render as prose, never as cards. Lists use title, one excerpt,
   provenance and a quiet state word; no thumbnails unless the material itself
   is an image.
9. Agent suggestions, author questions and source material keep distinct
   labels and verbs. A unified list is allowed; a unified ontology is not.
10. Promotion into the manuscript is explicit. Agents always get a diff;
    author insertions always get undo; lifting text out always gets a preview.
11. Search is retrieval, not organisation. Use the existing straight scan and
    Quick Open before adding an index, tag tree or backlink graph.
12. Full material editing is temporary and returns to the manuscript. It does
    not create tabs or replace the document-centred status line with note
    metadata.

## What the current product can say honestly

| Signal or capability | Current source | Honest now? | Work needed |
| --- | --- | --- | --- |
| Outline and section words | `extractOutline()` over live Tiptap state | Yes | Compose into section work rows |
| Current section | caret position + outline | Yes | Already used by gutter/Structure |
| Marks | `extractMarks()` over `==…==` | Yes | Assign to owning section; retire separate Marks pane |
| Manuscript tasks | `extractTasks()` over task items | Yes | Assign to owning section; distinguish from editorial tasks |
| Pending agent sections | `ChangeSet.diff.sections` | Yes for proposals | Lift pending summaries out of `AgentPanel`; map section indexes to live outline positions |
| Already-applied agent sections | `AppliedEdit.diff.sections` | Yes while the app remains open | Persist unresolved decision state later |
| Revision provenance | `SnapshotStore` / History | Yes | Section activity requires diffing against a chosen revision |
| Changed since checkpoint | snapshot sources + `essay-diff` | Derivable | Add a checkpoint lookup/current comparison; define the baseline visibly |
| Citations present | render converter detects them internally | Not exposed | Populate `DocumentIndex.references`; expose bibliography resolution |
| Bibliography completeness | neighbouring bibliography file | Not modeled | Parse keys and report missing/unused entries |
| Agent reading location | ACP `toolCall.locations` | File-level only | Do not light blocks until range/line evidence exists |
| Questions, decisions, comments | nowhere | No | New sidecar model and commands |
| Section status | nowhere | No | New explicit/aggregate model; do not infer “done” from prose |
| Related material files | workspace scan/search only | No relationship | New material-link model; contents remain Markdown files |
| Material placement/provenance | nowhere | No | New placement record tied to a revision/hash |
| Stable block anchors | types declared in `essay-core`, block index empty | No | Populate block index and build reconciliation tests |
| Persistent pending suggestions | `ChangeSetStore` in memory | No | Sidecar persistence for unresolved review records |

Two cautions follow from this table:

- Do not label a section “needs evidence” merely because it has no citation.
  That is an editorial judgement, not a deterministic fact.
- Do not show an agent as reading a paragraph because it read the manuscript
  file. The protocol currently reports file locations, not source ranges.

## Storage and architecture

### Portable content

- Manuscripts: ordinary Markdown, unchanged.
- Materials: ordinary Markdown in visible folders, written through the same
  hash-guarded, atomic path as manuscripts.
- Bibliography: existing `.bib`/`.yml` files.
- Assets: ordinary neighbouring files.

Material files should receive revision history too. `SnapshotStore` is already
keyed by file name within a folder; the document-vs-material distinction is a
relationship, not a different durability standard.

### Removable editorial state

Add document-scoped records under `.essay/`, using stable opaque IDs even
before sync exists:

```text
work_items
  id, document_id, kind, state, body, anchor_id,
  provenance_id, created_at, updated_at, resolved_at, deleted_at, version

material_links
  id, document_id, material_path, anchor_id, lifecycle,
  created_at, updated_at, deleted_at, version

placements
  id, material_link_id, material_hash, material_range,
  manuscript_revision, manuscript_anchor_id, provenance_id, created_at

anchors
  id, document_id, created_revision, source_range,
  section_ref, block_fingerprint, context_before, context_after,
  confidence, detached_at

provenance
  id, actor_kind, actor_name, instruction, source_url,
  agent_session_id, tool_call_id, created_at

agent_threads
  id, document_id, title, agent_id, acp_session_id,
  continuation_of, created_at, updated_at, archived_at, version

agent_entries
  id, thread_id, sequence, kind, body, tool_call_id,
  status, locations, created_at

review_items
  id, document_id, target_path, kind, base_hash, proposed_hash,
  affected_sections, status, provenance_id, created_at, resolved_at

review_blobs
  hash, content
```

`review_blobs` is content-addressed for the same reason revision blobs are: a
pending proposal cannot be reconstructed from its hash, and persisting only a
diff is insufficient to apply or rebase it later. Settled review blobs may be
pruned once the accepted/rejected record and any resulting revision carry the
provenance that still matters.

Agent entries are append-only within a thread. Streaming updates fold into the
current entry transactionally; a completed tool call updates its one row
rather than appending every status event. A thread may be archived, never
silently discarded. Deleting `.essay/` deliberately deletes the chats without
touching the manuscript or any material files.

This may be a new `ContextStore` in `essay-workspace` backed by
`.essay/context.sqlite`, with domain types in a small `essay-context` crate if
the model becomes substantial. Do not put the domain rules in Tauri commands
or React. `apps/desktop/src-tauri` should continue to wire Essay-owned APIs.

A separate database is preferable to stretching `history.sqlite` into a name
that no longer describes its contents. Both remain optional sidecars. A
read-only folder still opens and edits the manuscript; it simply cannot retain
editorial work.

### Anchors

Start section-scoped questions, tasks and decisions with section anchors,
because the current product can support them honestly:

```text
heading text + heading depth + duplicate ordinal + creation revision
```

Use the same visible-failure discipline as `essay-diff`: if a heading is
renamed and the relation cannot be proved, show the item as unplaced rather
than silently attaching it to a plausible neighbour.

Selection comments cannot wait for every block-indexing phase: their first
release combines exact-hash ProseMirror positions, a quote/context pair and a
start/end section corridor, maps positions through live transactions, and
detaches on ambiguity. Populate `DocumentIndex.blocks` next to add canonical
source ranges and stronger reconciliation. The durable anchor should combine:

- creation revision and original byte range;
- containing section path;
- block kind and fingerprint;
- selected quote plus context before/after;
- last resolved range and a confidence value.

Resolution order should be exact revision/range, exact block fingerprint near
the previous section, exact quote near the previous range, then conservative
fuzzy reconciliation. Low confidence becomes “unplaced” and permits manual
reattachment. Never write hidden block IDs into Markdown.

### Future sync without cloud UI

Do not build sync, accounts, sharing or permissions now. Do make the local
model syncable later:

- stable IDs independent of React keys and display paths;
- `created_at`, `updated_at`, monotonically increasing `version` and
  tombstones rather than destructive row deletion;
- transactional mutation commands that return the resulting record;
- relative paths inside a shared root where possible, with content hashes for
  identity checks;
- provenance actors that can represent today's OS user/agent and a future
  collaborator without changing the record shape;
- thread IDs distinct from adapter session IDs, so a durable conversation can
  continue across a restarted or replaced agent process;
- events that carry whole resulting state or versioned records, not UI deltas;
- no absolute path as the sole logical identity.

This does not imply CRDTs. Manuscript conflicts should continue through
hash-guarded files, snapshots and diffs. Structured sidecar records can later
merge by ID/version. The UI does not need to say “workspace,” “member” or
“shared” until those things exist.

## Sequenced build plan

### 0. Ship the document work map from existing state

This is the smallest coherent first implementation and should be built before
new persistence.

1. Introduce a pure frontend `DocumentWorkMap` read model that assigns the
   existing outline, marks and manuscript tasks to sections.
2. Lift pending proposal summaries out of `AgentPanel` (or expose them through
   a shared hook/store) so `Workspace`, Structure and the gutter can see the
   same waiting decisions.
3. Replace the stacked Outline/Marks/Tasks treatment in `Sidebar.tsx` with
   section rows and in-place disclosure. Keep rows flat and empty state quiet.
4. Replace the gutter's string-only `pendingHeadings` seam with section keys
   or live ProseMirror positions. `SectionChange.newIndex` plus the work map
   can identify duplicate headings; heading text alone cannot. Aggregate
   marks/tasks as one unresolved marker per section.
5. Make footer counts open Structure at the relevant subsection/section rather
   than merely toggling the tenant.
6. Add pure tests for ownership around preambles, duplicate headings, nested
   headings, marks on boundaries and tasks inside nested lists.

Acceptance:

- no migration and no manuscript bytes change;
- an existing highlight, task or proposal is visible at its section in both
  gutter and Structure;
- clicking any item lands at the prose or opens the right review;
- a document with none of these is as calm as it is now;
- typing does not call Rust, walk the filesystem or compute a diff;
- the Agent pane can close without hiding an unanswered change.

This slice tests the core thesis — “unresolved work belongs to the document's
shape” — using state Essay already has. If it makes Structure noisy or authors
do not use it to return to work, adding a material library would magnify the
mistake.

The likely code boundary for this slice is deliberately small:

| File/package | Change |
| --- | --- |
| `packages/editor/src/index.ts` | Expose enough live section boundaries/keys to assign editor positions without rereading Markdown |
| `apps/desktop/src/lib/documentWork.ts` | New pure composition layer: outline + marks + tasks + review summaries → section work map |
| `Workspace.tsx` | Own the composed map and the current document's pending-review summary |
| `AgentPanel.tsx` | Report review-queue state upward; keep transcript/session rendering local |
| `Sidebar.tsx` | Become `StructurePane.tsx`, rendering one outline with in-place work disclosure |
| `Gutter.tsx` | Consume section-keyed aggregate state, not heading strings or work-item categories |
| `packages/editor/test/` plus a pure app test | Cover position ownership and duplicate-heading/review mapping |

Do not call `index_document` for this first slice. The live buffer is ahead of
disk between autosaves, and all inputs already use ProseMirror coordinates.
The Rust index becomes necessary when durable source anchors arrive, not for a
view recomputed from the current editor state.

### 1. Persist and revisit agent conversations

This moves up because the agent already exists and conversation is already
valuable document context. Losing it on relaunch makes the feature feel like a
demo rather than a working relationship.

1. Add the first `ContextStore` tables for `agent_threads`, `agent_entries`,
   `review_items` and content-addressed `review_blobs`.
2. Move transcript folding out of component-local React state into an
   Essay-owned thread service. Persist coalesced entries, never raw streaming
   chunks.
3. Add New chat/revisit/archive within the Agent tenant, scoped to the current
   document. Persist last-read thread and scroll position as machine
   preference.
4. Retain ACP initialisation capabilities and implement `session/load` where
   advertised. Otherwise continue in a new, clearly linked session with an
   explicit transcript handoff.
5. Persist unanswered proposals and direct-write review decisions, linked to
   the thread and turn that produced them.
6. Keep active permissions and subprocess lifecycle ephemeral. A dead process
   must never render as a live agent merely because its chat survived.

Acceptance:

- close/open Agent and relaunch Essay without losing the visible conversation;
- revisit several chats for one document without adding a global chat library;
- a proposal remains reviewable from both its transcript turn and Structure;
- resumption says whether the original ACP session was loaded or a new
  continuation was created;
- deleting `.essay/` deletes chats/review state and never document bytes.

### 2. Let agents propose typography with visual review

1. Land template resolution and manifests first: embedded template, local
   project override and document-selected template must all resolve to an
   editable/reviewable target.
2. Build a scoped tracked-file set for the manuscript, resolved `.typ`,
   manifest and relevant settings/bibliography. Snapshot it before an agent
   turn and compare content hashes afterwards so direct tool writes are caught.
3. Let the agent propose changes to `.typ`, template manifest and relevant
   front matter through the existing all-path `ChangeSet` rule.
4. Render the current and proposed template against the author's current
   manuscript on blocking workers, latest-wins.
5. Add typography review: source diff, paired rendered pages, page-count
   change, compiler warnings and affected-document scope.
6. Accept files individually or as one provenance-linked set; hash-guard every
   write and snapshot every affected file.
7. Add focused agent commands such as “fit to two pages,” “strengthen heading
   hierarchy” and “audit typography,” while leaving the free-form composer.

The first proof should be one real request against the memo fixture: “Make this
a restrained two-page board memo.” The acceptance surface must show the prose
diff, template diff, paired proofs, page count and warnings before anything is
written.

### 3. Add multi-block comments, then section-scoped editorial work

1. Add the multi-block comment vertical slice specified in
   [the authoring backlog](./authoring-backlog.md#7-multi-block-selection-comments-the-first-coherent-slice):
   comment threads/entries, live range mapping, exact-hash restoration,
   conservative quote/context reconciliation and visible detachment.
2. Extend `essay-context` types and `ContextStore` with section anchors and
   `work_items` for questions, tasks and decisions.
3. Add Tauri commands to list/create/update/resolve/reattach items. Commands
   take document path + base identity and fail softly when the sidecar cannot
   be written.
4. Add “Question about section,” “Editorial task” and “Record decision” to the
   palette and expanded Structure row. Add a single contextual entry point at
   the selection, not three permanent buttons.
5. Render these records in the same section disclosures as derived marks and
   manuscript tasks, with their storage distinction legible but not loud.
6. Preserve resolved/superseded records and allow Structure to reveal them on
   request; keep the default reading open-only.

Do not downgrade passage comments to section comments. Their initial anchor is
deliberately conservative and becomes unplaced rather than guessing; the
block index strengthens it in phase 5.

### 4. Add linked Markdown materials

1. Define material roots per manuscript. Suggest a visible `materials/`
   folder beside the manuscript; permit another visible folder inside a
   configured workspace root.
2. Add hash-guarded create/read/write for material Markdown, reusing
   `essay-workspace` rather than writing files from the WebView.
3. Add `material_links` and document-level/section-level attachment.
4. Add “New material for this document,” then “Save selection as material.”
   Generated files include visible `For` and `Source` links.
5. Add flat material rows and compact preview inside Structure. Search and
   Quick Open continue to find the files because they are ordinary Markdown.
6. Add Insert/Quote/Link/Mark used/Detach. Record placement only after the
   manuscript save succeeds; never delete the material automatically.
7. Extend history to material files and add conflict handling when a material
   changes outside Essay.

Do not build web capture in this phase. First prove that authors return to and
use material captured from their own draft/clipboard.

### 5. Make anchors durable and agent presence local

1. Populate `DocumentIndex.blocks`, links and references; keep every range over
   source bytes.
2. Implement fingerprints and an anchor resolver with an evaluation corpus in
   `fixtures/anchors/` covering insertions, edits, section moves, heading
   renames, duplicate headings and wholesale rewrites.
3. Upgrade section items, placements and agent proposal locations to
   block/selection anchors.
4. Begin prompts from the current selection or section and name that scope in
   the composer.
5. Render live reading/editing decoration only when ACP supplies a range/line
   that can be mapped honestly.
6. Add “Keep as question/material” to agent findings with full provenance.
7. Surface low-confidence/unplaced items explicitly with manual reattachment.

This is the hard technical phase and should not be smuggled into the capture
UI work.

### 6. Connect sources and citations

1. Populate `DocumentIndex.references` for bracketed citations.
2. Parse bibliography keys and expose resolved/missing/unused state.
3. Add source origin metadata and “Create citation entry” with author review.
4. Open source material from a citation and insert a citation from source
   material at the selection.
5. Add local browser/clipboard capture only after the source-to-manuscript path
   is useful. Extraction happens on-device; source URL and capture time remain
   visible in the Markdown material.

### 7. Add explicit section posture only if the work map needs it

Do not begin with a status taxonomy. First observe whether unresolved work,
change activity and pending review already communicate enough. If authors
still need an explicit posture, use at most three author-set values such as
`rough`, `working`, `settled`. Never infer `settled`, never turn Structure into
a progress dashboard, and never put percentages on argument quality.

## Risks and falsification

### The material system becomes a second app

Warning signs: requests for All Notes, unrelated capture, tag administration,
daily notes, reminders or a permanent library column. The response is not
automatically “never,” but each belongs in another product unless it improves
the current manuscript directly.

### Structure becomes a dashboard

Warning signs: multiple coloured badges per heading, summary cards, progress
percentages or separate panes for each work kind. Test Structure on a 40-page,
40-section fixture with dozens of items; it should still read as an outline.

### Sidecar loss destroys authored thought

The invariant test: create material and editorial work, delete `.essay/`, and
open the folder elsewhere. The manuscript and every material/source file must
still be present and intelligible. Only comments, relationships, lifecycle,
anchors and review state may be gone.

### Capture wins over use

Measure more than items created. The useful funnel is:

```text
captured → reopened beside manuscript → placed/linked/cited → manuscript changed
```

If capture grows and placement does not, Essay is accumulating a library, not
helping a document form. The product should then improve retrieval and
promotion before adding more capture channels.

### Anchors silently drift

No heuristic may attach with false certainty. Track reconciliation confidence
and count unplaced items in tests. Visible detachment is inconvenient; a
question silently moving to the wrong claim is corrupting.

## Recommended next decision

Build the authoring substrate before expanding the material system: the find
strip and shared decoration layer, then one durable multi-block comment. Fold
that comment together with current marks, tasks and agent proposals into the
document work map. This makes the product thesis tangible while testing the
hardest anchor on a real author action.

Before leaving phase 0, test it on three real shapes:

1. a short memo with one unresolved mark and one agent edit;
2. a 20–40 section essay with questions and task-list items distributed across
   the argument;
3. a research-heavy document with `references.bib` and a neighbouring folder
   of Markdown notes.

The decision gate is qualitative but concrete: can an author answer “what is
unresolved, where is it, and what should I do next?” without leaving the
manuscript's coordinate system? If yes, continue through the one-pager's build
order: persistent chats, the typography proof, then durable editorial work and
linked materials in the same grammar. If no, fix Structure before creating one
new kind of data.
