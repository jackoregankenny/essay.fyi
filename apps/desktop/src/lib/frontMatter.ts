/**
 * Reading and writing the document's own front matter.
 *
 * How a document is typeset — `format:` and `font:` — is declared in the
 * manuscript's YAML block rather than in a preference, so the choice travels
 * with the file and two people opening it get the same page. The UI therefore
 * has to read what is there and write the author's new choice back into a
 * file the author is also editing.
 *
 * That last part is the whole difficulty. Everything outside the one line
 * being changed has to come back byte for byte: other keys and the order they
 * were written in, comments, blank lines, indentation, the quoting style
 * somebody chose, the file's line endings, and the body below. So the block
 * is edited as text, line by line. There is no intermediate representation
 * here — nothing that could parse the author's YAML and re-emit it in its own
 * house style, which is exactly how a well-meaning round trip rewrites a
 * document nobody touched.
 *
 * The reader is deliberately the same minimal one the renderer uses:
 * `parse_front_matter` in `crates/essay-render/src/convert.rs`, which is
 * `key: value` lines and nothing else. Anything richer read here would show
 * the author a value in the UI that the typesetter then ignores, which is
 * worse than showing nothing. Where that Rust is quirky, this is quirky in
 * the same way on purpose, and the quirks are called out where they appear.
 *
 * Two things the renderer does that callers here must do for themselves: it
 * lowercases the `format` value before matching it against a format id, and
 * it lowercases every key. Keys come back from `readFrontMatter` lowercased;
 * values come back exactly as written.
 */

/**
 * Opening `---` on the first line, a body, a closing `---` on its own line,
 * and the whitespace-only lines that follow it.
 *
 * Anchored to the start of the string with no `m` flag, which is the one rule
 * that matters: front matter is front matter only when the document *starts*
 * with it, so a `---` further down stays the thematic break the author meant.
 *
 * Transcribed from `splitFrontMatter` in `@essay/editor`, which decides what
 * the manuscript surface is allowed to see. The two must agree — a block this
 * file edits but that one hands to the editor would be parsed as prose and
 * destroyed on the next save. It is transcribed rather than imported because
 * importing it would pull Tiptap into a string utility.
 *
 * Inherited from there: a block with no lines at all (`---` immediately
 * followed by `---`) does not match, so it reads as no front matter. Harmless,
 * because removing the last key removes the delimiters too and this never
 * writes one.
 */
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---((?:[ \t]*\r?\n)*)/

interface Block {
  /** The lines between the delimiters, without their terminators. */
  lines: string[]
  /** The whitespace-only lines after the closing `---`, terminators included. */
  after: string
  /** Everything below the block, untouched. */
  body: string
}

function findBlock(source: string): Block | null {
  const match = FRONT_MATTER.exec(source)
  if (!match) return null
  return {
    lines: match[1].split(/\r?\n/),
    after: match[2],
    body: source.slice(match[0].length),
  }
}

/** The file's line ending, taken from its first line break. */
function firstLineEnding(source: string): string {
  return /\r?\n/.exec(source)?.[0] ?? '\n'
}

interface Entry {
  /** Lowercased and trimmed, the way the renderer matches keys. */
  key: string
  value: string
}

/**
 * Strip `char` from both ends, however many there are and whether or not they
 * balance.
 *
 * This is Rust's `trim_matches`, and reproducing it is the point: the renderer
 * reads `"essay` as `essay`, so the UI has to say `essay` too. A parser that
 * insisted on matched quotes would disagree with the page.
 */
function trimMatches(value: string, char: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === char) start += 1
  while (end > start && value[end - 1] === char) end -= 1
  return value.slice(start, end)
}

function parseEntry(line: string): Entry | null {
  // The first colon, and a line without one is not a pair — which is what
  // lets comments, blank lines and list items sit in the block untouched.
  const colon = line.indexOf(':')
  if (colon < 0) return null
  return {
    // Trimmed, so an indented line nested under some other key is read as a
    // top-level pair. That is wrong as YAML and right as fidelity: it is what
    // the renderer does, and the UI must not promise a page the renderer will
    // not set.
    key: line.slice(0, colon).trim().toLowerCase(),
    value: trimMatches(trimMatches(line.slice(colon + 1).trim(), '"'), "'"),
  }
}

/**
 * The key/value pairs of the leading YAML block, or empty when there is none.
 *
 * Later duplicates win, as they do in the renderer, so what comes back is
 * what the page will be set with rather than what the file reads like.
 */
