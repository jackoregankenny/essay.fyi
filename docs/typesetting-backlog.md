# Typesetting build list

> Planning record, 2026-08-14. Written at the point where Essay became the
> tool its author uses daily and the gap stopped being theoretical. Complements
> the [authoring backlog](./authoring-backlog.md), which covers the manuscript
> surface; this covers what happens when the manuscript is ready to be dressed.

## Where this actually stands

Rendering works and has since Milestone 2. What is missing is every choice
around it.

- **One template, welded in.** `essay-render` embeds
  `templates/essay/essay.typ` with `include_str!`. There is no per-document or
  per-project override — the comment on that constant has said "Authors will be
  able to override it per project" since it was written, and that is still the
  whole plan.
- **`templates/memo`, `templates/report`, `templates/rfc` are README files.**
  The directories exist; the templates do not.
- **No document face.** `FontsPage` lists every family the typesetter can
  resolve and installs new ones, but nothing binds a family to a document. The
  prose-face preference (sans/serif) is the *editor's* face and never reaches
  the PDF. So an author can install a typeface and still have no way to set
  their document in it — which is close to the worst possible half of the
  feature, because it looks finished.
- **No flow.** There is a Proof companion that shows pages and an Export PDF
  command. There is no answer to "make this look like the thing I send."

Nothing here is a bug. It is the part that was deferred while the file, the
durability layer and the authoring surface were built, and it is now the
weakest link.

## The shape of the answer

### 1. A format is a thing you can hold

The unit is a **format**: a Typst template plus its defaults (page geometry,
face stack, size, leading, and whatever the template chooses to expose). It has
to be a *file or folder*, not a row in a database, because the second
requirement is that formats can be handed to someone else.

Constraints that are not negotiable:

- **Invariant 1.** The canonical document stays plain Markdown. A format is
  referenced, never inlined, and a document whose format is missing must still
  open, still edit, and still export — falling back to the built-in with a
  notice, never failing.
- **Invariant 6.** No registry, no fetch. Importing a format is reading a file
  the author already has. This is the same reasoning that kept Typst Universe
  out of `world.rs`, and it applies with more force to something an author is
  emailed.
- **Untrusted input.** A format is executable Typst from someone else. It runs
  in the same `World` as everything else, and that World has no package
  resolution and no filesystem escape today — both of which must stay true, and
  should be stated as a security property rather than left as an accident of
  the current implementation.

Resolution order, most specific first: the document's front matter, then a
project-level format beside the workspace root, then the author's installed
formats, then the built-in. The built-in stops being the only path and becomes
the last one.

### 2. The document's face is a document decision

Which family a manuscript is set in belongs to the document, not to the
machine — two people opening the same file should get the same page. That
argues for front matter, and it collides with the font reality: Essay uses the
machine's fonts, so a named family may not exist here.

The existing answer generalises. `essay.typ` already names a *stack* rather
than a family for exactly this reason, so a document's face should be a stack
too: the author's choice first, the template's stack behind it. Then a missing
family degrades to the same page everyone else was getting, rather than to an
error — and the Proof pane should say which family actually resolved, because
"why does this look different on my laptop" is otherwise unanswerable.

`FontsPage` is the natural place to choose from: it already knows the resolved
set, and it already distinguishes families the author installed from the
machine's own.

### 3. There has to be a flow, and Proof is it

The Proof companion is where a document goes to be dressed. It shows pages
already; it should also be where the format is chosen, where the format's
exposed knobs are set, and where the result is exported. Not a modal, not a
separate app mode — the overhaul's position is that typesetting is where
writing *goes*, in the flow (Jack, 2026-08-06: authoring first; typesetting
after, in the flow).

Warnings already surface there, grouped. Font resolution belongs beside them.

### 4. Distribution

Export a format to a single file; import one from disk. Two verbs, no
directory, no accounts. `essay format export <name>` / `essay format import
<path>` are the CLI shape, which also gives the app something to call.

## What this is not

- Not a theme gallery, and not a marketplace. Invariant 6 makes the second
  impossible and the first is a distraction from an author who needs one house
  style that survives being sent to a colleague.
- Not WYSIWYG page editing. The manuscript surface stays prose; the page is a
  rendering of it, and the template is where page decisions live.
- Not a reason to embed fonts. That decision is measured and recorded
  (`typst-assets` fonts off, 9.23 MB, two of four families reached); a format
  names a stack precisely because the binary does not carry faces.

## Author-supplied formats, and the variables they get

Added 2026-08-14, from use. Two things the built-ins cannot cover.

**A format has to be a file you can be handed.** Settings needs an import, and
the unit it imports has to be a single file — one `.typ` — because the moment
it is a folder it is a thing people get wrong over email. Import copies it into
the app data dir beside the installed fonts, which is where machine-level
things already live and which the resolution order already reaches. Export
writes the reverse. No registry and no fetch: importing a format is reading a
file the author already has, and that is the same reasoning that kept Typst
Universe out of `world.rs`.

The safety property has to be stated rather than assumed, because a format is
executable Typst written by somebody else. `EssayWorld` today serves a fixed
map of virtual sources, has no package resolution, and resolves file reads
against the document's own folder. That is already a sandbox; it is currently
an accident of the implementation rather than a promise, and it should become
a promise with a test that a format cannot read outside the document root.

**A format needs a documented surface.** Right now `doc(title, author, date,
face, body)` is the whole contract and everything else is hardcoded inside each
template. An author writing their own has nothing to copy but the built-ins.
So: a `templates/format-template.typ` that is a working, heavily commented
starting point, and a named set of parameters every format is expected to
accept — page size and margins, base size and leading, justification, heading
scale, and the three stacks. `base.typ` already holds most of these as
defaults; the work is making them parameters rather than constants and writing
down which ones a format may ignore.

Those parameters are also what the Proof pane's toggles operate on. The
sequencing matters: expose them as template parameters first, then surface the
subset worth a control. A toggle that writes a value no format reads is worse
than no toggle.

## Reading the proof

The companion column is 21rem, so an A4 page in it is a 330px thumbnail — it
shows that pages exist, not whether one is any good. Clicking a page opens the
same component over the whole canvas (landed 2026-08-14). Export stays
available in both, because the reason to be in the full view is to decide the
document is finished.

Still open: page-level zoom, and whether the full view should scroll by page
rather than continuously.

## Order

1. ~~Document face as a stack, chosen in `FontsPage`~~ — done.
2. ~~Format resolution order, with the built-in as the fallback~~ — done.
3. ~~Format choice in the Proof companion~~, and a readable proof — done.
4. Parameterise `base.typ`, and write `templates/format-template.typ` as the
   documented starting point. Everything below depends on this existing.
5. Import and export a format from Settings, plus the sandbox test that makes
   running someone else's Typst a stated property rather than a hope.
6. The subset of parameters worth a toggle, in Proof.
