# Internals: search

For contributors working on `essay-search`, or on any surface that has to turn
a match into a place in the manuscript.

One rule shapes the crate: **nothing outside it decides what a match is.** The
palette asks and renders what comes back; a find bar and an `essay search` verb
would do the same. That is the discipline that keeps `essay-diff` in one place,
applied to the other question a document gets asked.

## No index, and no regex

A straight scan over the bytes. Nothing is built at launch, nothing needs
invalidating when an agent rewrites a file behind Essay's back, and nothing
lands in `.essay/` that would be wrong if deleted. A forty-page document is
routine rather than large, so an index would buy a writer no time they could
perceive and would add a thing that can be stale.

There is no regex engine either. A writer looks for words and phrases. The two
knobs that earn their place are `case_sensitive` and `whole_word`, and both are
a few lines rather than a dependency and a syntax to learn.

`SearchOptions` also carries two caps — `max_matches_per_document` (20) and
`max_documents` (100). The counts are reported in full regardless, so "12 of
340" stays honest while the list stays readable, and `ProjectSearch.truncated`
says when the document cap stopped the walk.

## Every offset is UTF-16

The consumer that turns an offset back into a caret is the editor, and
ProseMirror counts in UTF-16 like the JavaScript strings underneath it. A byte
offset would land mid-character in any document with an em dash in it, and the
caret would arrive somewhere the author was not looking.

Two consequences that are easy to undo by accident:

- **The case fold is one character to one character** (`fold`), not
  `str::to_lowercase`. The folds that change length — `ß` to `ss`, `İ` to `i`
  plus a combining dot — would put every offset after them out by one. Missing
  a match nobody searched for is the cheaper failure.
- **Lines are split with `split_inclusive('\n')`**, so a CRLF file advances the
  running offset by two. Splitting on `'\n'` and adding a constant drifts by a
  character per line on anything a Windows tool wrote, and every caret lands
  one word further off than the last.

A match never spans a line break. That is a decision, not a limitation of the
scan: a match straddling two lines has no line number and no excerpt worth
reading, and the editor hands over one line per block, so nothing an author
sees as a sentence is split by the rule.

## The excerpt is the sentence, not the line

A Markdown paragraph is usually a single very long line, so quoting the line
quotes the whole paragraph. `excerpt_around` finds the sentence the match sits
in, cutting to `MAX_EXCERPT` (200) around the match with an ellipsis at each cut
end, and reports `excerpt_start` so the caller can highlight the match inside
it.

Block markers the line opens with are stripped, because an excerpt that begins
`## ` reads as a file listing rather than as a sentence. `marker_width` matches
narrowly — **marker plus its space** — so `**bold**` opening a paragraph is not
mistaken for a bullet and left as an emphasis that closes without opening.

An abbreviation ("Dr. Aoife") reads as a sentence break and costs the excerpt a
few words of run-up. That is the entire downside, so the rule stays simple
rather than growing a list of abbreviations to know about.

## Two texts, two coordinate systems

| | Open document | Workspace folders |
| --- | --- | --- |
| Searched | The flattened manuscript from the editor | The Markdown file on disk |
| Command | `search_document` | `search_project`, on `spawn_blocking` |
| Offsets map to | A ProseMirror position, via `positionAtOffset` | Nothing — the file is re-searched after it opens |
| Line numbers | Not shown | Shown |

**The open document is searched flattened, not as Markdown.** An author looking
for "the quick brown" expects to find it whether or not "quick" is bold, and
does not expect a hit inside a link's URL; the source answers both questions the
other way round. `manuscriptText` in `@essay/editor` walks the document, emits
one line per textblock, and records a run map of `{offset, pos, length}`.
`positionAtOffset` is a lookup against that map — it is not a second search.

**A project hit is an offset into a file, which says nothing about a
ProseMirror position.** So clicking one opens the document and finds the phrase
again in the loaded buffer. Two searches for one click, both cheap, and the
caret lands where the result promised rather than at the top of the file.

That asymmetry is also why in-document rows carry **no line number**: the buffer
is searched by block, so its "line 4" is not the file's line 4, and a number
that is nearly right is worse than none.

The open document is skipped in the folder pass (`skip`, matched on the
canonical path). Its buffer is ahead of disk between autosaves and is the only
version whose offsets can become caret positions — listing the file's copy
beside those would offer the author two answers to one question.

## What the walk refuses to look at

- **Hidden directories, `.essay/` above all.** Not a tidiness rule: the sidecar
  holds every revision of every manuscript in the folder, so searching it would
  answer a search for a sentence with every draft that ever contained it.
- `node_modules`, `target`, `dist`, `build`, `out` — the same list the explorer
  and `RootWatcher` skip.
- `.md`/`.markdown` only, and nothing over 4 MB: a Markdown file that large is
  generated output or a data dump, and reading it costs more than any match in
  it is worth.
- 12 directories deep, which is a guard against symlink loops and against
  someone adding their home directory as a workspace folder.

Roots may overlap — the explorer allows a folder and its own subfolder — so
files are de-duplicated by canonical path, and a file reached twice is one
result with one set of matches. Files are sorted within each root, so the same
search twice reads the same way.

Results are grouped by document and titled by its **first heading**, falling
back to the relative path. A writer knows their work by its title far more
readily than by its filename.

## In the palette, not in a bar

`Ctrl+F` opens the command palette, and typing runs the search. The question
"where did I write that" is the same question whether the answer is in this
document or in the folder beside it, so it gets one surface.

Two details in `CommandPalette`:

- **Results are appended, not filtered.** They were selected by the query
  already, and running them back through the command scorer would drop every
  hit whose excerpt does not repeat the words in the same case — which is most
  of them.
- **The query is debounced 180ms and stale answers are dropped**, not raced: a
  folder walk for "riv" can outlive the one for "river", and the author is
  reading the newer query. Queries under two characters do not walk anything.

## What is deliberately out

Regex. Find-and-replace. A persistent find bar with next/previous. Highlighting
every match in the manuscript. Filename quick-open. And an `essay search` CLI
verb — the crate API is shaped for it, and the verb still prints "not
implemented yet".

## Tests

`cargo test -p essay-search` — 23 tests, including the UTF-16 offset with an
astral character in front of it, CRLF offsets, the whole-word rule around an
apostrophe, excerpt cutting, and the overlapping-roots de-duplication.

`bun test` covers the editor half: the flatten and the offset-to-position map,
including a match split across mark boundaries and one after an astral
character.
