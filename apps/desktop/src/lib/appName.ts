// What this build of Essay calls itself.
//
// Normally "Essay". In a development build it is "Essay Dev", because
// `tauri.dev.conf.json` overrides `productName` so that the copy being written
// in and the copy being changed underneath can be installed and open at once
// (see the `run` doc comment in src-tauri/src/lib.rs for the whole set).
//
// This exists because the window title is the *other* half of telling them
// apart. The red icon does the work in the taskbar, but Essay runs with
// `decorations: false` on Windows, so the OS window title is not drawn on the
// window at all — the only places it surfaces are Alt-Tab and the taskbar
// tooltip, which is to say: exactly the places you use to switch between two
// running copies. Two entries both reading "untitled.md — Essay" is the moment
// the icon's work is undone.
//
// Asked of the backend rather than hardcoded per build, because the name is
// already declared in the config and a second copy in TypeScript is a second
// copy to forget. `getName()` answers a promise, so unlike `platform.ts` this
// cannot be read synchronously at module load; the fallback is the product
// name from the base config, which is correct for every build except the dev
// one and wrong only for the few milliseconds before the real answer lands.

import { isTauri } from '@tauri-apps/api/core'
import { getName } from '@tauri-apps/api/app'

/** What to call the app until the backend answers — and forever, in the
    browser dev preview, where there is no backend to ask. */
const FALLBACK = 'Essay'

let resolved = FALLBACK

/**
 * Resolves to this build's product name.
 *
 * Started once at module load and shared by every caller, so the round trip is
 * paid once per session rather than once per rename of the open document.
 * A failure is not worth surfacing: the fallback is right for the build almost
 * everyone is running.
 */
export const appName: Promise<string> = isTauri()
  ? getName()
      .then((name) => {
        resolved = name || FALLBACK
        return resolved
      })
      .catch(() => FALLBACK)
  : Promise.resolve(FALLBACK)

/** The name as last known, without waiting. Returns the fallback until the
    promise above settles. */
export function appNameNow(): string {
  return resolved
}
