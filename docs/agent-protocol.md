# Agent protocol

AI proposes; the author decides. Agents behave like editors, not invisible
co-authors. No model silently rewrites the canonical document.

## Two integration paths

### Universal fallback (works with any tool immediately)

The agent edits the Markdown file directly. Essay watches the filesystem,
captures before/after states, and presents the external change as a
reviewable change set.

### Native patch protocol (better, never required)

The `essay` CLI (`crates/essay-cli`) exposes machine-readable operations:

```bash
essay inspect document.md
essay outline document.md        # implemented
essay read document.md --section argument
essay search document.md "distribution model"
essay propose document.md --patch changes.json
essay render document.md
essay status document.md
```

Agents submit structured patch sets via `propose` instead of rewriting the
file.

## Provenance

Every proposal records:

- who or what proposed the edit
- the instruction that produced it
- the affected sections
- the exact patch
- when it happened
- whether it was accepted

## Review

Changes are reviewable inline, side-by-side, section by section, revision by
revision, or as a whole-document summary. Moves render as moves where
possible. Large agent changes open with an overview (per-section edit
counts) before drilling into exact text.

## First integrations

Claude Code, Codex CLI, Gemini CLI, arbitrary shell commands, future local
models. Essay integrates local agents; it does not become a model provider.
