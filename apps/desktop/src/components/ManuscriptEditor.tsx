import { EditorContent, useEditor } from '@tiptap/react'
import { manuscriptExtensions, type Editor } from '@essay/editor'
import { resolveImageSrc } from '#/lib/images'

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
const PLACEHOLDER = 'Begin anywhere.'

export function ManuscriptEditor({
  initialMarkdown,
  onReady,
  onChanged,
}: ManuscriptEditorProps) {
  const editor = useEditor({
    // resolveImageSrc is display-only plumbing (Tauri asset URLs for the
    // <img> tags); the document on disk keeps the author's own path bytes.
    extensions: manuscriptExtensions({ placeholder: PLACEHOLDER, resolveImageSrc }),
    content: initialMarkdown,
    contentType: 'markdown',
    editorProps: {
      // spellcheck is explicit, not inherited: the three WebViews disagree
      // about the default, and a product guarantee cannot rest on one
      // (docs/authoring-backlog.md item 2). The native checker is local and
      // offline; code blocks opt back out in @essay/editor's markdown-code.
      // `lang` is deliberately not set — the OS language services already
      // know the author's dictionaries better than a UA guess would.
      attributes: { class: 'essay-prose', spellcheck: 'true' },
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
