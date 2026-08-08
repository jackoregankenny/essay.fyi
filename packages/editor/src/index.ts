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
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table, TableKit } from '@tiptap/extension-table'

import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import { CharacterCount, Placeholder } from '@tiptap/extensions'

import { DecorationLayers } from './decorations'
import { ManuscriptImage } from './image'
import { ManuscriptTableEditing } from './table-editing'
import { ManuscriptCodeBlock } from './markdown-code'
import { MinimalEscaping } from './markdown-escapes'
import { ManuscriptHtmlBlock } from './markdown-html'
import { ManuscriptHtmlInline } from './markdown-html-inline'
import {
  ManuscriptBulletList,
  ManuscriptListItem,
  ManuscriptOrderedList,
  ManuscriptTaskItem,
  ManuscriptTaskList,
} from './markdown-lists'
import { renderManuscriptTable } from './markdown-tables'

export type { Editor } from '@tiptap/core'

export { ManuscriptImage, type ManuscriptImageOptions } from './image'
export {
  ManuscriptTableEditing,
  cellSelectionTsv,
  parseTsv,
  pasteTsv,
  type ColumnAlign,
} from './table-editing'

export {
  clearFrontMatter,
  getManuscript,
  setManuscript,
  splitFrontMatter,
  type SplitManuscript,
} from './frontmatter'

export {
  clearDecorationLayer,
  decorationLayerRanges,
  setDecorationLayer,
  DECORATION_LAYERS,
  type DecorationLayer,
  type DecorationRange,
} from './decorations'

export {
  findInText,
  findMatches,
  foldText,
  FindController,
  type FindChangeCause,
  type FindMatch,
  type FindOptions,
  type FindState,
} from './find'

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

/** The one in-flight glide per scroller, so a retarget cancels rather than
    stacks — two animations fighting over scrollTop is a shake, not a glide. */
const glides = new WeakMap<HTMLElement, number>()

/**
 * Ease the pane to `target` rather than snapping it. The typewriter's small
 * moves (a line wrap, one Enter) become a short settle; a caret clicked to
 * the far end of the document arrives on the same curve. Sub-2px deltas are
 * set directly — animating them would keep a rAF loop alive under plain
 * typing for movement nobody can see. Reduced motion gets the old behaviour:
 * the centring is the feature, the glide is the garnish.
 */
function glideTo(scroller: HTMLElement, target: number): void {
  const prev = glides.get(scroller)
  if (prev !== undefined) cancelAnimationFrame(prev)
  const from = scroller.scrollTop
  const delta = target - from
  if (
    Math.abs(delta) < 2 ||
    (typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  ) {
    glides.delete(scroller)
    scroller.scrollTop = target
    return
  }
  const DURATION = 140
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min((now - start) / DURATION, 1)
    const eased = 1 - Math.pow(1 - t, 3)
    scroller.scrollTop = from + delta * eased
    if (t < 1) glides.set(scroller, requestAnimationFrame(step))
    else glides.delete(scroller)
  }
  glides.set(scroller, requestAnimationFrame(step))
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
  glideTo(scroller, scroller.scrollTop + caretMiddle - (rect.top + rect.height / 2))
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
            // A range selection is the author reaching away from the caret.
            // Recentering underneath a Shift-selection or mouse drag fights
            // the gesture and makes the selection toolbar chase the pointer.
            if (!view.state.selection.empty) return
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

interface FocusBlockState {
  /** Whether focus mode is on — set by `setFocusMode` via transaction meta. */
  on: boolean
  /** Top-level child index of the block holding the caret, or null when the
      selection sits between blocks (gap cursor). */
  index: number | null
  decos: DecorationSet
}

const focusBlockKey = new PluginKey<FocusBlockState>('essayFocusCurrentBlock')

/**
 * The decorations for one caret position: the current block, and — only in
 * focus mode — its neighbours graded by distance. Five node decorations at
 * most, whatever the document's length; everything past ±2 is left bare and
 * falls to the base dim in prose.css, so a long manuscript costs the same
 * as a short one.
 */
function focusBlockDecorations(
  doc: ProseMirrorNode,
  current: number | null,
  on: boolean,
): DecorationSet {
  if (current === null) return DecorationSet.empty
  const decos: Decoration[] = []
  doc.forEach((node, offset, i) => {
    const distance = Math.abs(i - current)
    if (distance === 0) {
      decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'is-current-block' }))
    } else if (on && distance <= 2) {
      decos.push(
        Decoration.node(offset, offset + node.nodeSize, {
          class: distance === 1 ? 'focus-d1' : 'focus-d2',
        }),
      )
    }
  })
  return DecorationSet.create(doc, decos)
}

/**
 * Marks the top-level block containing the caret with `.is-current-block`,
 * and in focus mode grades its neighbours (`.focus-d1`, `.focus-d2`) so the
 * dim falls off with distance instead of switching. Inert on its own — the
 * classes do nothing until the host toggles `.is-focus-mode` (setFocusMode)
 * and prose.css reads them.
 *
 * Perf shape (invariant 5): the decoration set lives in plugin state and is
 * rebuilt only when the caret crosses into a different top-level block —
 * `$head.index(0)` is the whole test, and it moves when a block above is
 * added or removed too, so the test doubles as structural change detection.
 * A keystroke inside the current block maps the existing set through the
 * transaction instead; mapping is position arithmetic, no doc walk, no
 * layout read.
 */
