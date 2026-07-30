import { EditorContent, useEditor } from '@tiptap/react'
import { manuscriptExtensions, type Editor } from '@essay/editor'

interface ManuscriptEditorProps {
  initialMarkdown: string
  /** Fires on create and after every document change with the live editor. */
  onEditorUpdate?: (editor: Editor) => void
}

export function ManuscriptEditor({
  initialMarkdown,
  onEditorUpdate,
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
      onEditorUpdate?.(editor)
    },
    onUpdate: ({ editor }) => onEditorUpdate?.(editor),
  })

  return (
    <EditorContent
      editor={editor}
      className="h-full min-h-0 overflow-y-auto [scrollbar-gutter:stable]"
    />
  )
}