export function readFrontMatter(markdown: string): Record<string, string> {
  const block = findBlock(markdown)
  if (!block) return {}

  const values: Record<string, string> = {}
  for (const line of block.lines) {
    const entry = parseEntry(line)
    // An empty value is not a value: the renderer skips it, so `format:` with
    // nothing after it has to read as absent here too, or the UI would offer
    // to keep a format the document is not being set in.
    if (!entry || entry.value === '') continue
    values[entry.key] = entry.value
  }
  return values
}

/**
 * Values that cannot be written bare.
 *
 * A colon would give the reader a second key; leading or trailing spaces are
 * eaten by the trim on the way back in. `#` is quoted for the benefit of every
 * other tool that will ever read this file — the renderer has no notion of a
 * comment, but Jekyll, Obsidian and Pandoc all do, and a font family called
 * `Iowan #2` should survive a trip through them.
 */
const NEEDS_QUOTING = /^[ \t]|[ \t]$|[:#]|^["']/

function writeValue(value: string): string {
  if (value !== '' && !NEEDS_QUOTING.test(value)) return value
  // Single quotes when the value contains a double, because the reader strips
  // quote characters rather than interpreting escapes, so there is no escape
  // to reach for. A value containing both is unrepresentable for that reader;
  // double quotes at least leave a real YAML parser closest to right.
  const quote = value.includes('"') ? "'" : '"'
  return `${quote}${value}${quote}`
}

/** The last line declaring `key`, which is the one the renderer obeys. */
function lastIndexOfKey(lines: readonly string[], key: string): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (parseEntry(lines[i])?.key === key) return i
  }
  return -1
}

/**
 * Put a new value on an existing line, keeping everything to the left of it —
 * the author's indentation, their spelling of the key, and the gap they left
 * after the colon.
 */
function replaceValue(line: string, value: string): string {
  const colon = line.indexOf(':')
  const gap = /^[ \t]*/.exec(line.slice(colon + 1))?.[0] ?? ''
  // A key written with nothing after it has no gap to preserve, and
  // `format:essay` reads like a typo even though the renderer accepts it.
  return `${line.slice(0, colon + 1)}${gap === '' ? ' ' : gap}${writeValue(value)}`
}

/**
 * Add a block to a document that has none.
 *
 * The blank line after the closing delimiter is not decoration: `@essay/editor`
 * holds the trailing blank lines with the front matter when it splits a file,
 * so the body handed to the manuscript surface is byte-identical to the body
 * that was there before this ran.
 */
function createBlock(
  markdown: string,
  updates: Record<string, string | null>,
  eol: string,
): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) continue
    lines.push(`${key.trim()}: ${writeValue(value)}`)
  }
  // Nothing to declare, so nothing is written. Removing a key from a document
  // that has no front matter must not give it one.
  if (lines.length === 0) return markdown
  return `---${eol}${lines.join(eol)}${eol}---${eol}${eol}${markdown}`
}

/**
 * Set front-matter keys, creating the block if there is none and removing it
 * if it empties. A `null` value removes the key.
 *
 * Setting a key to the value it already has is not an edit and writes nothing,
 * so an author who wrote `format: 'essay'` still has `format: 'essay'` after
 * the UI has re-asserted the format it read.
 */
export function setFrontMatterKeys(
  markdown: string,
  updates: Record<string, string | null>,
): string {
  const eol = firstLineEnding(markdown)
  const block = findBlock(markdown)
  if (!block) return createBlock(markdown, updates, eol)

  const lines = block.lines.slice()
  let changed = false

  for (const [rawKey, value] of Object.entries(updates)) {
    const key = rawKey.trim().toLowerCase()

    if (value === null) {
      // Every occurrence, not only the one that currently decides: dropping
      // the last of two `format:` lines would leave the earlier one setting
      // the page, which is not what removing it asked for.
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (parseEntry(lines[i])?.key !== key) continue
        lines.splice(i, 1)
        changed = true
      }
      continue
    }

    const at = lastIndexOfKey(lines, key)
    if (at < 0) {
      lines.push(`${rawKey.trim()}: ${writeValue(value)}`)
      changed = true
      continue
    }
    if (parseEntry(lines[at])?.value === value) continue
    lines[at] = replaceValue(lines[at], value)
    changed = true
  }

  if (!changed) return markdown
  // A block with no lines left is not written as bare delimiters: the
  // delimiters and the blank line after them go too, leaving the body exactly
  // as the author last saw it. Comments and blank lines count as lines, so a
  // block kept alive by a comment keeps its comment.
  if (lines.length === 0) return block.body
  return `---${eol}${lines.join(eol)}${eol}---${block.after}${block.body}`
}
