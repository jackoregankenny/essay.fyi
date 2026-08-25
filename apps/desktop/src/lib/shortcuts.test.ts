/**
 * The catalogue's own discipline, made executable.
 *
 * `shortcuts.ts` declares every key once, but nothing else in the app runs
 * its collision check: `manuscriptShadow()` exists to catch the next
 * Structure-on-Ctrl+B — a chrome binding the manuscript consumes before the
 * window listener ever sees it, dead everywhere an author actually types —
 * and until now nothing called it, so it would have caught nothing. These
 * tests are the caller. A new binding that collides fails here, and adding a
 * collision to the allowlist below is then a deliberate act with a written
 * reason, not an accident discovered weeks later.
 */
import { describe, expect, test } from 'bun:test'

import { BINDINGS, manuscriptShadow, type Binding } from './shortcuts'

function claims(binding: Binding): string[] {
  return binding.alsoKeys ? [binding.keys, binding.alsoKeys] : [binding.keys]
}

/** Every chord a surface holds, with who holds it — duplicates fail loudly. */
function byKey(surface: Binding['surface']): Map<string, string> {
  const seen = new Map<string, string>()
  for (const binding of BINDINGS.filter((b) => b.surface === surface)) {
    for (const key of claims(binding)) {
      const holder = seen.get(key)
      if (holder !== undefined && holder !== binding.id) {
        throw new Error(`${surface} binds ${key} twice: '${holder}' and '${binding.id}'`)
      }
      seen.set(key, binding.id)
    }
  }
  return seen
}

describe('the shortcut catalogue', () => {
  test('ids are unique', () => {
    const ids = new Set(BINDINGS.map((b) => b.id))
    expect(ids.size).toBe(BINDINGS.length)
  })

  test('every binding spells at least one key', () => {
    for (const binding of BINDINGS) {
      expect(binding.keys.trim().length).toBeGreaterThan(0)
    }
  })

  test('no chrome binding shares a chord with another chrome binding', () => {
    byKey('chrome')
  })

  test('no manuscript binding shares a chord with another manuscript binding', () => {
    byKey('manuscript')
  })

  test('exactly one deliberate manuscript shadow survives, and it is Save As', () => {
    // The one collision with a written defence: Shift+Save is every file
    // dialog's spelling and Mod-Shift-s is StarterKit's strikethrough, both
    // claims are strong, and the dialog stays reachable through the palette.
    // If this test fails on something new, do not extend this list from habit —
    // a chrome binding that loses to the prose is dead where the caret lives.
    const shadows = BINDINGS.filter((b) => b.surface === 'chrome')
      .map((b) => ({ chrome: b, manuscript: manuscriptShadow(b) }))
      .filter((pair) => pair.manuscript !== undefined)
    expect(shadows).toEqual([
      { chrome: expect.objectContaining({ id: 'file.saveAs' }), manuscript: expect.objectContaining({ id: 'format.strike' }) },
    ])
  })
})
