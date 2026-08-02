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
import { Extension, InputRule, type AnyExtension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table, TableKit } from '@tiptap/extension-table'

import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import Typography from '@tiptap/extension-typography'
import { CharacterCount, Placeholder } from '@tiptap/extensions'

import { ManuscriptCodeBlock } from './markdown-code'
import { MinimalEscaping } from './markdown-escapes'
import { ManuscriptHtmlBlock } from './markdown-html'
import {
  ManuscriptBulletList,
  ManuscriptListItem,
  ManuscriptOrderedList,
  ManuscriptTaskItem,
  ManuscriptTaskList,
} from './markdown-lists'
import { renderManuscriptTable } from './markdown-tables'

export type { Editor } from '@tiptap/core'

export {
  clearFrontMatter,
  getManuscript,
  setManuscript,
  splitFrontMatter,
  type SplitManuscript,
} from './frontmatter'

/** Nearest scrollable ancestor of the editor DOM (the manuscript pane). */
function scrollerOf(dom: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = dom.parentElement
  while (el) {
    const overflow = getComputedStyle(el).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return el
    el = el.parentElement
  }
  return null
}

/** Scroll so the caret sits at the vertical centre of the manuscript pane. */
function centerCaret(view: { dom: HTMLElement } & Pick<Editor['view'], 'coordsAtPos' | 'state'>): void {
  const scroller = scrollerOf(view.dom)
  if (!scroller) return
  let coords: { top: number; bottom: number }
  try {
    coords = view.coordsAtPos(view.state.selection.head)
  } catch {
    return
  }
  const rect = scroller.getBoundingClientRect()
  const caretMiddle = (coords.top + coords.bottom) / 2
  scroller.scrollTop += caretMiddle - (rect.top + rect.height / 2)
}

/**
 * Typewriter scrolling: while focus mode is on, the line being written
 * stays vertically centred. Inert otherwise.
 */
const TypewriterScroll = Extension.create({
  name: 'essayTypewriterScroll',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('essayTypewriterScroll'),
        view: () => ({
          update(view, prevState) {
            if (!view.dom.classList.contains('is-focus-mode')) return
            if (
              prevState.doc.eq(view.state.doc) &&
              prevState.selection.eq(view.state.selection)
            ) {
              return
            }
            centerCaret(view)
          },
        }),
      }),
    ]
  },
})

/**
 * Marks the top-level block containing the caret with `.is-current-block`.
 * Inert on its own — when the host toggles `.is-focus-mode` on the editor
 * DOM (via setFocusMode), prose.css dims every other block.
 */
const FocusCurrentBlock = Extension.create({
  name: 'essayFocusCurrentBlock',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('essayFocusCurrentBlock'),
        props: {
          decorations(state) {
            const { $head } = state.selection
            if ($head.depth === 0) return null
            return DecorationSet.create(state.doc, [
              Decoration.node($head.before(1), $head.after(1), {
                class: 'is-current-block',
              }),
            ])
          },
        },
      }),
    ]
  },
})

/**
 * Typora-style link typing: `[text](url)` becomes a link when the closing
 * parenthesis is typed. StarterKit's Link extension covers paste and
 * autolink; plain typing needs its own rule.
 */
const MarkdownLinkTyping = Extension.create({
  name: 'essayMarkdownLinkTyping',
  addInputRules() {
    return [
      new InputRule({
        find: /\[([^[\]]+)\]\(([^()\s]+)\)$/,
        handler: ({ state, range, match }) => {
          const [, text, href] = match
          const link = state.schema.marks.link
          if (!text || !href || !link) return
          // Mutate the rule's own transaction — dispatching a separate
          // chain from inside an input rule collides with it.
          state.tr
            .replaceWith(range.from, range.to, state.schema.text(text, [link.create({ href })]))
            .removeStoredMark(link)
        },
      }),
    ]
  },
})

/**
 * Dim everything except the block being written and keep the caret line
 * vertically centred (typewriter scrolling).
 */
export function setFocusMode(editor: Editor, on: boolean): void {
  editor.view.dom.classList.toggle('is-focus-mode', on)
  if (on) centerCaret(editor.view)
}

export interface ManuscriptOptions {
  placeholder?: string
}

/**
 * The extension set every Essay manuscript uses, regardless of host.
 *
 * Three of the stock nodes are replaced by variants that serialize back to the
 * author's Markdown rather than to a normalised form of it — see
 * `markdown-lists.ts` and `markdown-tables.ts` for what each one stops the
 * serializer from rewriting, and `markdown-escapes.ts` for the text-level
 * equivalent. All of it exists to hold invariant 2.
 */
