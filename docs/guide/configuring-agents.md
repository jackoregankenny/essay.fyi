# Configuring an agent

For anyone who has an agent session working and wants to shape how it
behaves.

Three mechanisms, in increasing order of how much they are yours: the agent's
own knobs, standing instructions you write as files, and the commands the
agent offers. None of them enforce anything — the diff is what does that. See
[working with agents](./agents.md) for the review side.

## Session options

Agents advertise knobs — model, effort, mode, persona — and Essay renders
whatever arrives without knowing any of them by name. They live behind the
faders icon in the panel header, off by default: these are decisions made once
a session, not while writing.

The Claude Code adapter advertises Model (with pricing), Effort, Agent persona
and Mode; opencode advertises its whole model catalogue.

Two behaviours worth knowing:

- **Your choices are remembered per agent**, in the browser store, and
  re-applied when a session starts. An agent advertises its defaults fresh
  every launch, so a preference that was not written down would be a
  preference you re-enter daily. A knob the agent has since retired — a model
  withdrawn between releases — is dropped rather than sent.
- **You can change a mode mid-turn.** Switching out of a plan mode while the
  agent works is the point of modes.

Changes are optimistic in the panel — a select that snapped back while the
round trip ran would read as broken — and the agent's own answer replaces them
a moment later. If the agent refuses a value, what you end up looking at is
the agent's answer, not Essay's guess.

## Skills

Skills are standing instructions handed to the agent at the start of a
session. They are not code, and they do not enforce anything — they shape what
the agent is likely to do; the diff is what stops an unwanted result being
accepted.

There are two kinds.

**The house skill** is built in, always sent, and not yours to maintain. It
tells the agent this is a manuscript rather than a codebase: the file is the
finished product, do not reflow paragraphs or renumber lists, edit surgically,
do not invent citations, preserve the author's voice and spelling, and say in
one sentence what changed and why.

**Preference skills** are your own, and they are files. Put a Markdown file in
`.essay/skills/` beside the document:

```markdown
---
name: Spelling
scope: document
---

British spelling throughout. Never "utilize".
```

`name` is what the panel shows, and `scope` is either `document` or `section`
— a claim about how much the agent should touch, recorded so the diff can be
checked against it. Both are optional; without front matter the file name is
the skill name. A file with no body is skipped, and a malformed one is skipped
rather than failing the load.

Skills are read fresh whenever you switch documents, so editing one does not
mean restarting Essay. They are files because that is what the rest of Essay
is: editable in Essay itself, diffable, shareable, and deletable without
breaking anything.

Two worked examples ship in the repository, ready to copy into a document's
`.essay/skills/`:

| File | Scope | What it asks for |
| --- | --- | --- |
| [`templates/skills/house-style.md`](../../templates/skills/house-style.md) | document | British spelling, active voice, no "Moreover", closed em dashes |
| [`templates/skills/tighten.md`](../../templates/skills/tighten.md) | section | Cut hedging and connective padding, keep examples and cadence |

`tighten.md` is the better model to copy from if you are writing your own: it
says what *not* to cut as clearly as what to cut, which is the part a skill
usually gets wrong.

Skills appear as toggles above the composer. Your preference skills come after
the house skill in the composed prompt, so where they conflict, yours win.
They are sent once, on the first turn of a session, because the agent keeps
them in context afterwards and repeating them every turn would spend your
subscription saying something already said.

Nothing is added to your prompt invisibly: `preview_agent_prompt` exists so
the panel can show you exactly what will be sent.

## Slash commands

When an agent advertises commands, typing `/` in the composer offers them with
their descriptions. The list arrives from the agent and is replaced whole
whenever it changes.

`Enter` sends; `Shift+Enter` is a new line.