const FocusCurrentBlock = Extension.create({
  name: 'essayFocusCurrentBlock',
  addProseMirrorPlugins() {
    return [
      new Plugin<FocusBlockState>({
        key: focusBlockKey,
        state: {
          init(_config, state) {
            const { $head } = state.selection
            const index = $head.depth === 0 ? null : $head.index(0)
            return { on: false, index, decos: focusBlockDecorations(state.doc, index, false) }
          },
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(focusBlockKey) as boolean | undefined
            const on = meta ?? value.on
            const { $head } = newState.selection
            const index = $head.depth === 0 ? null : $head.index(0)
            if (meta === undefined && index === value.index) {
              // Same block, same mode: typing. Map, never rebuild.
              return tr.docChanged
                ? { ...value, decos: value.decos.map(tr.mapping, tr.doc) }
                : value
            }
            return { on, index, decos: focusBlockDecorations(newState.doc, index, on) }
          },
        },
        props: {
          decorations(state) {
            return focusBlockKey.getState(state)?.decos ?? null
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
 * Dim everything except the caret's neighbourhood — a gradient of attention,
 * not a switch — and keep the caret line vertically centred (typewriter
 * scrolling).
 *
 * Chrome hook for the host: alongside `.is-focus-mode` on the editor DOM,
 * this sets/removes `data-focus-mode` on `document.documentElement`. The app
 * shell can key on `:root[data-focus-mode]` to quiet its own chrome (header,
 * gutter, companion) while the author is in focus; the shell's styling is the
 * shell's business — the attribute is the whole contract.
 */
export function setFocusMode(editor: Editor, on: boolean): void {
  editor.view.dom.classList.toggle('is-focus-mode', on)
  document.documentElement.toggleAttribute('data-focus-mode', on)
  // Tell FocusCurrentBlock so it starts/stops grading neighbours; when
  // focus is off it decorates only the current block, exactly as before.
  editor.view.dispatch(editor.state.tr.setMeta(focusBlockKey, on))
  if (on) centerCaret(editor.view)
}

export interface ManuscriptOptions {
  placeholder?: string
  /** Display-only: turn a Markdown image src into something the webview can
      load (Tauri's asset protocol). The serialized document keeps the
      author's bytes — resolution never reaches the file. */
  resolveImageSrc?: (src: string) => string
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
    ManuscriptHtmlInline,
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
    // renderWrapper emits the <div class="tableWrapper"> that prose.css's
    // wide-table overflow rules hang off; serialization is untouched by it.
    Table.extend({ renderMarkdown: renderManuscriptTable }).configure({
      resizable: false,
      renderWrapper: true,
    }),
    ManuscriptTableEditing,
    ManuscriptTaskList,
    ManuscriptTaskItem.configure({ nested: true }),
    ManuscriptImage.configure(
      options.resolveImageSrc ? { resolveSrc: options.resolveImageSrc } : {},
    ),
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
    DecorationLayers,
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

export interface DocumentTask {
  /** Task text as it appears in the manuscript. */
  text: string
  /** Position of the task item node. */
  pos: number
  checked: boolean
}

/**
 * Task-list items in document order. The checkbox remains ordinary Markdown
 * (`- [ ]` / `- [x]`); this is only a live index over the editor document so
 * Structure can surface open work in a long manuscript.
 */
export function extractTasks(editor: Editor): DocumentTask[] {
  const tasks: DocumentTask[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'taskItem') return true
    tasks.push({
      text: node.textContent.trim() || 'Untitled task',
      pos,
      checked: Boolean(node.attrs.checked),
    })
    return false
  })
  return tasks
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

/**
 * The offset into `manuscriptText` for a ProseMirror position — the inverse
 * of `positionAtOffset`. A position that falls between blocks (on no run's
 * text) resolves to the start of the next run, mirroring the inverse's rule
 * for a line break; a position past the last run clamps to the text's end.
 */
export function offsetAtPosition(text: ManuscriptText, pos: number): number {
  let end = 0
  for (const run of text.runs) {
    if (pos < run.pos) return run.offset
    if (pos <= run.pos + run.length) return run.offset + (pos - run.pos)
    end = run.offset + run.length
  }
  return end
}

export interface ManuscriptSection {
  /** Heading depth, 1–6. */
  level: number
  text: string
  /** Zero-based occurrence among headings sharing this text and level —
      what tells two `## Methods` sections apart. */
  ordinal: number
  /** ProseMirror position of the heading node. */
  pos: number
  /** UTF-16 range over the flattened text: heading included, running to the
      next heading of any depth or the end of the document. */
  from: number
  to: number
}

/**
 * The outline restated in the flattened text's coordinates — the section
 * spans a range anchor records and reconciles against (essay-context). The
 * preamble before the first heading is deliberately in no section: an anchor
 * there records no section refs, and that absence is meaningful.
 */
export function manuscriptSections(
  editor: Editor,
  text: ManuscriptText = manuscriptText(editor),
): ManuscriptSection[] {
  const outline = extractOutline(editor)
  const seen = new Map<string, number>()
  return outline.map((item, i) => {
    const key = `${item.level} ${item.text}`
    const ordinal = seen.get(key) ?? 0
    seen.set(key, ordinal + 1)
    const next = outline[i + 1]
    return {
      level: item.level,
      text: item.text,
      ordinal,
      pos: item.pos,
      from: offsetAtPosition(text, item.pos),
      to: next ? offsetAtPosition(text, next.pos) : text.text.length,
    }
  })
}

/** Place the cursor at a document position and scroll it into view. */
export function revealPosition(editor: Editor, pos: number): void {
  editor.chain().focus().setTextSelection(pos).run()
  const dom = editor.view.domAtPos(pos).node
  const el = dom instanceof HTMLElement ? dom : dom.parentElement
  el?.scrollIntoView({ block: 'center' })
}
