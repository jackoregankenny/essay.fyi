# Essay — agent instructions

**The instructions are in [CLAUDE.md](./CLAUDE.md). Read that file. It applies
to you whatever you are called.**

This file used to be a second copy of it, and the copy is why this one is now a
pointer.

Two things went wrong with having both, and neither is hypothetical.

It **drifted**. By the time anyone checked, this file was 56 lines behind and
still described a release pipeline that had been replaced — three jobs with the
matrix deliberately serial, an `announce` job, `includeUpdaterJson: true`. An
agent reading it would have reasoned confidently about a workflow that no longer
exists. A stale instruction file is worse than none, because it gets believed.

And the copy was not verbatim: "Claude Code" had been search-replaced to
"Codex" throughout, which turned facts about this codebase into fiction. It
claimed the ACP adapter package was `@agentclientprotocol/Codex-agent-acp`,
which does not exist — `crates/essay-agents/src/install.rs` pins
`@agentclientprotocol/claude-agent-acp`. It said to check whether `Codex` was
signed in, where the CLI is `claude`. Those sentences describe which adapters
Essay supports. They are the same sentences no matter who is reading them, and
rewriting them to match the reader made the document lie about the code.

So: one file, and this points at it. If you are an agent that only loads
`AGENTS.md`, load `CLAUDE.md` now — everything about this repository's
invariants, architecture and current state is there.
