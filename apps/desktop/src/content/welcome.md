# Welcome to Essay

Essay is a fast, local-first environment for developing serious documents from rough thought into finished work. This file is an ordinary Markdown document — open it in another editor, commit it to Git, or hand it to Claude Code. Essay never takes ownership of your manuscript.

## The manuscript stays yours

The canonical document is this plain Markdown file. Essay keeps its own state — history, comments, provenance — in a removable `.essay` sidecar. Deleting that sidecar loses Essay-specific history; it can never corrupt your writing.

Unsupported syntax survives untouched. The source is canonical; everything Essay knows about the document is an index over that source.

## Three coordinated views

The **structure** pane on the left is more than a table of contents: it will grow section word counts, page weight, revision activity and proposed changes.

This **manuscript** pane is source-faithful Markdown. Syntax stays visible but quiet — never hidden behind an opaque rich-text layer.

The **print** pane will show the actual typeset document, compiled by Typst, updating as you write. A two-page memo should be visibly two pages.

## What comes next

1. Open and save real files, autosave, crash recovery
2. Print-quality Typst output and PDF export
3. Revision history with text and structural diffs
4. Agent edits that arrive as reviewable change sets

> AI proposes; the author decides. No model silently rewrites the canonical document.

## Try it

Type anywhere. The outline, word count and page estimate update as you write. Headings you add appear in the structure pane immediately.
