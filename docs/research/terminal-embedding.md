# Embedding a real terminal panel in Essay (Tauri 2) — research report

> Multi-agent research, 2026-07-31. Informs the Milestone 4 integrated
> terminal (`essay-terminal`). Companion reports:
> `writing-surface-and-the-page.md`, and the agent-CLI integration report
> (pending).

## TL;DR recommendation

**`portable-pty` 0.9 (Rust) + `@xterm/xterm` 6.x + Tauri 2 Channels (binary payloads), one PTY per tab, reader on a dedicated OS thread with ~8–16 ms output coalescing.** This is the proven stack — every real open-source Tauri terminal found uses a variant of it, and it is the only stack that works on Windows 11 today. libghostty is genuinely interesting but its embeddable surface in mid-2026 is the VT layer only (`libghostty-vt`), it does **not** replace the PTY layer, and its native renderer cannot composite into a Tauri webview. The WezTerm battery complaints live in `wezterm-gui`'s renderer/event loop, not in `portable-pty` — that concern does not transfer. Keep xterm.js now; `coder/ghostty-web` (xterm.js-API-compatible, Ghostty VT parser in WASM) is the low-cost migration path if xterm.js fidelity ever becomes the bottleneck.

---

## 1. The PTY stack

### portable-pty (recommended)

