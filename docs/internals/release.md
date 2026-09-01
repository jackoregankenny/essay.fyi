# Internals: release

For contributors and whoever cuts a release. What CI checks, and what must
line up before a tag is safe to push.

## CI

`.github/workflows/ci.yml`, on pushes and pull requests to `main`, and on
manual dispatch. Concurrent runs for the same ref cancel each other.

### `web` (ubuntu)

`bun install --frozen-lockfile`, then:

1. `bun run typecheck` — `tsc` over `apps/desktop` and the packages it imports.
2. `bun test` — the round-trip and serializer golden tests. The step is named
   for what a failure means: a save would rewrite a document nobody edited.
   This is the job that guards invariant 2.
3. `bun run build`.
4. Measure `apps/desktop/dist` and write the size into the job summary and an
   output.

### `rust` (ubuntu)

Installs `fonts-dejavu-core` and `fonts-liberation`, then runs
`cargo test --workspace --exclude essay-desktop`.

The fonts are not incidental. Essay typesets with the machine's own faces
rather than embedded ones, so `essay-render`'s tests depend on the runner
having a serif and a monospace family that the template's stack names.
Pinning them in the workflow is what makes this job depend on the repository
instead of on whichever fonts GitHub's base image happens to ship this month.
`desktop-linux` installs the same pair for the same reason.

`essay-desktop` is excluded because it needs webkit2gtk system libraries on
Linux and needs `apps/desktop/dist` to exist at compile time —
`tauri::generate_context!` embeds it. Neither is set up on that job;
`desktop-linux` sets up both.

### `desktop-linux` (ubuntu)

Installs the Tauri Linux dependencies, builds the frontend, then
`cargo check -p essay-desktop`.

This job exists because until it did, **the Tauri shell had never been compiled
on anything but Windows.** The `rust` job excludes it and the `size` job runs on
Windows, so a change that broke the shell on Linux could reach a tag with every
check green.

`check` rather than `build`: the point is to catch source and dependency
breakage on a platform nobody develops on, and that surfaces in typeck and macro
expansion. A full link is minutes of Typst codegen for a binary that is thrown
away, and the `size` job already links the real thing. The gap is worth stating
plainly — **a Linux-only *link* error still slips through this.**

### `size` — a separate workflow

`.github/workflows/size.yml`, not `ci.yml`. On pushes to `main` that touch Rust
or the manifests, weekly, and on demand. It does two jobs that happen to be the
same build.

The **budget leg** (`windows-latest`) builds the frontend, then
`cargo build --release -p essay-cli -p essay-desktop`, then
`bun scripts/check-size.mjs`.