export function manuscriptExtensions(
  options: ManuscriptOptions = {},
): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false },
      bulletList: false,
      orderedList: false,
      listItem: false,
      codeBlock: false,
    }),
    ManuscriptCodeBlock,
    ManuscriptHtmlBlock,
    ManuscriptBulletList,
    ManuscriptOrderedList,
    ManuscriptListItem,
    Markdown,
    TableKit.configure({
      table: false,
      // The stock table serializer pads every cell to its column width and
      // wraps the block in its own newlines; ours does neither.
      tableCell: {},
      tableHeader: {},
      tableRow: {},
    }),
    Table.extend({ renderMarkdown: renderManuscriptTable }).configure({ resizable: false }),
    ManuscriptTaskList,
    ManuscriptTaskItem.configure({ nested: true }),
    Image,
    Typography,
    Highlight,
    MinimalEscaping,
    MarkdownLinkTyping,
    CharacterCount,
    Placeholder.configure({
      placeholder: options.placeholder ?? 'Start writing…',
    }),
    FocusCurrentBlock,
    TypewriterScroll,
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

export interface DocumentMark {
  /** The highlighted text, trimmed for display. */
  text: string
  /** Document position where the highlighted range starts. */
  pos: number
}

/**
 * All `==highlight==` marks in document order — the author's "come back to
 * this" annotations, surfaced in the sidebar. Stored in the Markdown file
 * as `==...==` (Obsidian-compatible), so they survive any other editor.
 */
export function extractMarks(editor: Editor): DocumentMark[] {
  const marks: DocumentMark[] = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true
    if (node.marks.some((mark) => mark.type.name === 'highlight')) {
      const text = (node.text ?? '').trim()
      const last = marks[marks.length - 1]
      // Merge adjacent highlighted text nodes (e.g. bold inside a mark).
      if (last && pos <= last.pos + last.text.length + 1) {
        last.text += ` ${text}`
      } else if (text) {
        marks.push({ text, pos })
      }
    }
    return true
  })
  return marks
}

/** A run of text, and where it sits in both coordinate systems. */
interface TextRun {
  /** Offset of the run in the flattened text, in UTF-16 code units. */
  offset: number
  /** ProseMirror position where the run starts. */
  pos: number
  length: number
}

export interface ManuscriptText {
  /** The manuscript as the author sees it: one line per block, no syntax. */
  text: string
  runs: TextRun[]
}

/**
 * The manuscript flattened to plain text, with a map back to positions.
 *
 * Search reads this rather than the Markdown source on purpose. An author
 * looking for "the quick brown" expects to find it whether or not "quick" is
 * bold, and does not expect a hit inside a link's URL; the source would answer
 * both questions the other way round. The map is what makes the answer
 * actionable — a match arrives as an offset into `text` and has to become a
 * caret position, and nothing about that step is a second search.
 */
export function manuscriptText(editor: Editor): ManuscriptText {
  const runs: TextRun[] = []
  let text = ''
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      // Every block starts a line, so a line number means a block and a match
      // can never straddle two paragraphs.
      if (text.length > 0) text += '\n'
      return true
    }
    if (node.type.name === 'hardBreak') {
      text += '\n'
      return false
    }
    if (node.isText && node.text) {
      runs.push({ offset: text.length, pos, length: node.text.length })
      text += node.text
    }
    return true
  })
  return { text, runs }
}

/**
 * The ProseMirror position for an offset into `manuscriptText`.
 *
 * An offset that falls on a line break — between two blocks — resolves to the
 * start of the next run, which is where a reader would say the next line
 * begins.
 */
export function positionAtOffset(text: ManuscriptText, offset: number): number {
  for (const run of text.runs) {
    if (offset < run.offset) return run.pos
    if (offset < run.offset + run.length) return run.pos + (offset - run.offset)
  }
  const last = text.runs[text.runs.length - 1]
  return last ? last.pos + last.length : 0
}

/** Place the cursor at a document position and scroll it into view. */
export function revealPosition(editor: Editor, pos: number): void {
  editor.chain().focus().setTextSelection(pos).run()
  const dom = editor.view.domAtPos(pos).node
  const el = dom instanceof HTMLElement ? dom : dom.parentElement
  el?.scrollIntoView({ block: 'center' })
}
