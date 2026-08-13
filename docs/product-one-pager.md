# Essay

## Write the document before you know exactly what it is

Serious documents do not arrive whole. They are assembled from fragments,
questions, evidence, revisions, suggestions, tasks and decisions. Most writing
tools either give you a blank page and ignore that process, or give you an
entire notes system and make the manuscript one item among hundreds.

Essay is a local-first writing environment for forming substantial documents
and finishing them beautifully.

One manuscript stays at the centre. The work around it becomes visible exactly
where it matters. When the argument is ready, the same document becomes a
polished PDF—without moving into another app or surrendering the file to a
cloud database.

### A manuscript that remains yours

Write in a calm, rich manuscript surface while Essay keeps an ordinary
Markdown file on disk. Open it elsewhere, commit it to Git, put it on a USB
drive or keep working offline. There is no account and no proprietary document
format.

Essay saves automatically, protects against conflicting edits and keeps a
real revision history. Unknown Markdown is preserved rather than helpfully
rewritten away.

### See the shape of the work

The edge of the manuscript quietly shows where you are, how the document is
weighted and which sections still need attention. Open Structure to see the
argument and its unresolved work together:

- questions and decisions;
- passages marked to revisit;
- writing and editorial tasks;
- sources and citations;
- recent changes and revision activity;
- agent suggestions waiting for review.

No dashboard. No forest of badges. The document remains readable as a
document.

Select a sentence or several pages and leave an editorial comment such as
“we say X here.” Essay keeps the comment attached as the passage changes,
shows it in the document's structure and makes uncertainty visible instead of
silently attaching it to the wrong words.

### The ordinary writing work is excellent

Find every match, move through it, replace safely and catch a misspelling
without leaving the manuscript. Insert and repair local images. Build and edit
serious tables. Use footnotes and mathematical notation in both the writing
surface and the finished proof.

These are not secondary utilities behind the AI story. A premium writing
environment earns trust by making the unglamorous work fast and dependable.

### Keep material close—and move it into the draft

Capture a fragment, source extract or research note for the manuscript or the
section you are working on. Materials remain ordinary Markdown files in a
visible folder, not records trapped in Essay.

Reopen material beside the manuscript, then insert it, quote it, link it, cite
it or mark it used. Essay is not where all your notes live. It is where the
material for this document becomes the document.

### Work with agents without giving up authorship

Use the agents already on your machine. Start from a selection, a section or
the whole manuscript. Ask for critique, restructuring, tighter prose,
evidence gaps or a different ending.

Agent conversations stay with the document. Close the panel, come back
tomorrow and revisit the chat, its plan, the files it touched and every
proposal it produced.

Agents do not silently replace the manuscript. Focused edits arrive as focused
diffs. Large changes open with a structural overview. Essay records the agent,
instruction, affected sections and resulting revision; the author accepts,
rejects or reverts.

### Let the agent work on the page, too

The document's design is part of the argument. Ask Essay to make a report more
authoritative, strengthen the heading hierarchy or fit a board memo to two
pages.

An agent can propose changes to prose, document settings and the local Typst
template. Essay shows the wording diff and the old/new rendered pages together,
including page-count changes, affected documents and compiler warnings, before
anything is accepted.

### Finish without leaving the flow

Move from screen prose to a real typeset proof. Essay turns Markdown into
print-quality pages with considered typography, citations, tables and a small
library of excellent templates. Export a PDF whose design belongs to the
document rather than to a word processor's toolbar history.

### One manuscript. Full context. Final pages.

Essay combines the speed and calm of a great notes app, the editorial control
of professional review tools and the output quality of a typesetting system—
without becoming a wiki, an IDE or a hosted AI service.

For essays, proposals, reports, RFCs, board papers and any document important
enough to think through.

---

## Internal build contract

This is the target product promise, not a claim that every line ships today.
Build against it in this order; do not add a feature that cannot be explained
by one of the promises above.

| Order | Customer promise | Current evidence | Coherent next release |
| --- | --- | --- | --- |
| 1 | Find and revise without friction | UTF-16-safe open-buffer search and editor run mapping exist | Add a manuscript find strip, all-match decorations, next/previous, then safe replace |
| 2 | Comment on what the document says | Selection toolbar, outline/gutter and planned anchor types exist | Ship durable multi-block comments with live range mapping and visible detachment |
| 3 | See the shape of the work | Outline, section words, marks, task items, structural agent diffs and gutter exist | Compose them with comments into a section-keyed document work map in Structure |
| 4 | Trust the ordinary writing surface | Image insertion and GFM tables exist; footnote/math syntax is preserved as unknown text | Finish spelling, images and tables; then ship first-class footnotes and maths end to end |
| 5 | Revisit agent conversations | ACP transcript, plans, tool calls, proposals and live sessions exist in memory | Persist document-scoped chats and unresolved review state; add ACP `session/load` with an honest continuation fallback |
| 6 | Let the agent work on the page | Typst render, PDF export, all-path intercepted change sets and proof companion exist | Ship editable templates, a tracked-file safety net for direct writes, then visual old/new typography review against one memo fixture |
| 7 | Keep material close | Multi-root Markdown explorer, project search and atomic file IO exist | Add linked ordinary Markdown materials, quick capture and Insert/Quote/Link/Mark used |
| 8 | Track questions and decisions | Sidecar/history architecture and planned anchor types exist | Reuse the comment anchor system for section questions, decisions and editorial tasks |
| 9 | Connect evidence to prose | Bracketed citations and neighbouring bibliography rendering exist | Index references, validate keys and connect source material to author-reviewed bibliography edits |
| 10 | Finish beautifully | One embedded Typst template, live proof and PDF export exist | Template library/picker, then editable Page dress and source-to-page mapping |

### Definition of done for every promise

- It works fully offline after any optional agent adapter installation.
- Canonical prose and substantive material remain ordinary files.
- Deleting `.essay/` cannot delete a manuscript, source or fragment.
- The manuscript stays mounted and primary while peripheral readings open.
- Every agent file change is reviewable and carries provenance.
- A visual change gets visual review; a text diff alone does not approve
  typography.
- Empty capabilities consume no permanent space.
- The feature works on a real long document, not only a five-paragraph demo.

The immediate authoring targets are orders 1 and 2. The full concrete sequence
and file-level seams live in [the authoring backlog](./authoring-backlog.md).
Persistent chats and the typography proof follow without leapfrogging the
ordinary writing floor.
