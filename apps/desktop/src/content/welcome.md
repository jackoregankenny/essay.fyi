# Welcome to Essay

Essay is a fast, local-first environment for developing serious documents from rough thought into finished work. You are editing the designed document — real headings, real tables — while the file on disk stays ordinary Markdown.

## Write the document, not the markup

Type Markdown and it becomes the thing itself: `# ` starts a heading, `**bold**` embolds as you close it, `> ` opens a quote, `---` becomes a section break. The syntax disappears; the document remains.

> AI proposes; the author decides. No model silently rewrites the canonical document.

## The manuscript stays yours

Everything here serializes back to plain Markdown. Open it in another editor, commit it to Git, hand it to Claude Code. Essay keeps its own state — history, comments, provenance — in a removable `.essay` sidecar that can never corrupt your writing.

Edit the file elsewhere while it is open here and Essay notices, snapshots what arrived, and asks you what to do with it. A save never overwrites a change it has not shown you.

## Evidence, laid out properly

| Milestone | Focus | Status |
| --- | --- | --- |
| A writer worth using | Files, autosave, palette | done |
| Beautiful documents | Typst preview and PDF | done |
| History and diffs | Revisions you can explain | next |
| Agents | Reviewable proposals, not rewrites | planned |

- [x] Rich manuscript editing over plain Markdown
- [x] Open and save real files, with crash recovery
- [x] Print-quality PDF export
- [ ] A revision timeline you can read

---

## Try it

Type anywhere. Add a heading and watch it appear in the outline. The print pane shows ==real typeset pages== as you write — toggle it with Ctrl+J when you just want to think. Select any text and mark it to come back to later; marks live in the file as plain `==text==`.
