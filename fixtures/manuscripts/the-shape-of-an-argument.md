---
title: The Shape of an Argument
subtitle: On the structure of long-form reasoning and the tools that carry it
author: Fixture Corpus
date: 2026-07-31
---

# The Shape of an Argument

Every long document is two things at once. It is a sequence of sentences, read
in order, one after another. And it is a structure — a claim supported by
sections, each of which is itself a smaller claim supported by paragraphs. The
first is what a reader experiences. The second is what a writer builds.

Most writing tools serve only the first. They present the document as a scroll
of text, and they are good at the things a scroll needs: typing, formatting,
spell-checking. What they are not good at is the second document — the one made
of load-bearing parts, where moving a section three positions earlier is not a
cut and paste but a structural decision with consequences three sections later.

This essay is about that second document, and about what it would mean to build
tools that take it seriously.

## Part one: what a draft actually is

### The illusion of linear composition

Writing advice, almost universally, describes a linear process. Outline, then
draft, then revise. The outline precedes the draft because the outline is
supposedly the plan, and the draft is supposedly its execution.

Anyone who has written anything substantial knows this is not what happens. The
outline is provisional. It survives contact with the third section and then
begins to bend. By the time the draft exists, the outline it came from describes
a document that was never written.

> The plan is not wrong. It is simply superseded by what the writing discovers.

This is not a failure of discipline. It is the mechanism by which long-form
thinking works. You cannot know what the argument requires until you have tried
to make it, and trying to make it changes what you think the argument is.

### Structure as a working surface

If the outline is continuously revised by the drafting, then the outline is not
a plan. It is a **view** of the document — one that needs to stay accurate as
the document moves, and one the writer needs to manipulate directly.

Consider what a writer actually does in the middle of a long draft:

- Reads the current section and decides it belongs somewhere else
- Notices that two sections make the same point and one must go
- Realises a claim in section nine depends on evidence that has not been
  introduced until section fourteen
- Discovers that what looked like one section is really three

None of these are text operations. They are all structural operations that
happen to be *performed* as text operations, badly, because text is the only
handle the tool offers.

### The cost of a missing handle

The cost is not that these operations are impossible. It is that they are
expensive enough to be avoided. A writer who knows that reorganising the middle
third of a document means twenty minutes of careful scrolling, cutting, and
re-reading will, at the margin, not reorganise it.

The document gets worse in a way that is invisible in the finished text. Nobody
can see the restructuring that did not happen.

## Part two: the document as a file

### Why the format matters more than the features

A serious document has a long life. It is drafted, circulated, revised against
comments, revised again, and then — often years later — mined for a passage or
resurrected as the basis of something else. Over that life it will pass through
more tools than any of its authors anticipate.

This is the argument for plain text, and it is not a nostalgic one. It is an
argument about what happens when a tool disappears.

| Format | Readable in ten years | Diffable | Editable elsewhere |
| --- | --- | --- | --- |
| Plain Markdown | Yes | Yes | Any editor |
| Proprietary binary | Only with the tool | No | No |
| Hosted document | Only with the account | Partially | Through export |

The middle column is the one that matters most and is noticed least. A document
you cannot diff is a document whose history you cannot inspect, which means it
is a document whose development you cannot explain.

### The sidecar principle

The objection to plain text is that plain text cannot hold everything. Comments,
revision history, provenance, review state — none of these fit in a Markdown
file without polluting it.

The resolution is straightforward. Keep the manuscript plain and keep everything
else beside it, in a directory that can be deleted without consequence.[^sidecar]

[^sidecar]: The test of a sidecar is simple: delete it and see what you lose. If
    you lose history, that is acceptable. If you lose the document, the design
    was wrong.

This has an underappreciated property. It means the tool can be abandoned. A
writer who stops using the tool keeps the document; a writer who keeps using it
gets the history. Neither is held hostage.

### What round-tripping demands

A tool that edits a designed document while storing plain Markdown makes an
implicit promise: what you opened is what you save, minus your edits. This is
harder than it sounds.

```markdown
Some **bold** text with a [link][ref] and a footnote[^1].

[ref]: https://example.com
[^1]: The footnote body.
```

A naïve editor parses this into a tree, edits the tree, and writes the tree back
out. The result is semantically identical and textually different: reference
links become inline links, footnote ordering shifts, emphasis markers change from
asterisks to underscores. ==Every one of those changes is noise in a diff.==

The discipline is that unknown or unhandled syntax must survive untouched. Not
"survive semantically" — survive *byte for byte*.

## Part three: revision as a first-class object

### Undo is not history

Undo answers a question about the last few seconds: what did I just type? It is
a stack, it is linear, and it is discarded when the application closes.

