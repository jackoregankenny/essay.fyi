import { useMemo, useRef, useState } from 'react'
import { revealLine, type EditorView } from '@essay/editor'
import welcome from '#/content/welcome.md?raw'
import { countWords, estimatePages, extractOutline } from '#/lib/outline'
import { ManuscriptEditor } from './ManuscriptEditor'
import { StructurePane } from './StructurePane'
import { PrintPane } from './PrintPane'

export function Workspace() {
  const viewRef = useRef<EditorView | null>(null)
  const [doc, setDoc] = useState(welcome)

  const outline = useMemo(() => extractOutline(doc), [doc])
  const words = useMemo(() => countWords(doc), [doc])
  const pages = estimatePages(words)

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
            if (viewRef.current) revealLine(viewRef.current, item.line)
          }}
        />
        <main className="min-h-0 overflow-hidden">
          <ManuscriptEditor
            initialDoc={welcome}
            onDocChanged={setDoc}
            onReady={(view) => {
              viewRef.current = view
            }}
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
