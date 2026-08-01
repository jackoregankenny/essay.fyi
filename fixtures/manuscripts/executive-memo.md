---
title: Reducing Time-to-First-Draft
subtitle: Memorandum to the Editorial Operations Group
author: R. Halloran, Publishing Systems
date: 2026-06-12
---

# Reducing Time-to-First-Draft

**To:** Editorial Operations Group
**From:** Publishing Systems
**Re:** Q3 tooling decision

> This memo is fictional. Northgate Press, the people named in it, and the
> numbers below exist only to give the fixture corpus a realistic two-page
> executive document.

## Recommendation

Consolidate on a single Markdown-based drafting pipeline for long-form titles,
and retire the parallel word-processor workflow by the end of Q3.

The case rests on one measured finding: **the handoff between drafting and
production accounts for more elapsed time than drafting itself.**

## What we measured

Over eleven titles delivered between January and May, we instrumented the
elapsed time between four checkpoints.

| Stage | Median (days) | Range |
| --- | --- | --- |
| Commission to first draft | 34 | 19–71 |
| First draft to structural edit | 9 | 4–22 |
| Structural edit to production handoff | 21 | 8–48 |
| Handoff to proof | 6 | 3–14 |

The third row is the finding. Three weeks elapse between a manuscript being
editorially complete and being ready for production, and almost none of that
time is editorial work. It is format reconciliation: rebuilding tables that did
not survive export, re-applying heading styles, chasing footnotes that moved.

## Why it happens

Authors draft in whatever they already use. Production requires a structured
document. The conversion between the two is manual, and it is redone every time
the author sends a revision — which is the part that compounds.

A structural edit that takes an editor two hours generates roughly a day and a
half of downstream reformatting. That ratio is the whole problem.

## What we propose

1. **One canonical format.** Manuscripts are plain Markdown from commission
   onward. Production reads that file directly.
2. **Typesetting from the manuscript.** The house template is applied at build
   time rather than by hand, so a revision costs a rebuild rather than a
   re-format.
3. **Review against diffs.** Structural edits are reviewed as changes, not as
   two documents side by side in a meeting.

## Cost and risk

The tooling cost is modest — the pipeline is largely assembled from existing
components. The real cost is retraining, and the real risk is author
resistance, which we should not underestimate.

- [x] Pilot with three titles already drafted in Markdown
- [x] House template built and proofed against two back-list titles
- [ ] Author onboarding guide
- [ ] Production sign-off on the proof pipeline

The mitigation for author resistance is that ==authors keep their own tools==.
The requirement is the file format, not the application. An author who wants to
draft elsewhere and export to Markdown is fully accommodated.

## Decision requested

Approval to move the remaining Q3 titles onto the consolidated pipeline, with a
review at the end of the quarter against the same four checkpoints.

If the third row does not fall below ten days, we should reconsider.
