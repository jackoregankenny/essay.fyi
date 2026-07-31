import { EditorContent, useEditor } from '@tiptap/react'
import { manuscriptExtensions, type Editor } from '@essay/editor'

interface ManuscriptEditorProps {
  initialMarkdown: string
  /** Fires once when the editor instance exists. */
  onReady?: (editor: Editor) => void
  /** Fires after every document change from typing or commands. */
  onChanged?: (editor: Editor) => void
}

export function ManuscriptEditor({
  initialMarkdown,
  onReady,
  onChanged,
}: ManuscriptEditorProps) {
  const editor = useEditor({
    extensions: manuscriptExtensions(),
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