The **cache legs** (`macos-latest`, `ubuntu-24.04`) build the same release
profile and keep nothing anybody looks at. They exist to write the cargo caches
`release.yml` restores — see [the caches](#the-caches-are-written-on-main) — and
they are skipped on a push, because three runners spun up to answer a question
one of them is asked is somebody else's electricity.

`cache-on-failure: true`, because the budget check is the last step: a failure
there was discarding 22 minutes of compilation and leaving `main` with no
Windows cache for the next release to restore.

## Artifact size

The `size` job runs `bun scripts/check-size.mjs` against
`scripts/size-budget.json`. Those numbers are **ceilings, not baselines**: the
check fails only when an artifact is bigger than its ceiling, and otherwise
prints how much headroom is left. What the artifacts weigh, why a ceiling
replaced the old baseline-plus-tolerance, and which size levers have been
pulled are in [artifact size](./size.md).

## Releasing

`.github/workflows/release.yml`, triggered by pushing a `v*` tag. It builds an
installer on each desktop platform, signs the updater artifacts, and publishes
them all as one GitHub release.

Four jobs:

| Job | Runs on | Does |
| --- | --- | --- |
| `guard` | ubuntu | Checks the tag against `tauri.conf.json`, and nothing else |
| `draft` | ubuntu | Opens the draft release the matrix uploads into |
| `bundle` | matrix, **parallel** | Builds, signs and uploads each platform's installer |
| `publish` | ubuntu | Composes `latest.json`, then flips the draft to published |

`draft` exists because three parallel jobs that each create-the-release-if-absent
race for it. With its id passed down, `tauri-action` uploads into an existing
release and never reaches its create path at all.

### The tag must match `tauri.conf.json`

Its own job, so a mismatch costs seconds rather than three platform builds. It
fails the run if the two disagree:

```bash
TAG="${GITHUB_REF_NAME#v}"
APP=$(node -p "require('./apps/desktop/src-tauri/tauri.conf.json').version")
[ "$TAG" = "$APP" ] || exit 1
```

The updater compares the version in `latest.json` — which comes from
`tauri.conf.json`, **not from the tag** — against the version each installed
copy is running. Tagging `v0.2.0` without bumping the config publishes an
update nobody is ever offered, and says nothing about why.

So a release is two commits' worth of care: bump
`apps/desktop/src-tauri/tauri.conf.json`'s `version`, commit, then tag that
commit.

### Signing

`tauri-apps/tauri-action` needs two repository secrets:

| Secret | What it is |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | The contents of the private key file generated by `tauri signer generate` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password — currently the empty string, since the key was generated without one |

The private key lives outside this repository, under `%USERPROFILE%\.tauri\`
on the maintainer's machine. It is not in Git and must not be.

**That key is Essay's own update signature and is all the updater checks. It is
not an Apple Developer ID.** There are no Apple secrets here, so the macOS
`.app` and `.dmg` are unsigned and unnotarised: a first launch needs
right-click → Open rather than a double-click. Auto-updates after that are
unaffected, because they are verified with minisign rather than by the OS.

`plugins.updater.pubkey` in `tauri.conf.json` is the public half of that same
key. **If the two ever stop matching, every installed copy of Essay rejects
the update as unsigned and says nothing about why** — so rotate both together
or not at all.

Without the secrets the bundler still builds an installer, but with no
signature, and `latest.json` is written with an empty one that no client will
accept. That failure is silent on the release side and total on the client
side, which is why it is worth checking that a release actually produced
signatures before announcing it.

### The matrix runs in parallel, and why it could not before

It was `max-parallel: 1` until the manifest got a single writer, and the reason
is worth keeping, because the failure it avoided is the silent kind.

Each run of `tauri-action` used to build `latest.json` by downloading the
release's existing copy, merging its own platform in, and re-uploading it — a
read-modify-write across three machines. Two jobs finishing at once lose one
platform's entry, and a lost entry **is not an error anywhere**: it is simply an
operating system that quietly stops being offered updates.

Serialising made that unlikely and cost 42 of the 74 minutes v0.1.2 took —
Windows 26m, then macOS 32m, then Linux 15m, each waiting on the one before it
for no reason but that file.

`includeUpdaterJson: false` removes the write entirely, and
`scripts/compose-latest-json.mjs` builds the whole manifest once, in `publish`,
from the `.sig` assets already on the release. One writer, so there is nothing
left to order. It was checked against the published v0.1.2 manifest before being
trusted with one — same nine platform keys, same signatures, same URLs — and it
**fails the run** when a platform an installed copy actually looks up is
missing, rather than publishing a release that stops offering updates to an OS.

`fail-fast: false` for the opposite reason: one platform failing should not
cancel installers that already built. The draft keeps whatever landed, and the
tag can be re-run.

### Drafted, then published

The `draft` job opens it as a draft, and `publish` flips it afterwards.

The updater reads `releases/latest/download/latest.json`, so the moment the
release stops being a draft it is what every installed copy checks. Publishing
when the first platform finishes would offer everyone else an update that does
not list their platform yet. A draft is invisible to the updater, which is
exactly what is wanted until every platform has merged its entry.

`publish` finds the release by listing rather than by `releases/tags/<tag>`,
because that endpoint 404s on drafts, and sets `make_latest=true` explicitly —
that is what makes `releases/latest/download/latest.json` resolve here.

`createUpdaterArtifacts: true` in `tauri.conf.json` is what produces the `.sig`
files. `includeUpdaterJson: false` in the workflow is what stops `tauri-action`
writing the manifest, leaving `compose-latest-json.mjs` as its only writer.

### The caches are written on `main`

GitHub scopes a cache to the ref that wrote it and lets a run restore only from
its own ref or from the default branch. A release runs on `refs/tags/v0.1.3`, so
a cache **it** writes can never be read by `v0.1.4`.

Measured after v0.1.2: 2.82 GB saved under the tag, unreachable by every release
that would ever follow it, while all three jobs logged `No cache found` and
compiled Typst from nothing — 24m42s on Windows, 31m15s on macOS, 14m11s on
Linux. That was the steady state, not a cold first run.

So the warm caches are written on `main`, by `size.yml`, under
`shared-key: release`. That key is what makes them match: rust-cache otherwise
derives the key from the job id, and `bundle` could not restore what `size`
saved even on the same ref and the same OS. The release side sets
`save-if: false`, because a tag-scoped cache has no reader — not even a re-run
of its own tag, which restores from `main` like any other run.

**Before cutting a release, check the caches are warm.** If the last scheduled
`size` run was a long time or a big dependency bump ago, dispatch it manually and
let it finish. A cold release still succeeds; it just takes about three times as
long. rust-cache falls back to a prefix match when `Cargo.lock` has moved, so a
slightly stale cache is still most of the win.

### Why `ubuntu-24.04` and not `ubuntu-latest`

The build host sets the glibc floor of every artifact it produces. Letting
GitHub move the image moves the oldest distro Essay runs on without anyone
deciding to. 24.04 is the oldest image still supported through 2026 that ships
`libwebkit2gtk-4.1`.

macOS builds one universal binary (`--target universal-apple-darwin`) rather
than two: it covers Apple Silicon and Intel, and `tauri-action` writes both
`darwin-aarch64` and `darwin-x86_64` into `latest.json` from it.

### What is not verified

Stated because CI going green is not the same claim as the app working.

- **A Linux-only link error still slips through.** `desktop-linux` runs
  `cargo check`, not `build`.
- **Essay has never been launched on macOS or Linux.** The window chrome for
  both is config that has been parsed and reasoned about, not run: whether
  `titleBarStyle: Overlay` really draws the traffic lights over the transparent
  header, whether the 78px reservation is right (macOS has moved this between
  versions), and whether Linux `decorations: true` reads as acceptable chrome or
  as a double titlebar on GNOME/KDE.
- **The parallel release path has not run yet.** v0.1.1 and v0.1.2 both shipped
  on the old serial pipeline; the four-job shape above is proven only against the
  v0.1.2 artifacts it was checked over, not by a release of its own.
- **`scripts/release-local.mjs` has never built anything.** Its five guards were
  exercised; the macOS build, the `_universal` rename and the upload need a Mac
  and a real tag.

## Current bundle configuration

- Targets: `nsis`, `app`, `dmg`, `deb`, `appimage`. One list for every platform
  — `tauri-bundler` filters the configured types against the host and silently
  drops the rest, so Windows produces the NSIS installer and ignores the other
  four.
  - `app` is not decorative: the macOS updater artifact is `Essay.app.tar.gz`,
    and it only exists when that target is bundled.
  - `appimage` is there because `.deb` is not an updatable format.
- Identifier: `fyi.essay.app` — this is what determines the app data directory
  in [storage](../reference/storage.md), so changing it orphans every existing
  installation's recovery journal and adapter install.
- The window is configured per platform. `tauri.conf.json` keeps
  `decorations: false` and the chrome draws its own controls, which is the
  Windows build unchanged; `tauri.macos.conf.json` turns decorations on with
  `titleBarStyle: Overlay` and `hiddenTitle`, and `tauri.linux.conf.json` turns
  them on and lets the window manager draw the frame. Tauri merges these with
  RFC 7396, which **replaces arrays wholesale** — so `app.windows` cannot be
  partially overridden and each platform file repeats the window geometry.
- `security.csp` is `null`. Worth revisiting before a public 1.0.

## Cutting a release

After merging whatever the release contains:

```bash
git checkout main && git pull
```

1. **Write the changelog entry.** `apps/desktop/src/content/changelog.md` is not
   decoration — `lib/changelog.ts` parses the newest entry and the help tab in
   the footer shows it. A release without an entry shows the *previous*
   release's summary to everyone who opens it.
2. **Check the caches are warm.** If the last `size` run on `main` was a long
   time or a big dependency bump ago, dispatch it and let it finish. Cold costs
   about three times the wall clock.
3. **Bump and tag.**

   ```bash
   bun run release patch
   ```

   `patch`, `minor`, `major`, or an explicit `X.Y.Z`. The version is written
   down twice — `tauri.conf.json`, which is what `latest.json` serves and what
   `guard` checks, and `[workspace.package]` in `Cargo.toml`, which nothing
   checks and which therefore drifts. The script sets both, refreshes
   `Cargo.lock`, commits and tags. `--dry-run` prints the edits and stops.

4. **Push**, which is the irreversible half and is why the script does not do it
   for you:

   ```bash
   git push origin main && git push origin v0.1.3
   ```

   To undo instead, before pushing:

   ```bash
   git tag -d v0.1.3 && git reset --hard HEAD~1
   ```

5. **Wait for all three `bundle` jobs.** `publish` only runs when they have
   finished, and until it does the release is a draft nobody's updater sees.
6. **Check the published release** has an installer for each platform and a
   `latest.json` listing `windows-x86_64`, `darwin-aarch64`, `darwin-x86_64` and
   `linux-x86_64`, each with a non-empty signature. `compose-latest-json.mjs`
   fails the run rather than publishing one of these missing, so this is a
   check on the check — but it is the failure the whole workflow is arranged to
   prevent, and it is silent everywhere else.

Roughly 15 minutes warm, 35 cold.

### Re-running a failed release

Everything is idempotent. `draft` reuses the existing draft, and `tauri-action`
replaces an asset of the same name rather than duplicating it. Re-run the failed
job from the Actions page, or re-push the tag.

Moving a tag to a different commit works and is how `v0.1.2` ended up pointing
at a commit two ahead of the one named "Release v0.1.2". If you do it, know that
the artifacts and the commit message will disagree about what shipped.
