---
title: How AI models interact with Essay
subtitle: Two channels, one guarantee
date: 2026-07-31
status: explainer
---

# How AI models interact with Essay

Essay does not contain a model. It hosts agents that already live on your
machine — Claude Code, opencode, Codex, Gemini — and its job is to make sure
that whatever they do to your manuscript, you see it before you accept it.

## What ACP is

**ACP — the Agent Client Protocol — is a standard way for an editor to talk to
a coding agent.** It came out of Zed and is used by Zed, Obsidian, marimo,
JetBrains, Neovim and Emacs.

The problem it solves is dull and real: every agent has its own interface.
Integrate them one at a time and you maintain an adapter each, forever. ACP is
the agreement to use one shape.

Mechanically it is very ordinary. Essay launches the agent as a child process
and the two exchange JSON-RPC messages over its standard input and output —
one JSON object per line. No terminal, no network, no daemon, no ports.

A whole exchange looks like this:

```
Essay → agent   initialize      "I'm a client. I can read and write files for you."
agent → Essay   capabilities, authentication methods

Essay → agent   session/new     "Work in this directory."
agent → Essay   { sessionId: "ses_046f0bd4…" }

Essay → agent   session/prompt  "Tighten the section called X."
agent → Essay   session/update  thought:   "Let me read it first."
agent → Essay   session/update  tool_call: read   pending → completed
agent → Essay   session/update  tool_call: edit   pending → completed
agent → Essay   session/update  message:   "Done."
agent → Essay   { stopReason: "end_turn" }
```

Those `session/update` notifications are the panel. It is showing you an
agent's actual reasoning and tool calls as structured data, rather than
scraping them out of terminal output.

Capabilities run both ways. The agent declares what it can do; the *client*
declares what it will do **for** the agent. The interesting one is the
filesystem capability — *don't touch the disk, ask me and I will read and write
on your behalf* — because a client that is asked to write can decline, and file
the write as a proposal instead.

That is the theory. See below for what actually happens.

## The complication

Advertising that capability does not oblige anyone to use it.

opencode acknowledges the capability and then edits files with its own tools
anyway. Not a bug on its part, and not a misconfiguration — it simply has no
obligation to route through the client. Verified by watching the wire: zero
filesystem requests, zero permission requests, and the file changed on disk.

So Essay does not rely on it. Every open document is also **watched**. Any edit
that arrives from outside — an agent, a terminal, `git checkout`, another
editor — is noticed within a fifth of a second, decided by content hash rather
than by trusting the operating system's event stream.

## Two channels, told apart

Both routes end at the same review surface, but they are not the same event and
Essay does not pretend otherwise.

| | Proposal | Already written |
| --- | --- | --- |
| Where it came from | The agent asked | The agent just did it |
| State of the file | Untouched | Changed |
| What you are offered | Accept or reject | Revert or keep |
| Can you ignore it? | Yes | It has already happened |

The second is a weaker position and is labelled as one. What Essay guarantees
in both cases is that the previous version was captured *before* the change
landed, so choosing is never a choice about losing something.

## Why this shape and not another

There were five plausible ways to let an agent near a manuscript. Essay ships
the last two together; the rest were weighed and set aside.

| Approach | Gives you | Costs | Enforces review? |
| --- | --- | --- | --- |
| **Embedded terminal** | Every CLI, including ones with no adapter; the agent's own interface, slash commands and all | Scrollback in a writing app; no structure to render; provenance only by inference | No |
| **ACP host** *(shipped)* | Structured transcript, session control, one integration for several agents, provenance | A protocol to implement and track | No — see below |
| **Native patch protocol** | Section-scoped edits by construction | A protocol only Essay speaks, that every agent must opt into | No — an agent can ignore it |
| **Headless one-shot** | Good for a single palette command | No conversation, no follow-up | No |
| **File watching** *(shipped)* | Works for anything that can write a file, including tools not yet written | Sees the edit only after it lands | **Yes** |

The column on the right is the one that matters, and only the cheapest row
earns a yes. That is not an accident: nothing you offer a process that already
has your filesystem can stop it using your filesystem. Enforcement was never
going to come from a protocol.

The terminal remains a reasonable choice and a close call. It is more capable
and much less code. It loses on audience — a writer should not have to read
scrollback to find out what happened to their essay.

## What review actually shows

The important question about an AI edit is not "what changed" but **"did it
edit my document, or regenerate it?"**

A line diff cannot answer that. So Essay diffs structurally: sections matched
by heading, so a section that moved reads as *moved* rather than as a wall of
deletions beside a wall of insertions. It reports how many sections a change
touches, and when that crosses roughly two thirds it says so plainly — this
reads as a rewrite, not an edit.

That distinction matters because a regenerated document usually preserves your
meaning while quietly replacing your sentences. It looks like a small edit in
summary and is a large one in fact.

## The standing rule

> AI proposes; the author decides.

No model edit reaches your editor without a decision. Nothing is applied
silently, nothing is lost, and every version — yours, theirs, and the one you
rejected — stays in the document's history, in a sidecar folder you can delete
without harming the manuscript.

## What this is not

Essay does not give agents a special protocol for editing prose, and does not
plan to. Asked to tighten one section of a twenty-two section manuscript, a
real agent searched, read, and made a targeted edit: **one section changed,
seven words in, eight out.** It already edits rather than regenerates.

Nor would a bespoke protocol enforce anything. A process with access to your
filesystem can always ignore whatever tools it is offered. The only thing that
genuinely holds is watching the file and keeping the version that came before —
which is what Essay does, and which works for any agent, including ones that
did not exist when this was written.

So the guarantee does not rest on the agent's cooperation. It rests on the
snapshot taken before the change landed, and on your reading the diff.
