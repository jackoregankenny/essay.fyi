/**
 * YAML front matter, held aside rather than edited.
 *
 * The manuscript surface parses Markdown with `marked`, which has no notion of
 * front matter. Left to itself it reads the opening `---` as a thematic break
 * and the closing one as a setext underline, so a block like
 *
 *     ---
 *     title: A Memo
 *     ---
 *
 * comes back from the editor as `---\n\n## title: A Memo`. That is not a
 * display glitch: it is the author's metadata destroyed on the next autosave.
 *
 * So the front matter never reaches the editor at all. It is split off on the
 * way in, kept verbatim against the editor instance, and put back byte for
 * byte on the way out — which satisfies invariant 2 far more strictly than
 * round-tripping it through a parser ever could.
 *
 * The cost is that front matter is currently invisible and uneditable in the
 * manuscript. That is the right trade against corrupting it, but it is a
 * placeholder: the proper answer is a dedicated, non-prose block in the
 * surface.
 */

import type { Editor } from '@tiptap/core'

/**
 * Opening `---` on the first line, a body, and a closing `---` on its own
 * line. Anchored to the start of the document — a `---` further down is a
 * thematic break and must stay one.
 *
 * The trailing blank lines are part of the match on purpose. Anything handed
 * to the editor that begins with whitespace has it stripped by the parser, so
 * the blank line separating metadata from prose has to be kept on this side
 * of the split or it is silently lost on the first save.
 */
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---([ \t]*\r?\n)*/

export interface SplitManuscript {
  /** Delimiters, body and the blank lines after it — or '' when there is none. */
  frontMatter: string
  /** Everything the editor is allowed to see. */
  body: string
}

export function splitFrontMatter(source: string): SplitManuscript {
  const match = source.match(FRONT_MATTER)
  if (!match) return { frontMatter: '', body: source }
  return { frontMatter: match[0], body: source.slice(match[0].length) }
}

/**
 * Per-editor store. A WeakMap so a discarded editor takes its metadata with
 * it, and so nothing has to be threaded through the host's state.
 */
interface Held {
  frontMatter: string
  /** Whether the file ended with a newline. The serializer does not emit one,
      so without this every save strips the author's final newline — small,
      but it is a diff line on a document nobody edited. */
  trailingNewline: string
  /** The file's line ending. The serializer emits LF regardless, so a CRLF
      document would come back with every single line changed. */
  crlf: boolean
}

const held = new WeakMap<Editor, Held>()

/** Load a manuscript, keeping any front matter out of the editor. */
export function setManuscript(
  editor: Editor,
  source: string,
  options: { emitUpdate?: boolean } = {},
): void {
  const { frontMatter, body } = splitFrontMatter(source)
  held.set(editor, {
    frontMatter,
    trailingNewline: body.match(/(\r?\n)+$/)?.[0] ?? '',
    // Decided on the body alone: the front matter is restored verbatim and
    // has no say in how the prose after it is written.
    crlf: /\r\n/.test(body),
  })
  editor.commands.setContent(body, {
    contentType: 'markdown',
    emitUpdate: options.emitUpdate ?? false,
  })
}

/**
 * Serialize the manuscript, restoring the front matter exactly as it arrived.
 *
 * Every caller that used to reach for `editor.getMarkdown()` must come here
 * instead — autosave, the journal, the diff, the preview. A single one that
 * does not is a path that silently drops the author's metadata.
 */
export function getManuscript(editor: Editor): string {
  const kept = held.get(editor)
  const serialized = editor.getMarkdown()
  if (!kept) return serialized
  const body = kept.crlf ? serialized.replace(/\r?\n/g, '\r\n') : serialized
  // Only restore the trailing newline onto a body that still has content;
  // a document emptied to nothing should be empty, not a stray blank line.
  const tail = body.length > 0 ? kept.trailingNewline : ''
  return kept.frontMatter + body + tail
}

/** Forget any held front matter — for a new, empty document. */
export function clearFrontMatter(editor: Editor): void {
  held.delete(editor)
}
