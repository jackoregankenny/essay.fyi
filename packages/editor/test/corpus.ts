import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Absolute path into the repository's `fixtures/` tree. */
export function fixturePath(relative: string): string {
  return fileURLToPath(new URL(`../../../fixtures/${relative}`, import.meta.url))
}

export function readFixture(relative: string): string {
  return readFileSync(fixturePath(relative), 'utf8')
}

/**
 * Read a golden file, or write it when `UPDATE_GOLDEN=1` is set.
 *
 * A golden here records what the serializer does *today*, not what it ought to
 * do. Its job is to make drift loud: any change to a construct the round trip
 * cannot yet preserve shows up as a failing diff rather than as a quiet change
 * to someone's manuscript. Regenerate deliberately, and read the diff.
 */
export function golden(relative: string, actual: string): string {
  const path = fixturePath(relative)
  if (process.env.UPDATE_GOLDEN === '1') {
    writeFileSync(path, actual, 'utf8')
    return actual
  }
  return readFileSync(path, 'utf8')
}

/** Line numbers where two documents disagree, for readable assertions. */
export function changedLines(before: string, after: string): number[] {
  const left = before.split('\n')
  const right = after.split('\n')
  const lines: number[] = []
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) lines.push(i + 1)
  }
  return lines
}
