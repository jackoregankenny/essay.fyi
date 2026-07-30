// Placeholder document analysis, UI-side only. This is replaced by the Rust
// document index (essay-markdown via the `index_document` Tauri command)
// once file opening lands; the shapes intentionally mirror that index.

export interface OutlineItem {
  /** Heading depth, 1–6. */
  level: number
  text: string
  /** 1-based line number in the source. */
  line: number
}

export function extractOutline(doc: string): OutlineItem[] {
  const items: OutlineItem[] = []
  let inFence = false
  doc.split('\n').forEach((rawLine, i) => {
    if (/^(```|~~~)/.test(rawLine.trimStart())) {
      inFence = !inFence
      return
    }
    if (inFence) return
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(rawLine)
    if (match) {
      items.push({ level: match[1].length, text: match[2], line: i + 1 })
    }
  })
  return items
}

export function countWords(doc: string): number {
  return (doc.match(/\S+/g) ?? []).length
}

/** Rough page estimate until the Typst pipeline reports real pages. */
export function estimatePages(words: number): number {
  return Math.max(1, Math.ceil(words / 350))
}
