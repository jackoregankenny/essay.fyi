# Where Essay stores things

For anyone who wants to know what Essay writes outside their manuscript, and
what deleting each piece costs.

Essay has no account and no server. Everything it keeps is on this machine, in
four places.

## Beside the document: `.essay/`

Created in the document's own folder the first time Essay records history for
it. One sidecar per folder, shared by the Markdown files in it.

```text
drafts/
├── draft.md
├── notes.md
└── .essay/
    ├── .gitignore
    ├── history.sqlite
    └── skills/            only if you create it
        └── spelling.md
```

| Path | Holds | Deleting it costs |
| --- | --- | --- |
| `.essay/history.sqlite` | Every revision of every document in this folder, and the full text behind each one | Your revision history. Never a document. |
| `.essay/.gitignore` | Two lines: a comment and `*` | Nothing — your sidecar starts being tracked by Git |
| `.essay/skills/*.md` | Your own standing instructions for agents | Those instructions. The built-in house skill is unaffected. |

The `.gitignore` is written once, on creation, and never rewritten. Delete it
if you would rather commit your history.

Deleting the whole `.essay/` folder is always safe. The manuscript was never
in it — that is the point of the design, and it is why history is worth
keeping in SQLite at all.

A document on a read-only volume simply gets no sidecar. It still opens, saves
and prints.

## In the app data directory

Machine state about this installation, deliberately outside your folders. On
Windows that is `%APPDATA%\fyi.essay.app\`; on macOS
`~/Library/Application Support/fyi.essay.app/`; on Linux
`~/.config/fyi.essay.app/`.

```text
fyi.essay.app/
├── recovery.sqlite
├── recovery.sqlite-wal
├── recovery.sqlite-shm
└── adapters/
    └── claude-agent-acp/
        └── 0.64.0/
            ├── .essay-adapter-installed
            ├── package.json
            ├── package-lock.json
            └── node_modules/
```

| Path | Holds | Deleting it costs |
| --- | --- | --- |
| `recovery.sqlite` (+ `-wal`, `-shm`) | The in-progress buffer of every document open when Essay last ran, journalled 600ms after your last keystroke | Unsaved work from a session that crashed. Nothing if Essay exited cleanly. |
| `adapters/<name>/<version>/` | A pinned copy of an agent's ACP adapter, installed from npm once | Nothing permanent — the next launch falls back to `npx -y` and re-installs in the background, but that needs the network once. |

Recovery lives here rather than in `.essay/` for two reasons: it is state about
this installation rather than about a document, and an *untitled* buffer has
no folder to sit beside — which is exactly the case where a crash costs most.

The `.essay-adapter-installed` marker is written last, after npm has finished
*and* the entry point is where it should be. An install that was interrupted
therefore reads as no install at all rather than as half of one that launches
and then fails.

## Temporary files, during a save

A save writes `.<name>.essay-tmp` in the document's directory, syncs it, and
renames it over the target. A crash mid-write leaves either the old document
or the new one, never half a manuscript.

If you ever find one of these left behind, the rename failed; the file holds
what Essay was trying to write.

## In the browser store

The desktop app is a WebView, so preferences live in its `localStorage`.
Clearing it loses only preferences.

| Key | Holds | Deleting it costs |
| --- | --- | --- |
| `essay.measure.v1` | Your writing width | Back to Auto |
| `essay.workspace.folders.v1` | The folders in the file explorer, as a JSON array of `{path, name}` | Your folder list. No files are touched. |
| `essay.agent.v1` | The id of the agent you used last, so opening the panel can pre-warm it | One extra click, and no pre-warm on the next launch |
| `essay.agent.tune.v1` | Your session-option choices per agent, as `{agentId: {optionId: value}}` | Re-choosing model and effort once |
| `essay.welcomed` | Whether the welcome document has been shown | The welcome document appears again on the next new buffer |

Every one of these is read defensively. A corrupt or hand-edited value loses a
preference; it never takes the app down.

Workspace folders are stored here as an interim measure and are expected to
move into application state later.

## What is not stored anywhere

- Nothing is sent off the machine. The only network request Essay makes on its
  own is the update check against GitHub, which you can read about in
  [updates](../guide/updates.md).
- Pending agent proposals are held in memory only. A proposal nobody accepted
  leaves nothing behind, which is what keeps `.essay/` deletable.
- Fonts are embedded in the binary, so there is no font cache.
