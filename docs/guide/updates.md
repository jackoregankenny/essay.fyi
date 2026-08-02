# Updates

For anyone running a built copy of Essay who wants to know when it changes
underneath them.

The short version: Essay checks for updates and downloads them quietly, and
then waits. A writing tool that restarts itself mid-sentence has taken
something no update is worth, so the restart is always yours to press.

This applies to installed builds. There is no updater in `bun run dev` or in
the browser preview.

## When it looks

- 15 seconds after launch — late enough not to compete with the first paint or
  your first keystroke, soon enough to find a version released overnight.
- Every hour it stays open.
- When you come back to the window, if the last look is more than an hour old.
  A laptop that slept through four hourly timers fires none of them, and the
  hour that matters is wall-clock.

Once an update has been downloaded, checking stops. This process cannot become
the new version, so further polling is only traffic.

You can also ask, by clicking the circular-arrow button in the header. That is
the only case where "Up to date" appears — for four seconds, then it goes
away. A background check that finds nothing says nothing at all.

## What the button says

| Label | What it means |
| --- | --- |
| (arrows icon) | Nothing found, or nothing checked yet. Click to check now. |
| `Checking…` | A check you asked for is running. |
| `Downloading… 42%` | A new version is being fetched in the background. |
| `Restart to update` | Downloaded, and pressing this will apply it. |
| `Update ready — applies next launch` | Downloaded, but restarting now would cost you something. |

That last one is the interesting state. Essay will not restart while:

- **the manuscript is not fully on disk** — unsaved edits, an untitled buffer
  with anything in it, or an unanswered "changed on disk" notice; or
- **an agent session is running** — an agent is a subprocess holding a turn,
  and killing one loses whatever it was about to say.

Hovering the button says which of the two it is waiting on. The condition is
re-checked at the moment of the click, not just when the label was drawn, so a
session that started in between still blocks it.

## What happens when you press restart

**On Windows the update installs when you press "Restart to update", or on the
next launch — never behind your back.** Pressing it hands over to the NSIS
installer, and the Essay process ends inside that handover; the new version
starts from the installer. On platforms where installing returns, Essay
relaunches itself.

Either way, nothing touches the installed application until you press the
button. The downloaded bytes sit in memory waiting.

If the install fails, it fails quietly to a console line and you keep the
version you have.

## What it will not do

- **Nag.** A check that fails — no release yet, no network, a signature that
  does not verify — is a console line. Someone in the middle of a paragraph
  who cannot reach GitHub still has a working editor, and saying so in red
  over their work would be the intrusive version of this feature.
- **Install something unsigned.** Every update artifact is signed, and the
  public half of the key is compiled into the app. An artifact that does not
  verify is refused. The mechanics are in
  [release](../internals/release.md).
- **Phone home.** The check is one request to GitHub's releases endpoint. It
  is the only network request Essay makes on its own, and Essay works fully
  offline without it.
