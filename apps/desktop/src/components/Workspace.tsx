import { useCallback, useState } from 'react'
import {
  extractOutline,
  revealHeading,
  wordCount,
  type Editor,
  type OutlineItem,
} from '@essay/editor'
import welcome from '#/content/welcome.md?raw'
import { ManuscriptEditor } from './ManuscriptEditor'
import { StructurePane } from './StructurePane'
import { PrintPane } from './PrintPane'

export function Workspace() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [words, setWords] = useState(0)

  const handleEditorUpdate = useCallback((editor: Editor) => {
    setEditor(editor)
    setOutline(extractOutline(editor))
    setWords(wordCount(editor))
  }, [])

  // Rough estimate until the Typst pipeline reports real pages (Milestone 2).
  const pages = Math.max(1, Math.ceil(words / 350))

  return (
    <div className="grid h-screen grid-rows-[auto_minmax(0,1fr)_auto] bg-[var(--essay-bg)] text-[var(--essay-text)]">
      <header className="flex items-baseline gap-3 border-b border-[var(--essay-border)] px-4 py-2">
        <span className="text-sm font-semibold">Essay</span>
        <span className="text-sm text-[var(--essay-text-faint)]">
          welcome.md · draft
        </span>
      </header>

      <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[220px_minmax(0,1fr)_minmax(280px,34%)]">
        <StructurePane
          outline={outline}
          onSelect={(item) => {
            if (editor) revealHeading(editor, item.pos)
          }}
        />
        <main className="min-h-0 overflow-hidden">
          <ManuscriptEditor
            initialMarkdown={welcome}
            onEditorUpdate={handleEditorUpdate}
          />
        </main>
        <div className="hidden lg:block">
          <PrintPane words={words} pages={pages} />
        </div>
      </div>

      <footer className="flex gap-4 border-t border-[var(--essay-border)] px-4 py-1.5 text-xs text-[var(--essay-text-faint)]">
        <span>{words} words</span>
        <span>{outline.length} sections</span>
        <span className="ml-auto">local · works offline</span>
      </footer>
    </div>
  )
}
