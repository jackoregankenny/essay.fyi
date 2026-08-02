# Internals: agents and ACP

For contributors working on `essay-agents`. If an agent will not start, the
page you want is [launching an agent](./agent-launching.md).

Essay is the *client* in Agent Client Protocol terms: it launches an agent as
a subprocess and speaks JSON-RPC over its stdio. The reasoning for choosing
ACP over the alternatives is in
[how AI models interact with Essay](../how-agents-interact.md); this page is
how it is built.

## Shape

```text
AgentHost                      one per app, owns everything below
├── ChangeSetStore             the review queue (in memory)
├── PermissionBroker           open asks, keyed by request id
└── sessions: HashMap
    └── RunningSession
        ├── SessionSummary     ids, agent name, document
        ├── commands: mpsc     Prompt | Cancel | SetOption | Stop
        └── SessionContext     shared with the protocol handlers
```

One tokio task per session runs the connection; `command_loop` drives it. A
`HostObserver` (the Tauri shell) forwards three kinds of news to the WebView:
`essay://agent-event`, `essay://change-set`, `essay://permission-request`.

`start_session` resolves only once the agent has answered `initialize` **and**
`session/new`, so a failed start is an error on the button the author pressed
rather than an event arriving later out of nowhere. The handshake timeout is
120 seconds — generous because an agent behind `npx -y` fetches its adapter
from the registry on first run, and that is a download, not a handshake.

`start_session_over` takes an arbitrary transport. That exists so interception
can be tested against an in-process agent without a subprocess.

## Filesystem interception

Essay advertises `fs.read_text_file` and `fs.write_text_file`, and declines
`terminal` — an agent with a shell can write the manuscript behind the
protocol's back.

`fs/write_text_file` never writes. It becomes a pending `ChangeSet` carrying
the proposed content, a diff against the file *as it stands right now*, and
provenance.

**Two decisions worth not undoing:**

*Every* write becomes a proposal, whatever the path — not just the open
manuscript. Essay has no review surface for a file it is not showing, and a
write it cannot show is exactly the silent rewrite invariant 4 forbids.
Uniformity is also what keeps the rule explainable.

A proposal records `base_hash` from the file's current contents, never from
editor state. Accepting re-checks that hash through the same guarded write the
editor's save uses, so a proposal composed against a document that has since
moved returns `AcceptOutcome::Conflict` and the change set stays `Pending`.

### Why an intercepted write answers `Ok`

ACP has no "held for review" response. `WriteTextFileResponse` is an empty
object, and the only alternative is a JSON-RPC error, which agents surface as
a failed tool call and commonly retry. Reporting failure for a write Essay
fully intends to honour would be the less truthful of the two answers, and it
would produce exactly the write loop the queue exists to avoid.

The overlay is what keeps the story consistent afterwards:
`fs/read_text_file` serves the newest pending proposal for a path if there is
one. Without it, the agent reads back its own edit missing, concludes it was
reverted, and writes again.

A proposal byte-identical to the file returns `None` rather than queuing an
empty diff — an agent that rewrote a file back to itself has proposed nothing,
and an empty row teaches the author to ignore the queue.

## Session options

ACP advertises knobs two ways: session modes (`session/set_mode`) and config
options (`session/set_config_option`). `acp.rs` flattens both into one
`SessionOption` list — `kind: select | toggle`, a current value, and choices
with optional group headers — so the panel renders any agent's knobs without
knowing one by name.

`SessionContext` keeps `mode_state` and `configs` **separately**, because the
Claude Code adapter advertises the same mode a *second* time as a config
option. On read, the config copy shadows the mode-state one:

```rust
if let Some(mode) = self.mode_state.lock().unwrap().clone() {
    if !configs.iter().any(|config| config.id == MODE_OPTION_ID) {
        out.push(mode);
    }
}
```

The dedup is load-bearing, not cosmetic — without it the author sees the same
control twice and the two disagree. `set_current` writes to both stores for
the same reason.

Options cross to the frontend as **whole state, never a delta**, on an
`options` event, because agents change these on their own and the panel needs
one source of truth for both. `SetOption` is accepted mid-turn deliberately:
switching out of a plan mode while the agent works is the point of modes.

A config shape this version of the protocol does not know returns `None` from
`config_option` — dropping a knob beats refusing the session that carries it.

## The fs bypass, and the watcher fallback

**Advertising `fs` does not mean the agent uses it.** opencode 1.17.8
acknowledges the capability and then writes files with its own tools: zero
`fs/*` requests, zero permission requests, file changed on disk. Verified
twice, once by raw JSON-RPC probe (see §8 of
[the agent-integration research](../research/agent-integration.md)).

So agent edits arrive by **two** paths, and both are supported:

1. Intercepted `ChangeSet`s, from agents that honour the capability.
2. `DocumentWatcher` catching a direct write after the fact.

The watcher path is the one that actually enforces review, and it works for
agents that do not exist yet. `AgentHost::session_for(path)` lets the shell ask
"was an agent running against this document?" before calling an edit anonymous,
and `attribution()` gives it a `Provenance` to file the revision under.

Be precise about the claim: nothing is lost, and the author reviews before it
reaches the editor — but the file on disk really was rewritten. The frontend
labels the two differently (`proposal` versus `on disk`) and offers different
verbs, because telling an author their document is untouched when it is not is
the one lie this feature cannot afford.

Claude Code's adapter launches and handshakes verified — real session id,
options advertised. Whether it honours `fs` on writes is **still open**; the
live probe hit an expired OAuth session, and answering it needs `claude`
signed in again.

## What was dropped, and why

An `essay` MCP server with a `propose_patch` tool was recommended by the
research and is **not planned**. Asked to tighten one section of a 22-section
fixture, opencode used `search`/`read`/`edit` and changed 1/22 sections, +7/−8
words. It edits rather than regenerates, so the problem the tool was meant to
solve is not one real agents have — and it would not have enforced anything
either, since a process with filesystem access can ignore any tool you hand
it. Re-open this only if churn measurements say otherwise.

The same reasoning retires `essay propose` from
[agent-protocol.md](../agent-protocol.md), which predates the evidence.

## Launching

How an agent is resolved and started — the pinned adapter install, the two
Windows launch traps, and the probe for diagnosing a failure — is in
[launching an agent](./agent-launching.md).
