# Internals: launching an agent

For contributors debugging why an agent will not start, or changing how Essay
installs adapters. The protocol side is in
[agents and ACP](./agents-acp.md).

## The pinned adapter install

`npx -y <package>` asks the npm registry about the package on **every launch**.
The author pays those seconds each time, and an adapter sitting in the npm
cache still will not start on a train. `install.rs` installs a pinned version
once, under the app data directory, and hands the script to `node` thereafter
— measured 1.3s versus 2.7s to handshake.

`prepare_adapters(app_data_dir)` runs on a background thread from the shell's
setup and is never waited on. An agent launched while the install is still
running uses the launcher, which is what it would have done anyway. **The
install is an optimisation arriving in the background, never a gate in front
of the author pressing a button.**

Details that are decisions:

- **The marker is written last**, after npm exits happily *and* the entry
  point is where it should be. A torn install reads as no install rather than
  as half of one that launches and then fails.
- **The entry point is read from the installed `package.json`**, not
  hardcoded. A hardcoded path that stopped matching would not fail loudly — it
  would quietly fall back to `npx` forever, the hardest failure to notice.
- **Installs are keyed by version**, and old versions are pruned only *after*
  a new install succeeds. Bumping `CLAUDE_ADAPTER.version` therefore costs one
  launch on the launcher while the new version installs behind it.
- **No path goes in the argument list.** npm is told where to install by being
  run there, because on Windows the command goes through `cmd /c`, and a
  command interpreter re-parsing a quoted path — an account name with a space
  in it — is a class of bug worth simply not having.
- Its own `package.json` is written first, or npm walks upwards looking for a
  project to install into.

## Two Windows launch traps

Both live in `registry.rs`, and both were earned.

**PATHEXT candidates only, never the bare name.** Node ships an extensionless
`npx` — a POSIX sh script for Git Bash — beside `npx.cmd`. Resolving to it
hands `CreateProcess` a shell script: os error 193, "%1 is not a valid Win32
application", which the author saw as "Claude Code could not start". The bare
name is considered only when the caller already spelled an extension
(`which("claude.exe")`).

**A resolved `.cmd` or `.bat` goes through `cmd /c`.** It is not an executable.
`node.exe` needs neither trick, which is part of why running the adapter
directly is the better path.

`which()` is hand-rolled rather than a dependency: it is twenty lines, and the
crates that do this pull in a process-inspection stack Essay has no other use
for.

`is_available()` follows the same rule as the launch: a finished local install
stands in for the launcher, but nothing stands in for the agent the adapter
talks to. Greying out a row that would in fact start is a lie the picker
cannot afford, and so is the opposite.

## Diagnosing a launch

```bash
cargo run -p essay-agents --example probe_claude
```

Takes an optional agent id (default `claude-code`) and launches it exactly the
way the app does, against a throwaway document in a temp directory. It prints
how long `prepare_adapters` took, every known agent with its `available` flag
and command line, how long the handshake took, and then every event as JSON.

Three environment variables:

| Variable | Effect |
| --- | --- |
| `ESSAY_NO_LOCAL_ADAPTER=1` | Skip the pinned install and time the `npx -y` path instead. The two numbers side by side are the whole argument for the install. |
| `ESSAY_ADAPTER_ROOT` | Use this directory instead of the app data directory. |
| `ESSAY_ACP_LIVE_PROMPT=1` | Spend one real turn asking the agent to make exactly one edit, then print `VERDICT: proposal_intercepted=… file_changed_on_disk=…` — which is how the open question above gets answered. |

Failures worth recognising:

| Symptom | Cause |
| --- | --- |
| `is not installed: 'npx' is not on PATH` | Neither a local install nor the launcher resolved |
| `the agent exited during startup` | The subprocess died before answering; the connection task reports the real reason on the same channel |
| `did not finish starting up within 120s` | Usually a first-run `npx` fetch on a slow link |
| An authentication error in the transcript | The agent's sign-in lapsed. The fix is the author's terminal, not Essay. |
