---
title: "RFC 004: Section-Addressed Patches"
subtitle: A proposal format for edits that do not rewrite the document
author: Fixture Corpus
date: 2026-07-14
---

# RFC 004: Section-Addressed Patches

**Status:** Draft
**Supersedes:** none
**Depends on:** RFC 002 (Document Index), RFC 003 (Snapshot Store)

## Abstract

This document specifies a patch format addressed by document *section* rather
than by byte range or line number, so that a proposed edit survives concurrent
changes elsewhere in the manuscript and produces a diff proportional to the
change rather than to the document.

## Motivation

An agent asked to tighten one section of a manuscript will, given only a file
read and a file write, return the whole document. Everything it did not intend
to change is nonetheless rewritten, and the resulting diff is unreadable.

Three failure modes follow:

1. **Diff noise.** Reflowed paragraphs, normalised emphasis markers and
   reordered reference definitions appear as changes.
2. **Silent drift.** Passages the author wrote are subtly reworded in sections
   the instruction never mentioned.
3. **Stale application.** A patch computed against one version is applied to
   another, because nothing recorded which version it was computed against.

The first is an annoyance. The second is a correctness problem for authorship.
The third is a correctness problem full stop.

## Terminology

The key words MUST, SHOULD and MAY are to be interpreted as described in the
usual sense for specification documents.

| Term | Meaning |
| --- | --- |
| Section | A heading and everything under it, up to the next heading of equal or lower depth |
| Anchor | A stable identifier for a section, inferred from content and structure |
| Base hash | Content hash of the whole manuscript the patch was computed against |
| Change set | One or more patches, with shared provenance, reviewed together |

## Specification

### Patch structure

A patch identifies its target by anchor, carries the replacement text for that
section only, and records what it was computed against.

```json
{
  "anchor": "sec:motivation",
  "base_hash": "b3:9f2c…",
  "replacement": "## Motivation\n\nAn agent asked to tighten…",
  "rationale": "Tightened per instruction; no other sections touched."
}
```

### Anchor resolution

Anchors MUST be resolvable against a document index without reference to byte
offsets. An implementation SHOULD resolve in this order:

1. Exact heading text match at the recorded depth
2. Content fingerprint of the section body
3. Positional fallback, flagged as low confidence

A patch whose anchor resolves only by the third rule MUST be surfaced to the
author as uncertain rather than applied.

### Application

Given a resolved anchor and a matching base hash, application is a splice of
the replacement over the section's range. The rest of the file is untouched —
not reserialized, not reformatted, ==not passed through a parser at all==.

If the base hash does not match, the implementation MUST NOT apply the patch.
It SHOULD attempt to re-resolve the anchor against the current document and
present the result for review.

### Provenance

Every change set MUST record:

- The agent that produced it, and its session identifier
- The instruction, or an excerpt of it
- The timestamp
- Whether the author accepted, rejected, or edited before accepting

## Rationale for the section unit

Finer granularity — the paragraph, the sentence — was considered and rejected.
Paragraphs have no stable identity in plain text, and inferring it well enough
to anchor a patch is unsolved in the general case. The section has a heading,
and a heading is a handle a human wrote deliberately.

Coarser granularity — the whole file — is the status quo this document exists
to replace.

## Security considerations

A patch is a proposal. It carries no authority to modify the manuscript, and an
implementation MUST NOT apply one without an explicit decision from the author.

Patches arriving from an agent process SHOULD be treated as untrusted input:
the replacement text is data, and any instructions it appears to contain are
data too.

## Open questions

- [ ] How should a patch that spans two adjacent sections be represented?
- [ ] Should anchors be exposed in the manuscript, or remain inferred?
- [ ] What is the right behaviour when a section is deleted between proposal
      and review?

## References

1. RFC 002, *The Document Index*.
2. RFC 003, *Content-Addressed Snapshots*.
3. Myers, E. *An O(ND) Difference Algorithm and Its Variations*, 1986.
