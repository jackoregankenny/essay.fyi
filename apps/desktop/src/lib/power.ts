// Whether this machine is running on battery, and who gets to know.
//
// Essay does periodic work that is free on mains and rude on battery: a Typst
// compile behind the preview debounce, a filesystem sweep when the watcher
// degrades to polling, an update check, a pre-warmed agent subprocess. None of
// those are wrong — they are what makes the app feel immediate — but the right
// interval for each is a different number when nobody is plugged in.
//
// This is one source of truth for that question rather than a check per caller,
// because the moment two surfaces disagree about whether we are on battery, the
// bug is invisible: everything still works, it just quietly costs more.
//
// ## The platform gap, stated plainly
//
// `navigator.getBattery` is Chromium's Battery Status API. It exists in
// WebView2 and is absent from WKWebView and WebKitGTK — so today this answers
// honestly on Windows and answers "mains" on macOS and Linux. That is not a
// rounding error, it is two of the three platforms, and it means the battery
// work below is currently a Windows optimisation that is merely harmless
// elsewhere.
//
// Closing it means asking the OS from Rust, which is a new dependency in a tree
// we are deliberately keeping small. `source()` is the seam for that: swap what
// it reads and every caller follows. Deliberately not done yet — the dependency
// should be bought when someone is actually running Essay unplugged on a Mac,
// not on the guess that they will be.
//
// Unknown resolves to *mains*, never to battery. Guessing "battery" would slow
// the app down for someone who never asked for it and give them no way to tell
// why; guessing "mains" costs the power we spend today and nothing else.

import { useEffect, useState } from 'react'

/** The slice of Chromium's `BatteryManager` we use. It is an `EventTarget`,
    which is what makes live updates possible rather than one-shot polling. */
interface BatteryLike extends EventTarget {
  charging: boolean
}

type BatterySource = () => Promise<BatteryLike | null>

/**
 * Where power state comes from. One function so there is one thing to replace
 * when this stops being browser-only — see the platform note above.
 */
const source: BatterySource = async () => {
  try {
    const getBattery = (
      navigator as Navigator & {
        getBattery?: () => Promise<BatteryLike>
      }
    ).getBattery
    if (!getBattery) return null
    return await getBattery.call(navigator)
  } catch {
    // A machine that will not say is a machine we treat as plugged in.
    return null
  }
}

/**
 * Whether this machine is on battery, best effort, answered once.
 *
 * For callers that need the answer at a single moment — a decision taken and
 * finished, like whether to spawn a pre-warm — rather than a state to follow.
 */
export async function onBattery(): Promise<boolean> {
  const battery = await source()
  return battery ? battery.charging === false : false
}

/**
 * Whether this machine is on battery, followed live.
 *
 * `chargingchange` matters more than it looks: the interesting moment is
 * someone unplugging mid-session, which is exactly when a one-shot check taken
 * at mount is wrong for the rest of the afternoon. Plugging back in has to
 * restore the responsive intervals just as promptly, or the app stays sluggish
 * until it is relaunched and the author learns nothing except that it is slow.
 */
export function usePowerState(): boolean {
  const [battery, setBattery] = useState(false)

  useEffect(() => {
    let cancelled = false
    let manager: BatteryLike | null = null
    const sync = () => {
      if (!cancelled && manager) setBattery(manager.charging === false)
    }

    void source().then((found) => {
      // Resolving after unmount is the common case on a fast close; binding a
      // listener here would leak it, since cleanup has already run.
      if (cancelled || !found) return
      manager = found
      manager.addEventListener('chargingchange', sync)
      sync()
    })

    return () => {
      cancelled = true
      manager?.removeEventListener('chargingchange', sync)
    }
  }, [])

  return battery
}
