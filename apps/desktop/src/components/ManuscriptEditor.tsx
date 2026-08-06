import { EditorContent, useEditor } from '@tiptap/react'
import { manuscriptExtensions, type Editor } from '@essay/editor'

interface ManuscriptEditorProps {
  initialMarkdown: string
  /** Fires once when the editor instance exists. */
  onReady?: (editor: Editor) => void
  /** Fires after every document change from typing or commands. */
  onChanged?: (editor: Editor) => void
}

/**
 * What an empty page says. One line, drawn at mount, gone at the first
 * keystroke. Most are working instructions; a few are permission slips —
 * because the blank page is the one moment this application is allowed to
 * say something to the author, and "Start writing…" spends it saying
 * nothing. Kept to a handful and rotated so none of them wears out.
 */
const PLACEHOLDERS = [
  'Start writing…',
  'Say the thing.',
  'A first draft is allowed to be wrong.',
  'Nobody is watching yet.',
  'Start in the middle.',
  'Write it badly, then write it well.',
]

function pickPlaceholder(): string {
  return PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]
}

export function ManuscriptEditor({
  initialMarkdown,
  onReady,
  onChanged,
}: ManuscriptEditorProps) {
  const editor = useEditor({
    extensions: manuscriptExtensions({ placeholder: pickPlaceholder() }),
    content: initialMarkdown,
    contentType: 'markdown',
    editorProps: {
      attributes: { class: 'essay-prose' },
    },
    onCreate: ({ editor }) => {
      if (import.meta.env.DEV) {
        ;(window as Window & { __essay?: unknown }).__essay = { editor }
      }
      onReady?.(editor)
    },
    onUpdate: ({ editor }) => onChanged?.(editor),
  })

  return (
    <EditorContent
      editor={editor}
      className="h-full min-h-0 overflow-y-auto [scrollbar-gutter:stable]"
    />
  )
}