- **Version 0.9.0** (Feb 11, 2025), MIT, lives inside the [WezTerm monorepo](https://github.com/wezterm/wezterm) (`pty/` directory), not a standalone repo. ~1.5M downloads/month, 626 dependent crates — this is the de-facto standard ([lib.rs](https://lib.rs/crates/portable-pty), [docs.rs](https://docs.rs/portable-pty)).
- **API shape**: `native_pty_system() -> Box<dyn PtySystem>` → `openpty(PtySize { rows, cols, pixel_width, pixel_height }) -> PtyPair { master, slave }`. Spawn via `CommandBuilder` (`cwd()`, `env()`, args), `slave.spawn_command(cmd) -> Box<dyn Child>`. I/O via `master.try_clone_reader()` / `master.take_writer()` (blocking `Read`/`Write`). Resize via `master.resize(PtySize)`. Runtime trait selection means the same code runs Unix `openpty` and Windows ConPTY.
- **Windows ConPTY quality**: uses ConPTY automatically (Windows 10 1809+; fine on Windows 11). Known gaps: upstream 0.9.0 **does not pass the modern ConPTY creation flags** — `PSEUDOCONSOLE_RESIZE_QUIRK` (0x2, fixes resize repaint artifacts), `PSEUDOCONSOLE_WIN32_INPUT_MODE` (0x4, better key handling), `PSEUDOCONSOLE_PASSTHROUGH_MODE` (0x8, Win11 22H2+ relays child VT sequences directly). A patched fork, [`portable-pty-psmux`](https://lib.rs/crates/portable-pty-psmux), exists precisely to add these, detecting build ≥ 22621 before enabling passthrough. Practical consequences: occasional resize artifacts (TUIs repaint on resize anyway, so mostly cosmetic) and ConPTY's inherent behaviors — output is re-encoded by ConPTY's own VT renderer, and **EOF on the reader only arrives after the child exits and handles are dropped**, so exit detection should come from `child.wait()`/`try_wait()`, not read-EOF.
- **Lifecycle gotchas** (consistent across every implementation found): drop the **slave** half immediately after spawn (or reads never EOF); read on a **plain `std::thread`**, never `tokio::spawn` (blocking reads starve/deadlock the async runtime); on kill, call `child.kill()` explicitly (on Windows dropping the master alone doesn't reliably reap the tree), then drop the writer so the reader thread unblocks.

### Alternatives

| Crate | Verdict |
|---|---|
| [`alacritty_terminal`](https://crates.io/crates/alacritty_terminal) | Full terminal *emulation* (VTE parser + grid + its own cross-platform `tty` module incl. ConPTY). Use it if you want the screen model in Rust (Zed does; the Tauri app **maiterm** pairs it with xterm.js as a dumb renderer). Overkill for Essay: with xterm.js in the webview you'd have two emulators. |
| [`pty-process`](https://crates.io/crates/pty-process) | Nice async API, but Unix-focused — not the right base for a Windows-11 dev machine. |
| [`conpty`](https://crates.io/crates/conpty) / [`winpty-rs`](https://crates.io/crates/winpty-rs) | Windows-only / legacy pre-ConPTY. No reason to use when portable-pty abstracts both. |
| [`libghostty-vt`](https://crates.io/crates/libghostty-vt) (Rust bindings 0.2.1, Jul 18 2026) | **Not a PTY layer at all** — VT parser/state only. See §5. |

Nothing newer (2025–2026) displaces portable-pty for the spawn/pipe layer.

## 2. Frontend: xterm.js

- **Current: `@xterm/xterm` 6.0.0** (the `@xterm/*` scope replaced the deprecated `xterm`/`xterm-addon-*` names in 5.4.0). **MIT license** across core and addons. v6 removed the canvas renderer — choose DOM or **WebGL**.
- **Addons needed**: `@xterm/addon-fit` (size-to-container), `@xterm/addon-webgl` (0.19.0 stable — "3x faster than canvas" for high-throughput output), `@xterm/addon-unicode11` (correct emoji/CJK widths — Ink/ratatui box borders break without it), optionally `@xterm/addon-web-links` and `@xterm/addon-search`.
- **Kitty keyboard protocol landed**: [PR #5600](https://github.com/xtermjs/xterm.js/pull/5600) merged Jan 10, 2026, targeting **6.1.0** (currently in `@beta`). This matters directly for Claude Code — Shift+Enter-for-newline in 6.0.0 sends plain `\r`; either use 6.1.0-beta, or intercept Shift+Enter in `attachCustomKeyEventHandler` and write `\x1b\r` yourself.
- **Better-maintained alternative?** No — xterm.js is what VS Code ships. The one credible *newer* option is **[`coder/ghostty-web`](https://github.com/coder/ghostty-web)** (Coder, MIT): Ghostty's WASM-compiled VT parser (~400 KB) behind an **xterm.js-compatible API** ("change the import"). Young, addon story unclear — treat as a drop-in upgrade path, not the v1 choice.

## 3. The plumbing: PTY → webview transport in Tauri 2

**Reality of Tauri IPC**: commands/events serialize through a JSON-RPC-like layer; a community benchmark measured **~5 ms for 10 MB on macOS but ~200 ms on Windows/WebView2** ([discussion #11915](https://github.com/tauri-apps/tauri/discussions/11915)). Events additionally "directly evaluate JavaScript" and aren't meant for bulk data.

**What Tauri added for exactly this**: **Channels** — "designed to be fast and deliver ordered data", explicitly recommended for "child process output" ([Calling the Frontend docs](https://v2.tauri.app/develop/calling-frontend/)). Rust: `#[tauri::command] fn spawn(..., on_data: Channel<...>)` + `on_data.send(...)`; JS: `const ch = new Channel(); ch.onmessage = ...; invoke('spawn_pty', { ..., onData: ch })`. Channels support raw binary payloads, avoiding base64.

**What real projects chose** (all verified on GitHub):

| Project | Stack | Transport |
|---|---|---|
| [marc2332/tauri-terminal](https://github.com/marc2332/tauri-terminal) (canonical minimal example) | xterm.js + portable-pty | simple invoke/event bridge — a reading primer, not production |
| [Tnze/tauri-plugin-pty](https://github.com/Tnze/tauri-plugin-pty) + npm `tauri-pty` | Tauri 2 plugin, node-pty-like JS API | events; early-stage — read it, don't depend on it |
| [terax-ai](https://github.com/emee-dev/terax-ai-tauri-terminal) (Tauri 2 + React 19 + xterm.js WebGL — closest analog to Essay) | portable-pty backend | IPC-conscious design, per-session events |
| [claude-code-gui](https://github.com/5Gears0Chill/claude-code-gui) | Tauri 2 + xterm.js, runs **Claude Code sessions in-app** — proof the exact goal works | events |
| [maiterm](https://github.com/Flexmark-Intl/maiterm) (Svelte 5) | **alacritty_terminal** parser in Rust + xterm.js as thin renderer + portable-pty | the "Rust-side emulator" variant |
| [terminon](https://github.com/Shabari-K-S/terminon) | portable-pty + xterm.js WebGL, WSL/SSH profiles | events |
| [yofabr/tauri-pty](https://github.com/yofabr/tauri-pty) (curated best practices for exactly this task) | portable-pty 0.9 + Tauri 2 + React | **events for normal use, Channels above ~1 MB/s**; OS-thread reads; 16 ms write batching; scrollback cap ~5000 |

**Concrete plumbing rules** distilled from the above:

1. Per session: reader thread does `read()` into a 4–16 KB buffer, appends to a pending buffer, flushes to the channel on a ~8–16 ms tick or size threshold — bounds IPC message rate during `cargo build`-style floods without perceptible latency.
2. Send **bytes, not lossy strings**: `term.write(new Uint8Array(chunk))` — xterm.js's streaming UTF-8 decoder correctly handles multi-byte sequences split across chunks; per-chunk `String::from_utf8_lossy` in Rust corrupts them.
3. Keystrokes go frontend→Rust via a plain `invoke("write_pty", …)` (tiny payloads; invoke round-trips are sub-ms).
4. A local WebSocket server is the escape hatch (what web IDEs do), but no surveyed Tauri project needed it; Channels close the gap without opening a port.

## 4. TUI compatibility (Claude Code, opencode, Codex CLI, Gemini CLI)

What the emulator must provide — xterm.js 6 covers all of it:

- **Alt-screen** (DECSET 1049), **truecolor** (set `COLORTERM=truecolor`; opencode's themes explicitly degrade without it), **256-color `TERM`** (`xterm-256color`), **SGR mouse** (1006), **bracketed paste** (2004), cursor-shape OSCs.
- **Correct env at spawn**: `TERM=xterm-256color`, `COLORTERM=truecolor`, `LANG`/`LC_ALL=en_US.UTF-8`, inherit the user's env, `cwd` = the Essay workspace root (so the agent CLI sees the manuscript folder).
- **Resize**: `fitAddon.fit()` on container resize (inside `requestAnimationFrame`, after `document.fonts.ready` — Geist must be loaded before `term.open()` or cols/rows are miscomputed) → `invoke("resize_pty", cols, rows)` → `master.resize()`.
- **Kitty keyboard protocol**: increasingly probed by these CLIs (Shift+Enter in Claude Code). xterm.js 6.1.0 has it; until then map Shift+Enter manually.
- **Windows shells in 2026**: **Claude Code runs natively on Windows; Git Bash is optional.** The native installer needs no Node; release 2.1.139 (May 2026) shipped a native PowerShell tool, making pwsh the default shell path. Spawn `pwsh.exe` (fall back to `powershell.exe`) under ConPTY and run `claude` inside it — exactly what Windows Terminal does. opencode, Codex CLI and Gemini CLI all run in ConPTY-hosted terminals on Windows in 2026.
- Don't unmount inactive tab components (destroys xterm state) — hide with `display:none`, keep the PTY alive.

## 5. libghostty evaluation

### 5.1 State in mid-2026

- **What it is**: the plan to make Ghostty's core an embeddable, C-ABI library ([Libghostty Is Coming](https://mitchellh.com/writing/libghostty-is-coming), Sep 2025). Rollout is modular: **`libghostty-vt` first** (zero-dependency VT parser + terminal state: SIMD parsing >100 MB/s, scrollback, reflow, input encoding), with GPU rendering (host passes an OpenGL or Metal surface) and framework bindings *later*.
- **Embeddable today**: `libghostty-vt` via Zig and C APIs — docs state plainly: **"This library is currently in development and the API is not yet stable."** No tagged stable release. Community Rust bindings: crates.io `libghostty-vt` 0.2.1 (Jul 2026), MIT OR Apache-2.0. WASM builds exist.
- **Windows — loudly**: **upstream Ghostty still has no official Windows release, and Windows is explicitly not among libghostty's initial platform targets.** The Windows activity is community forks (winghostty, ghostty-windows) — daily-usable *apps*, not an upstream embeddable Windows library. **Any plan depending on libghostty's rendering layer is dead on arrival for Essay's Windows 11 dev machine.** The one Windows-viable Ghostty piece today is `libghostty-vt` (zero-dependency, compiles anywhere Zig targets, including WASM).

### 5.2 Layer clarity: the battery question aims at the wrong layer

- `portable-pty` is **only** the spawn/pipe layer extracted from the WezTerm project. It has **no event loop, no renderer, no timers** — nothing that can drain a battery beyond the reads you do.
- WezTerm's efficiency complaints are all in **`wezterm-gui`** — the wgpu/OpenGL front end and its redraw loop ([#2027](https://github.com/wezterm/wezterm/issues/2027) 2× Alacritty CPU, [#3917](https://github.com/wezterm/wezterm/issues/3917), [#7271](https://github.com/wezterm/wezterm/issues/7271)). None of that code is in the `portable-pty` crate. **Using portable-pty inherits zero WezTerm rendering baggage.**
- **libghostty-vt and portable-pty are complementary, not alternatives**: VT state machine vs process plumbing. The thing `libghostty-vt` would replace in Essay's stack is **the parser inside xterm.js**, not portable-pty.

### 5.3 Rendering in a Tauri webview app

- libghostty's native rendering (when it ships) needs a native GL/Metal surface — you **cannot composite that into the webview DOM**; the only route is a child-window overlay with bounds-syncing, z-order/focus/IME fights, and no CSS theming (and on Windows, no upstream surface at all).
- xterm.js WebGL renders damage-driven inside a compositor the app already pays for; it's what VS Code ships, idles at ~zero. For agent-CLI workloads the delta vs native is noise.
- The webview-native middle path is `coder/ghostty-web` — Ghostty's VT machine in WASM behind the xterm.js API.

### 5.4 Verdict

libghostty is the right bet *directionally* and the wrong dependency *today*: unstable API, no tagged release, rendering unshipped, no upstream Windows story. **Plan A: portable-pty + xterm.js. Plan B (Windows-safe migration): same backend, swap frontend to ghostty-web / libghostty-vt once stable** — writing against the xterm.js API keeps that door open at the cost of an import change.

## 6. Recommended `essay-terminal` architecture

**Rust (`crates/essay-terminal` + commands in the desktop shell)**

- Deps: `portable-pty = "0.9"` (adopt `portable-pty-psmux`'s ConPTY flags only if resize artifacts prove annoying on Win11), `uuid`, existing `serde`/`tauri`.
- `TerminalManager` in Tauri managed state: `Mutex<HashMap<Uuid, Session>>`; `Session { writer, master, child }`.
- Commands: `spawn_terminal(id, shell?, cwd, cols, rows, on_data: Channel)`, `write_terminal(id, data)`, `resize_terminal(id, cols, rows)`, `kill_terminal(id)`. Spawn drops the slave immediately, sets `TERM`/`COLORTERM`/UTF-8 locale, `cwd` = active workspace root; reader on `std::thread` with ~8 ms coalescing → Channel as raw bytes; `child.wait()` on the same thread emits a final exit message. Kill: `child.kill()` → remove session. Shell default: `pwsh.exe` → `powershell.exe` on Windows, `$SHELL` elsewhere; per-tab override so a tab can spawn directly as `claude` / `opencode` / `codex` / `gemini`.

**Frontend**

- `@xterm/xterm@^6` (6.1 when stable for kitty keyboard), `addon-fit`, `addon-webgl`, `addon-unicode11`, optional `web-links`/`search`. One `Terminal` per tab, themed from `--essay-*` tokens, Geist Mono, `scrollback: 5000`; `term.onData → invoke write`; `ResizeObserver → fit() → invoke resize`; channel `onmessage → term.write(Uint8Array)`; hide inactive tabs with `display:none`; `document.fonts.ready` before `open()`; Shift+Enter shim until 6.1; WebGL with DOM fallback. Toggle via palette / Ctrl+` alongside Ctrl+J.

**Effort**: v1 (single tab, spawn/write/resize/kill, themed, Claude Code runs) ≈ **2–3 days**; tabs + lifecycle polish ≈ +1–2 days; Windows ConPTY hardening ≈ +1–2 days. **~1 week total**, with `claude-code-gui`, `terax-ai`, and the `yofabr/tauri-pty` skill as working reference code.