History answers a different question entirely: how did this document change over
the last week? Which sections have been rewritten three times and which have not
been touched since the first draft? What did the version I sent for review
actually say?

These are not the same feature at different scales. They have different
granularity, different lifetimes, and different units. Undo operates on
keystrokes. History operates on sessions, checkpoints, and edits from outside.

### Where a revision begins

The hard question in revision history is not storage. It is boundaries. What
counts as one revision?

The wrong answer is "every save", which produces a timeline of a thousand
identical-looking entries that no one will ever read. The other wrong answer is
"every explicit checkpoint", which produces a timeline with nothing in it,
because nobody remembers to checkpoint.

A better answer treats a *session* as the unit — a run of continuous editing
with no long gap — and adds explicit boundaries for the events that are
genuinely discrete:

- [x] A focused editing session
- [x] An edit that arrived from outside the tool
- [x] An explicit checkpoint
- [ ] An accepted proposal from an agent
- [ ] A restore from an earlier state

### Diffs that show moves as moves

The standard text diff has a blind spot that matters enormously for prose. When
a section moves, a line-based diff reports it as a large deletion in one place
and a large insertion in another. The two are, as far as the diff is concerned,
unrelated.

For code this is tolerable. For a document under structural revision it is
close to useless, because structural revision is *mostly moves*. A reviewer
looking at a diff that shows four hundred deleted lines and four hundred
inserted lines learns nothing about what actually happened.

Detecting moves requires matching blocks across revisions, which requires block
identity, which is exactly the thing plain text does not provide. Identity has
to be inferred — from content, position, and surrounding structure — and inferred
well enough to be trusted.

---

## Part four: writing alongside a machine

### Proposal, not application

There is a version of AI writing assistance that rewrites your document and
shows you the result. It is fast, it is impressive in a demonstration, and it is
corrosive to authorship, because the author's relationship to the text becomes
supervisory rather than compositional.

The alternative is not slower in any way that matters. The model proposes a
change set. The change set is reviewable, section by section, with the
instruction that produced it attached. The author accepts, rejects, or edits.
Nothing enters the document without a decision.

> The distinction is not about trust in the model. It is about what the author
> knows about their own document. A change you approved is a change you can
> explain.

### Provenance is a property of the document

If a paragraph was proposed by a model and accepted by the author, that fact is
worth keeping. Not as a warning label — as an ordinary part of the document's
history, alongside who wrote what and when.

The practical value shows up months later, when someone asks where a particular
claim came from and the answer is recoverable rather than reconstructed.

### The universal fallback

Any tool that integrates with external agents faces an awkward truth: the agent
can always just edit the file. It does not need permission, an API, or a
protocol. It has a filesystem.

This is either a problem or the foundation, depending on how you look at it. If
the tool watches the file and treats any unexpected change as a proposal to be
reviewed, then *every* agent works — including ones that did not exist when the
tool was written, and including a person with a text editor in another window.

The richer integrations then become an optimisation. They add provenance and
intent to a channel that already works without them.

## Part five: speed as a design constraint

### What must never block

Typing must never wait. Not on rendering, not on indexing, not on a model, not
on a save. This sounds obvious and is routinely violated, usually by features
that are individually reasonable and collectively fatal.

The discipline is architectural rather than a matter of optimisation. Anything
that might be slow runs somewhere else and reports back. The editor's job is to
accept keystrokes.

| Operation | Budget | Strategy |
| --- | --- | --- |
| Keystroke to glyph | Immediate | Nothing else on the path |
| Outline update | One frame | Incremental over the visible region |
| Typeset preview | Under a second | Debounced, off-thread, latest wins |
| Full-document search | Under a second | Indexed, incremental |

### Latency and thought

The reason this matters is not user satisfaction in the abstract. It is that
composition is a fragile cognitive state, and interruption is expensive in a way
that is difficult to measure and easy to underestimate.

A writer who is thinking about a sentence and encounters a fifty-millisecond
stall does not consciously notice it. A writer who encounters it forty times an
hour is writing in a different mental register than one who does not.

## Conclusion: the document you can explain

The test of a tool for serious documents is not whether the finished output
looks good. Plenty of tools produce good-looking output.

The test is whether, at the end, the author can explain the document: how it got
its shape, which arguments were tried and abandoned, what changed after review
and why, which passages came from where. A document you can explain is a
document you actually own.

That property is not a feature. It is a consequence of a set of decisions —
about formats, about history, about what happens when a machine suggests a
change — that have to be made early and held to.

[^closing]: This document is a fixture. It exists to exercise headings,
    footnotes, tables, task lists, block quotes, code fences, highlights and
    front matter at a length where structure begins to matter.
