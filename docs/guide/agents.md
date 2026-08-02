# Working with agents

For anyone who wants a coding agent editing alongside them, and wants to know
exactly what it can and cannot do to their manuscript.

Essay does not contain a model. It hosts an agent that already lives on your
machine — currently opencode or Claude Code — over the Agent Client Protocol,
and its job is to make sure you see what the agent did before you accept it.
The reasoning behind the design is in
[how AI models interact with Essay](../how-agents-interact.md).

## Starting a session

`Ctrl+Shift+A`, the robot in the header, or `Toggle agent panel` in the
palette.

An agent works on a file, so an untitled buffer cannot start one — save first.
The picker lists every agent Essay knows about, whether or not you have it,
with its command line underneath. An agent you do not have is greyed out and
says `— not on PATH`, so you can see what you could install:

| Agent | Launched as |
| --- | --- |
| opencode | `opencode acp` — native ACP, nothing to install beyond opencode |
| Claude Code | An npm adapter Essay installs for itself, run with `node` |

The session's working directory is the document's folder, so the agent can see
the manuscript's neighbours — notes, figures, other chapters — without being
handed your whole disk.

**First run needs the network once.** Essay pins a version of the Claude Code
adapter and installs it under its own app data directory on a background
thread. Until that finishes it falls back to `npx -y`, which asks the npm
registry about the package on every launch — seconds each time, and nothing at
all on a machine that is offline. After the install lands, launching is `node`
against a local script and works on a train.

### Pre-warming

Opening the panel connects to the agent you used last, before you have typed
anything, so the seconds an adapter takes to answer the handshake pass while
you are still composing. When that happens the transcript says so:

> Warmed up Claude Code — your last agent, connected while you were composing.

It happens once per time the panel is open, is skipped when the machine is on
battery, and never happens after you have pressed **End session** — that was
an answer. An idle session costs nothing until you prompt it.

## The two ways an agent's edit arrives

This is the part worth reading carefully, because the two are not the same
event and Essay does not pretend otherwise.

When Essay starts a session it tells the agent it will read and write files on
its behalf. A well-behaved agent then asks instead of writing, and Essay turns
that request into a proposal. **But advertising the capability does not oblige
anyone to use it.** opencode 1.17.8 acknowledges it and then edits files with
its own tools — verified by watching the wire: no filesystem requests, no
permission requests, and the file changed on disk.

So Essay also watches the file, and both routes end up in the same Changes
list with different words on them.

| | `proposal` | `on disk` |
| --- | --- | --- |
| What happened | The agent asked Essay to write | The agent wrote the file itself |
| The file right now | Untouched | Already changed |
| What you are offered | **Accept** or **Reject** | **Revert** or **Keep it** |
| Can you ignore it? | Yes — dismiss it and nothing was ever written | No; it has already happened |

The second is a weaker position and is labelled as one. What holds in both
cases is that the previous version was captured *before* the change landed, so
choosing is never a choice about losing something.

Rejecting a proposal needs no review — declining costs nothing, since the file
was never touched. Accepting always opens the diff first.

A row also carries the size of the change (`+21/−37 words`) and, when it
applies, a `rewrite` flag. Settled decisions collapse behind a `n settled`
toggle rather than disappearing.

## Reading the diff

Accepting or opening a row shows the change over the manuscript column, at
full width, with the transcript still beside it. `Escape` closes it and puts
you back where you were typing.

The diff answers a question a line diff cannot: **did the agent edit my
document, or regenerate it?**

- **Changed sections** are listed by heading — edited, moved, added, removed.
  A section that moved reads as *moved* rather than as a wall of deletions
  beside a wall of insertions.
- **Churn** is touched sections over total sections. When it crosses roughly
  two thirds, and there are at least three sections, the diff says so plainly:

  > **This reads as a rewrite, not an edit** — 83% of the sections changed. A
  > targeted edit changes one or two.

  It is a label, not a refusal. A rewrite can be exactly what you asked for.
- A pure reordering says "no words written or deleted" rather than reporting
  the words that appear on both sides of the line diff — true, and misleading.
- Long diffs stop after about 250 lines and offer to show more. Unchanged
  sections are hidden until you ask for them.

## Permission asks

When an agent wants to do something it thinks needs your say-so, the request
appears above the composer — not inside the transcript, where it could scroll
out of sight and leave the agent blocked on nothing. The options are the
agent's own (`allow once`, `allow always`, `reject once`, `reject always`).
The protocol request stays open on the wire until you answer, and the
transcript keeps streaming while you decide.

Ending the session with an ask outstanding cancels it, which is what the
protocol says a client must do.

## Configuring the agent

Session options (model, effort, mode), the skills you write as files, and the
agent's own slash commands have their own page:
[configuring an agent](./configuring-agents.md).

## When sign-in has lapsed

The most common failure, and the only one you can fix from where you are
standing. It appears in the transcript as the agent's own error with a line
added:

> The agent's sign-in has lapsed. Run its CLI in a terminal (e.g. `claude`),
> sign in, then start a new session here.

Essay cannot fix this for you — it hosts the agent, it does not hold its
credentials. Sign in with the agent's own CLI and start a new session.

Other failures show on the button you pressed rather than arriving later out
of nowhere: a missing binary reads `Claude Code is not installed: 'npx' is not
on PATH`, and a process that dies during startup reports the reason it gave.

## Provenance and history

Every accepted proposal records who proposed it, in which session, from which
tool call, and the instruction that produced it. Applying it goes through the
same hash-guarded write your own saves use, so a proposal composed against a
document that has since moved comes back as a conflict rather than
overwriting; the proposal stays pending, because you may still want it once
you have seen what arrived.

Accepted edits land in the document's history as an agent revision with the
agent's name on them. Edits the watcher caught are attributed to whichever
agent had a session open on that document at the time — circumstantial
attribution, named as such, and better than filing them under "unknown".

See [history](./history.md) for what that timeline holds.

## What Essay does not do

There is no Essay-specific patch protocol for agents, and none is planned.
Asked to tighten one section of a twenty-two section manuscript, a real agent
searched, read and made a targeted edit: one section changed, seven words in,
eight out. It already edits rather than regenerates. And no protocol could
enforce anything anyway — a process with access to your filesystem can ignore
whatever tools it is offered. What actually holds is the snapshot taken before
the change landed, and your reading the diff.
