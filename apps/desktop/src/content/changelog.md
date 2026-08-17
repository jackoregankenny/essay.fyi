# What's new in Essay

Every release, in the order it happened. The newest is at the top.

## 0.1.0 — Unreleased

The first build worth handing to someone else. Essay opens a Markdown file, lets you edit the designed document rather than the markup, typesets it properly, and never rewrites a word you did not ask it to.

### Writing

You are editing real headings, real tables, real lists — and the file on disk stays ordinary Markdown. Type `# ` for a heading, `**bold**` to embolden as you close it, `> ` to open a quote. Raw HTML survives a save, inline and block, and so does anything else Essay does not recognise.

Focus mode dims everything but the block you are in and keeps it vertically centred. Mark a passage with `==come back to this==` and it lives in the file as plain text, readable anywhere.

- Select text for the formatting bubble, including links and highlights
- `Ctrl+K` opens the command palette; `Ctrl+F` searches this document and the whole workspace
- Comments attach to a range and survive the caret moving away
- Images can be dropped, pasted, and stored beside the document

### Beautiful documents

The print pane shows real typeset pages as you write, and export gives you a PDF of exactly that. Citations written as `[@key]` resolve against a `references.bib` beside the document. Essay uses your machine's fonts rather than shipping its own, and you can install more into it from Settings.

| Surface | What it does |
| --- | --- |
| Structure | The outline, section word counts, marks and comments |
| Proof | Live typeset pages, and what the compiler said |
| Agent | A transcript, and edits offered as reviewable proposals |
| History | Every revision, with a diff and a way back |

### Nothing gets lost

Essay journals what you are typing 600ms after you stop, so a crash costs nothing. Every save is guarded by a content hash: if the file changed underneath you — an agent, a `git checkout`, another editor — Essay snapshots what arrived and asks, rather than overwriting it.

- [x] Whole-content snapshots in a deletable `.essay` sidecar
- [x] A revision timeline you can read, diff and restore from
- [x] External edits caught and shown before they reach the editor
- [x] Crash recovery for documents that were never saved

### Agents propose, you decide

Essay speaks the Agent Client Protocol and hosts `opencode` and Claude Code. An agent's file write arrives as a change set with provenance, not as a silent rewrite — and when an agent writes to disk directly, the watcher catches it and offers you the revert.

---

Essay is offline-capable by design: no accounts, no required network, and your documents are plain files you can take anywhere.
