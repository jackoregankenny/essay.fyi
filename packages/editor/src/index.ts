/**
 * @essay/editor — the manuscript text surface.
 *
 * CodeMirror 6 is the text surface only. It is not the canonical document
 * model and not the revision database; those live in the Rust core
 * (essay-markdown, essay-revisions). This package must stay React-free so a
 * future host can embed it with its own chrome.
 */
import { EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  keymap,
  placeholder,
  rectangularSelection,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { tags } from '@lezer/highlight'

export { EditorView } from '@codemirror/view'
export { EditorState } from '@codemirror/state'

/**
 * Markdown syntax stays visible (source is canonical) but visually quiet:
 * marks and metadata recede, prose stays foregrounded.
 */
const manuscriptHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.45em', fontWeight: '650' },
  { tag: tags.heading2, fontSize: '1.25em', fontWeight: '650' },
  { tag: tags.heading3, fontSize: '1.1em', fontWeight: '650' },
  { tag: tags.heading4, fontWeight: '650' },
  { tag: tags.heading5, fontWeight: '650' },
  { tag: tags.heading6, fontWeight: '650' },
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--essay-accent)' },
  { tag: tags.url, color: 'var(--essay-text-faint)' },
  { tag: tags.quote, color: 'var(--essay-text-muted)', fontStyle: 'italic' },
  {
    tag: tags.monospace,
    fontFamily: 'var(--essay-font-mono)',
    fontSize: '0.9em',
  },
  { tag: tags.processingInstruction, color: 'var(--essay-text-faint)' },
  { tag: tags.meta, color: 'var(--essay-text-faint)' },
  { tag: tags.contentSeparator, color: 'var(--essay-text-faint)' },
  { tag: tags.comment, color: 'var(--essay-text-faint)', fontStyle: 'italic' },
])

const manuscriptTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--essay-editor-font-size)',
    color: 'var(--essay-text)',
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--essay-font-prose)',
    lineHeight: '1.75',
  },
  '.cm-content': {
    maxWidth: 'var(--essay-measure)',
    margin: '0 auto',
    padding: '3.5rem 1.5rem 45vh',
    caretColor: 'var(--essay-text)',
  },
  '.cm-cursor': { borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--essay-selection) !important',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--essay-selection-match)' },
  '.cm-placeholder': { color: 'var(--essay-text-faint)' },
})

export interface ManuscriptEditorOptions {
  parent: HTMLElement
  doc?: string
  placeholder?: string
  /** Called with the full source after every document change. */
  onDocChanged?: (doc: string) => void
  /** Host-supplied extensions (diff decorations, comments, …) appended last. */
  extensions?: Extension[]
}

export function createManuscriptEditor(
  options: ManuscriptEditorOptions,
): EditorView {
  const extensions: Extension[] = [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    highlightSpecialChars(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(manuscriptHighlight),
    manuscriptTheme,
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
  ]

  if (options.placeholder) {
    extensions.push(placeholder(options.placeholder))
  }
  if (options.onDocChanged) {
    const notify = options.onDocChanged
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) notify(update.state.doc.toString())
      }),
    )
  }
  if (options.extensions) {
    extensions.push(...options.extensions)
  }

  return new EditorView({
    state: EditorState.create({ doc: options.doc ?? '', extensions }),
    parent: options.parent,
  })
}

/** Move the cursor to a 1-based line and scroll it near the top of the view. */
export function revealLine(view: EditorView, lineNumber: number): void {
  const line = view.state.doc.line(
    Math.min(Math.max(lineNumber, 1), view.state.doc.lines),
  )
  view.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 80 }),
  })
  view.focus()
}
