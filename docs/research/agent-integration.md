# Programmatic integration surfaces of coding-agent CLIs — research for Essay

> Multi-agent research, 2026-07-31. Scope: Claude Code, opencode (SST),
> OpenAI Codex CLI, Gemini CLI, from official docs/repos. Informs
> Milestone 4 (`essay-agents`). Companion reports:
> `writing-surface-and-the-page.md`, `terminal-embedding.md`.

Headline finding up front: **all four agents now speak the Agent Client
Protocol (ACP)** — Zed's JSON-RPC-over-stdio standard for embedding agents
in editors — and ACP's design (client-proxied file writes + explicit
permission requests) maps almost exactly onto Essay's "AI proposes; the
author decides" invariant. This reshapes the build order at the end.

---

## 1. Claude Code

### 1.1 Headless / non-interactive

Docs: [Headless mode](https://code.claude.com/docs/en/headless), [CLI reference](https://code.claude.com/docs/en/cli-reference).

- `claude -p "prompt"` (`--print`) — non-interactive; reads stdin (piped input capped at 10 MB), all CLI options apply.
- `--bare` — skips auto-discovery of hooks, plugins, MCP servers, CLAUDE.md; recommended for scripted/SDK calls. Context is then injected explicitly: `--settings <file-or-json>`, `--mcp-config <file-or-json>`, `--agents <json>`, `--append-system-prompt(-file)`, `--system-prompt(-file)`.
- Output: `--output-format text|json|stream-json`. `json` includes `result`, `session_id`, `total_cost_usd`, per-model cost. `--json-schema '<schema>'` yields validated `structured_output`. `stream-json` (+ `--verbose --include-partial-messages`) emits NDJSON events: `system/init` (model, tools, `mcp_servers` with status, `capabilities` feature-detect array), `assistant`/`user` messages, `stream_event` text deltas, `system/api_retry`, final `result`. Subagent messages carry `parent_tool_use_id`; `--forward-subagent-text` reconstructs nested transcripts.
- Input: `--input-format stream-json` — drive multi-turn conversations over stdin (the mechanism the ACP adapter and other embedders use).
- Sessions: `--continue`; `--resume <session_id>` (scoped to cwd + worktrees); `--session-id <uuid>`; `--fork-session`; `--no-session-persistence`. Background agents: `claude --bg`, `claude agents --json`, `claude attach/logs/stop <id>`.
- Permissions: `--permission-mode default|acceptEdits|plan|auto|dontAsk|bypassPermissions|manual`; `--allowedTools "Bash(git diff *),Edit"` / `--disallowedTools`; `--tools` to restrict the toolset. **`--permission-prompt-tool mcp__server__tool`** — delegates permission prompts in `-p` mode to an MCP tool, i.e. Essay could host the approval UI for a headless Claude run. Guards: `--max-turns`, `--max-budget-usd`.

### 1.2 SDK

[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview): TypeScript `@anthropic-ai/claude-agent-sdk` and Python `claude-agent-sdk` only. Full agent loop in-process: `query()` streaming, `canUseTool` permission callbacks, hooks, subagents, sessions/fork, in-process MCP servers via `createSdkMcpServer`/`tool()`. **No Rust bindings** — the documented path for other languages is spawning the CLI with `-p --output-format json|stream-json`, which suits Essay's Rust core. (Note: third parties may not offer claude.ai login through SDK products; API-key auth only.)

### 1.3 MCP client

[MCP docs](https://code.claude.com/docs/en/mcp). Transports: stdio, SSE, streamable HTTP. Config: `claude mcp add`, project `.mcp.json`, or per-invocation `--mcp-config file.json` + `--strict-mcp-config`. Tool names: `mcp__<server>__<tool>`; auto-approve via `allowedTools: ["mcp__essay__*"]`.

### 1.4 Hooks (provenance capture)

[Hooks](https://code.claude.com/docs/en/hooks) — the richest of the four. Events include `PreToolUse` (can allow/deny/ask, can rewrite `updatedInput`), `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Stop`, `SessionStart/End`, `SubagentStart/Stop`, `FileChanged`, plus **handler types `command`, `http` (POST to a localhost endpoint — ideal for Tauri), `mcp_tool`, `prompt`**. Hook stdin JSON carries `session_id`, `transcript_path`, `cwd`, `tool_name`, `tool_input` (for `Edit`/`Write`: file path, old/new strings), `tool_use_id`. Essay can inject hooks per-run via `--settings '<json>'` without touching the user's config: a `PostToolUse` matcher on `Edit|Write` with an HTTP hook gives exact, attributable provenance for every file mutation; a `PreToolUse` hook can deny direct edits to the open manuscript and steer the model to `mcp__essay__propose_patch`.

---

## 2. opencode (SST)

### 2.1 Headless

[CLI docs](https://opencode.ai/docs/cli/): `opencode run "msg"` with `-m provider/model`, `-c/--continue`, `-s/--session <id>`, `--fork`, `--format default|json`, `--auto` (auto-approve anything not explicitly denied), `--agent`, `--attach http://localhost:4096` (drive a running server), `-f/--file` attachments. `OPENCODE_PERMISSION='<json>'` env for inline permission config. `opencode export/import` for session transcripts.

### 2.2 Server API + SDK (the standout surface)

[Server docs](https://opencode.ai/docs/server/): `opencode serve --port 4096 --hostname 127.0.0.1` runs a headless HTTP server publishing an **OpenAPI 3.1 spec at `/doc`**. Key endpoints: `POST /session`, `POST /session/:id/message` (sync) and `/prompt_async`, `GET /global/event` (SSE stream of every event), **`GET /session/:id/diff` (file changes for the session — a ready-made change set)**, `POST /session/:id/permissions/:permissionID` (reply to a permission ask — Essay's approval UI can answer it), `GET /file/content`, `/find`, `PATCH /config`. Basic auth via `OPENCODE_SERVER_PASSWORD`. The TUI itself is just a client of this server. [SDK](https://opencode.ai/docs/sdk/): `@opencode-ai/sdk` (TS only); from Rust, hit the HTTP API directly (OpenAPI → generated client).

- [Permissions](https://opencode.ai/docs/permissions/): `permission: { edit: "ask", bash: {"git *": "allow"} }` with glob patterns — `edit: "ask"` + the permissions endpoint = a native propose/approve loop over HTTP.
- [Plugins](https://opencode.ai/docs/plugins/): JS/TS hooks incl. `file.edited`, `permission.asked/replied`, `tool.execute.before/after`, `session.diff` — a second provenance channel.

### 2.3 MCP client

[MCP docs](https://opencode.ai/docs/mcp-servers/): `opencode.json` → `"mcp": { "essay": { "type": "local", "command": [...] } }` or `"type": "remote", "url": "..."`, OAuth with dynamic client registration, per-agent tool enablement.

### 2.4 ACP

[ACP docs](https://opencode.ai/docs/acp/): **native** — `opencode acp` runs it as an ACP subprocess (used by Zed, JetBrains, avante.nvim, CodeCompanion.nvim).

---

## 3. OpenAI Codex CLI

### 3.1 Headless

`codex exec "prompt"` (alias `codex e`):

- `--json` — NDJSON event stream: `thread.started`, `turn.started/completed/failed`, `item.started/updated/completed` with item types `assistant_message`, `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`, `web_search`. Default mode streams activity to stderr, final message to stdout.
- `-o/--output-last-message <path>`; `--output-schema <schema.json>` for schema-conforming final JSON.
- Resume: `codex exec resume <SESSION_ID>` or `resume --last` (sessions in `~/.codex/sessions`).
- Sandbox/approvals: `--sandbox read-only|workspace-write|danger-full-access` (default read-only headless), `-a/--ask-for-approval untrusted|on-request|never`, `--full-auto` (≈ `--sandbox workspace-write`), `-C/--cd`, `--skip-git-repo-check`, `-c key=value` TOML overrides.

### 3.2 SDK + app-server

- [Codex SDK](https://github.com/openai/codex/blob/main/sdk/typescript/README.md): TS `@openai/codex-sdk` (spawns the bundled binary; `startThread()`, `thread.run()` / `runStreamed()`, `resumeThread(id)`, `outputSchema`) and Python `openai-codex`. No Rust SDK — but Codex is itself Rust; its crates are in-repo.
- **`codex app-server`** ([README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)): the JSON-RPC 2.0 bidirectional protocol behind the official VS Code extension — thread/turn/item primitives (`thread/start`, `turn/start`, `turn/steer`, `turn/interrupt`, streaming `item/*` notifications, approval requests flowing server→client), stdio (JSONL) transport; `codex app-server generate-ts | generate-json-schema` emits typed schemas. Codex's equivalent of "embed me in your app."

### 3.3 MCP

- Client: `config.toml` `[mcp_servers.<name>]` with `command`/`args`/`env` or a streamable HTTP `url`; `codex mcp add|list|remove|login|logout`.
- Server: **`codex mcp-server`** runs Codex itself as an MCP server over stdio.
- Hooks: "Lifecycle hooks" newly mentioned in config, thinly documented — for provenance prefer the `--json` `file_change` items or app-server events.

### 3.4 ACP

Via Zed's open-source Rust adapter [zed-industries/codex-acp](https://github.com/zed-industries/codex-acp) — usable outside Zed.

---

## 4. Gemini CLI

### 4.1 Headless

[Headless reference](https://geminicli.com/docs/cli/headless/): `gemini -p "prompt"` (or non-TTY stdin). `--output-format text|json|stream-json`; `stream-json` emits NDJSON events `init`, `message`, `tool_use`, `tool_result`, `error`, `result`. Exit codes: 0 / 1 / 42 (input error) / 53 (turn limit). Approvals: `-y/--yolo`, `--approval-mode default|auto_edit|yolo`, `--allowed-tools`. Headless **session resume is not documented** — scripted multi-turn is the weakest of the four.

### 4.2 MCP client

[MCP docs](https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html): `settings.json` `mcpServers` — stdio (`command`/`args`/`env`/`cwd`), SSE (`url`), streamable HTTP (`httpUrl` + `headers`); `trust` to bypass confirmations, `includeTools`/`excludeTools`; `gemini mcp add`. Schema quirk: Gemini strips `$schema`/`additionalProperties` from tool schemas — keep the essay server's input schemas plain.

### 4.3 Hooks / SDK

No Claude-style hook system, no supported embedding SDK. The native embedding surface is ACP: **`gemini --experimental-acp`** — Gemini CLI was ACP's launch reference implementation.

---

## 5. MCP assessment: would an "essay MCP server" work everywhere?

**Yes.** All four are MCP clients supporting stdio and HTTP-family transports:

| Agent | Config | stdio | HTTP |
|---|---|---|---|
| Claude Code | `.mcp.json` / `claude mcp add` / `--mcp-config` | yes | SSE + streamable HTTP |
| opencode | `opencode.json` `"mcp"` | yes (`type: local`) | yes (`type: remote`) |
| Codex | `config.toml` `[mcp_servers.*]` / `codex mcp add` | yes | streamable HTTP |
| Gemini | `settings.json` `mcpServers` / `gemini mcp add` | yes | SSE + `httpUrl` |

Practical shape for Essay: an `essay mcp` subcommand (stdio) that bridges to the running app over a local socket — stdio is the lowest-common-denominator all four handle identically, and the bridge means tools operate on live app state (open document, DocumentIndex, changeset store).

**Prior art of apps integrating agents this way:** Zed's agent panel ([ACP](https://zed.dev/acp), Apache-licensed, Google as launch partner); JetBrains IDEs, VS Code, Neovim (avante/CodeCompanion), Emacs, **Obsidian**, and marimo all ship ACP clients — Obsidian and marimo prove the pattern for non-IDE document apps; Xcode 26.3's agentic coding with Claude Agent and Codex; Zed's ACP registry lists 50+ agents. The [`agent-client-protocol`](https://crates.io/crates/agent-client-protocol) **Rust crate** (+ tokio variant, schema crate) implements both sides — Zed's own client is built on it, so Tauri/Rust Essay gets a first-party-quality library.

**Why ACP matters specifically for Essay's invariant:** when the client advertises the `fs` capability, agents route reads/writes through `fs/read_text_file` / `fs/write_text_file` — Essay can *hold the write as a pending change set instead of applying it*; `session/request_permission` (allow once/always/reject) routes approvals into Essay's UI; `tool_call` updates carry diffs and file locations for rendering. Agents available over ACP today: Claude via `@agentclientprotocol/claude-agent-acp`, Codex via `codex-acp` (Rust), Gemini natively (`--experimental-acp`), opencode natively (`opencode acp`).

---

## 6. File-watch fallback: how the agents write files

Verified against source where possible:

- **Gemini CLI**: `write-file.ts` → in-place `fs.writeFile`. No temp-file rename.
- **opencode**: `tool/write.ts` → in-place write.
- **Codex**: `apply_patch` via a sandboxed fs abstraction; standard create/write calls, no atomic-rename pattern visible.
- **Claude Code**: closed source; Edit/Write behave as in-place writes in practice (inode-stable).

Consequences for the `notify`-based watcher: expect **Modify events on a stable inode/path**, not vim-style Remove+Create pairs — the easy case. But (a) agents also mutate files through arbitrary shell (`sed`, `git checkout`, formatters), and multi-hunk writes arrive in bursts, so debounce ~100–200 ms and diff **by content hash against the last-accepted snapshot** in `.essay/`, never by event counting; (b) on Windows use the `ReadDirectoryChangesW` backend with `PollWatcher` fallback; (c) treat every external change as an unattributed pending revision — the file-watch path gives the diff but not the provenance, which is exactly why the richer channels exist.

---

## 7. Recommendation: ranked integration paths and what to build first

Ranking by fit to "reviewable change sets with provenance, never silent rewrites":

1. **File-watch capture (build first, keep forever).** Universal, agent-agnostic, catches edits from *any* tool including a plain terminal. Snapshot-on-accept in `.essay/`, hash-debounced diff, present via the planned @pierre/diffs surface. This alone turns "agent edited my file" into "Essay shows me a diff to accept" — invariant satisfied at baseline, zero per-agent work.
2. **`essay` MCP server (build second — it's the product's protocol).** Small tool set: `read_outline`, `read_section` (DocumentIndex-backed, so agents patch sections not raw byte ranges), `list_marks` (==come back to this== as agent worklist), `propose_patch(file, patch, rationale)` → change-set id in Essay's review queue, `render_preview`. Works identically across all four agents *and* in the embedded-terminal case; `propose_patch` gives provenance and proposal semantics even when the agent runs outside Essay entirely.
3. **ACP client host (the native embedding, Milestone 4+).** One protocol, four agents, first-party-quality Rust crate; fs-proxying + `session/request_permission` make proposal/approval the *default* channel rather than something to enforce. Ship the panel by spawning per-agent adapters: `@agentclientprotocol/claude-agent-acp`, `codex-acp`, `gemini --experimental-acp`, `opencode acp`.
4. **Headless spawn with stream-json.** Best for one-shot palette commands ("tighten section 3") and CI-ish tasks; Claude's is the most mature (`-p --bare --output-format stream-json --input-format stream-json`, `--permission-prompt-tool` pointing at an essay MCP tool, hooks injected via `--settings`).
5. **Embedded terminal.** Keep as escape hatch and for agent *presence* — it's what the file-watcher and MCP server rescue; it contributes no provenance by itself.

**For the Milestone 4 "Claude Code workflow demonstration"** the concrete cut: file-watcher + essay MCP server + spawn `claude` headless. Essay writes a temp `--mcp-config` registering `essay mcp`, injects `--settings` containing a `PostToolUse` HTTP hook (localhost Tauri endpoint) for edit provenance and a `PreToolUse` deny on `Edit`/`Write` for the open manuscript so Claude is steered to `mcp__essay__propose_patch`, streams `stream-json` into a session pane, resumes with `--resume $session_id`. A genuinely differentiated demo (agent edits arrive as Pierre-styled review cards, not terminal noise) on ~three crates' worth of work.

**`essay-agents` crate sketch:**

```text
crates/essay-agents/
  session.rs    // trait AgentSession { spawn, send(turn), events() -> Stream<AgentEvent>, resume(id), stop }
  claude.rs     // headless adapter: spawn claude -p --bare --output-format stream-json
                //   --input-format stream-json --mcp-config <tmp> --settings <hooks-json>
  acp.rs        // AcpHost on agent-client-protocol{,-tokio}: initialize -> session/new
                //   (advertise fs + terminal caps, pass essay MCP server in mcpServers)
                //   fs/write_text_file handler => ChangeSet::propose, request_permission => UI
  codex.rs / gemini.rs / opencode.rs  // exec --json / stream-json / HTTP-serve adapters (later)
  changeset.rs  // ChangeSet { id, file, base_hash, patch: UnifiedDiff, provenance, status }
                // Provenance { agent, session_id, tool_use_id?, prompt_excerpt, timestamp }
  watcher.rs    // notify-based fallback: snapshot in .essay/, hash-debounce, unattributed ChangeSets
  mcp.rs        // `essay mcp` stdio bridge (rmcp) -> local socket -> app: read_outline,
                //   read_section, list_marks, propose_patch, render_preview
```

All change sets operate on the Markdown file against a recorded `base_hash` (Rust-side canonical, per invariant 3); `.essay/` state (snapshots, pending changesets) stays deletable.

---

## 8. Addendum: what building it actually found (2026-07-31)

Section 7's ranking survives; two of its details did not. Verified against the
installed binaries while implementing `essay-agents`, not from documentation.

### 8.1 The `agent-client-protocol` crate is not the API §7 sketches

The sketch imagines implementing a `Client` trait with `write_text_file` /
`request_permission` methods. Version **2.0** is a builder over a JSON-RPC
connection instead:

```rust
Client.builder()
    .on_receive_request(async |req: WriteTextFileRequest, responder, cx| { … },
                        agent_client_protocol::on_receive_request!())
    .on_receive_notification(async |n: SessionNotification, cx| { … },
                             agent_client_protocol::on_receive_notification!())
    .connect_with(AcpAgent::new(config), async |cx| { /* handshake, prompts */ })
    .await
```

Details worth knowing before touching it: the `on_receive_*!()` macros are
mandatory (a workaround for unstable return-type notation); handlers run *on
the dispatch loop* and block message processing, so anything that waits — a
permission ask, a request back to the peer — must go through `cx.spawn`; and
the connection lives only as long as the `connect_with` closure, which is why
Essay drives sessions from a command channel inside it. `AcpAgentConfig` covers
subprocess launch but resolves nothing: on Windows `npx` is `npx.cmd`, which
`CreateProcess` will not find and cannot execute — the host resolves PATH and
PATHEXT itself and re-launches scripts through `cmd /c`.

### 8.2 Advertising `fs` does not mean the agent will use it

§5's claim — "when the client advertises the `fs` capability, agents route
reads/writes through `fs/read_text_file` / `fs/write_text_file`" — is what the
protocol says, not what every agent does.

**opencode 1.17.8 ignores it.** With `fs.readTextFile` and `fs.writeTextFile`
both advertised in `initialize`, opencode completes the handshake, then reads
and writes the file with its own tools. It reports `tool_call` notifications
(`kind: "read"`, `kind: "edit"`, with `locations`) so the client can *watch* —
but it never sends an `fs/*` request, so there is nothing to hold. The edit is
on disk before the client hears about it.

**Claude Code's adapter is unverified on this point.** `npx -y
@agentclientprotocol/claude-agent-acp` completes `initialize` and `session/new`
cleanly, but the prompt turn failed with `authentication_failed` (expired
OAuth) on the test machine, so whether it proxies its writes is still an open
question. Worth re-testing: it is the agent §7 picks for the Milestone 4 demo.

This does not change the ranking — it vindicates it. §7 ranks file-watch
capture first *because* it is the one channel no agent can opt out of, and this
is exactly the case it was ranked first for. What it changes is the framing:
ACP interception is the good path, not the only one, and the review surface has
to be honest about which channel an edit arrived on. Essay's host therefore
does both — it holds `fs/write_text_file` as a change set, and when an edit
arrives on disk instead it asks the host who was running and attributes the
revision to that agent rather than to `Unknown`.

### 8.3 Returning success for a write that did not happen

The protocol offers no "held for review" response: `WriteTextFileResponse` is
an empty object, and the only other answer is a JSON-RPC error, which agents
surface as a failed tool call and retry. So Essay answers `Ok`. The cost is
that the agent's model of the file is then wrong, which it discovers on its
next read — so reads of a path with a pending proposal serve the *proposal*,
not the file. The author's file stays the author's; the agent's story stays
consistent; neither is misled about the thing they care about.
