/**
 * @essay/editor — the manuscript surface.
 *
 * Rich-text editing (Tiptap/ProseMirror) over a canonical Markdown file:
 * you edit the designed document — real headings, tables, task lists — and
 * the manuscript serializes back to plain Markdown (`editor.getMarkdown()`).
 * Typora is the reference experience.
 *
 * This package assembles extensions and document helpers only; it is
 * framework-agnostic (no React). Hosts bring their own binding
 * (@tiptap/react in apps/desktop) and chrome.
 *
 * Round-trip fidelity is a standing engineering discipline here: saving must
 * never gratuitously rewrite an author's Markdown. Grow golden-file tests in
 * fixtures/ alongside any serializer-affecting change.
 */
import type { AnyExtension, Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Image from '@tiptap/extension-image'
import Typography from '@tiptap/extension-typography'
import { CharacterCount, Placeholder } from '@tiptap/extensions'

export type { Editor } from '@tiptap/core'

export interface ManuscriptOptions {
  placeholder?: string
}

/** The extension set every Essay manuscript uses, regardless of host. */
export function manuscriptExtensions(
  options: ManuscriptOptions = {},
): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false },
    }),
    Markdown,
    TableKit.configure({
      table: { resizable: false },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image,
    Typography,
    CharacterCount,
    Placeholder.configure({
      placeholder: options.placeholder ?? 'Start writing…',
    }),
  ]
}

export interface OutlineItem {
  /** Heading depth, 1–6. */
  level: number
  text: string
  /** ProseMirror document position of the heading node. */
  pos: number
  /** Word count of the section this heading opens (up to the next heading). */
  words: number
}

/**
 * Heading outline straight from the live editor document, with per-section
 * word weight. The Rust index (essay-markdown) remains the source of truth
 * for the file on disk; this reads the in-memory document between saves.
 */
export function extractOutline(editor: Editor): OutlineItem[] {
  const doc = editor.state.doc
  const headings: Array<Omit<OutlineItem, 'words'>> = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      headings.push({
        level: node.attrs.level as number,
        text: node.textContent,
        pos,
      })
      return false
    }
    return true
  })
  return headings.map((heading, i) => {
    const end = i + 1 < headings.length ? headings[i + 1].pos : doc.content.size
    const text = doc.textBetween(heading.pos, end, ' ', ' ')
    return { ...heading, words: (text.match(/\S+/g) ?? []).length }
  })
}

/** Place the cursor in a heading and bring it to the top of the view. */
export function revealHeading(editor: Editor, pos: number): void {
  editor.chain().focus().setTextSelection(pos + 1).run()
  const dom = editor.view.nodeDOM(pos)
  if (dom instanceof HTMLElement) {
    dom.scrollIntoView({ block: 'start' })
  }
}

export function wordCount(editor: Editor): number {
  return editor.storage.characterCount.words()
}
