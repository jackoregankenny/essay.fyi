// The changelog, as data.
//
// `content/changelog.md` is the source of truth and is written to be *read* —
// it opens in the manuscript surface like any other document, typeset, because
// that is the aesthetic worth reusing rather than reimplementing as chrome.
// This module is only what the help popover needs to summarise it: which
// releases exist, and a couple of lines about the newest one.
//
// Parsed rather than kept as a second hand-maintained list. A changelog and a
// summary of that changelog will disagree eventually, and the version that is
// wrong will be the one nobody opens — which is the popover.
//
// The grammar is deliberately small, because it is the grammar an author is
// already writing:
//
//   # What's new in Essay        <- ignored, the document's own title
//   ## 0.1.0 — Unreleased        <- a release. Version, then anything else.
//   Prose paragraph              <- the summary line
//   ### Writing                  <- a heading within the release
//   - a bullet                   <- picked up as a highlight
//
// Anything it does not understand is passed over rather than guessed at: the
// full document is one click away and is the authority.

import source from '#/content/changelog.md?raw'

export interface Release {
  /** The version as written, e.g. "0.1.0". */
  version: string
  /** Whatever followed it on the heading line — a date, or "Unreleased". */
  when: string
  /** The first paragraph under the heading: what this release is, in a line. */
  summary: string
  /** `###` headings within the release, in order. The shape of what changed. */
  sections: string[]
}

/** Splits `0.1.0 — Unreleased` into its two halves. The separator is an em
    dash with spaces, which is what the document already uses; a hyphen is
    accepted too, because it is what gets typed. */
const HEADING = /^##\s+(\S+)\s*(?:[—–-]\s*(.*))?$/

/** A bullet, at the start of a line, in either of Markdown's two spellings. */
const BULLET = /^[-*]\s+(?:\[[ xX]\]\s*)?(.+)$/

function parse(markdown: string): Release[] {
  const releases: Release[] = []
  let current: Release | null = null

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim()

    const heading = HEADING.exec(line)
    if (heading) {
      current = {
        version: heading[1],
        when: (heading[2] ?? '').trim(),
        summary: '',
        sections: [],
      }
      releases.push(current)
      continue
    }
    if (!current) continue

    if (line.startsWith('### ')) {
      current.sections.push(line.slice(4).trim())
      continue
    }

    // The summary is the first ordinary paragraph, and only that: a release
    // whose first line is a `###` heading has no summary rather than borrowing
    // the first bullet it can find, which would read as a claim about the
    // whole release when it is a claim about one part of it.
    if (
      !current.summary &&
      line &&
      !line.startsWith('#') &&
      !line.startsWith('|') &&
      !line.startsWith('---') &&
      !BULLET.test(line)
    ) {
      current.summary = line
    }
  }

  return releases
}

/** Every release named in the changelog, newest first — which is the order the
    document is written in, not an order imposed here. Sorting by version would
    mean parsing semver and would be wrong the first time a patch ships after a
    later minor; the document's own order is the author's answer. */
export const releases: Release[] = parse(source)

/** The newest release, or null for a changelog with no entries yet. */
export const latestRelease: Release | null = releases[0] ?? null

/** The changelog itself, for opening in the manuscript surface. */
export const changelogSource = source
