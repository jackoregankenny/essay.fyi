import { useCallback, useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import {
  extractOutline,
  revealHeading,
  wordCount,
  type Editor,
  type OutlineItem,
} from '@essay/editor'
import welcome from '#/content/welcome.md?raw'
import {
  openDocumentFile,
  saveDocumentFile,
  type DocumentRef,
} from '#/lib/documentFile'
import { ManuscriptEditor } from './ManuscriptEditor'
import { StructurePane } from './StructurePane'
import { PrintPane } from './PrintPane'

const UNTITLED: DocumentRef = { path: null, name: 'untitled.md' }

export function Workspace() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [docRef, setDocRef] = useState<DocumentRef>(UNTITLED)
  const [dirty, setDirty] = useState(false)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [words, setWords] = useState(0)

  const refreshStats = useCallback((editor: Editor) => {
    setOutline(extractOutline(editor))
    setWords(wordCount(editor))
  }, [])

  const handleReady = useCallback(
    (editor: Editor) => {
      setEditor(editor)
      refreshStats(editor)
    },
    [refreshStats],
  )

  const handleChanged = useCallback(
    (editor: Editor) => {
      setDirty(true)
      refreshStats(editor)
    },
    [refreshStats],
  )

  const newDocument = useCallback(() => {
    if (!editor) return
    editor.commands.setContent('', { contentType: 'markdown' })
    setDocRef(UNTITLED)
    setDirty(false)
    refreshStats(editor)
    editor.commands.focus('start')
  }, [editor, refreshStats])

  const openDocument = useCallback(async () => {
    if (!editor) return
    const opened = await openDocumentFile()
    if (!opened) return
    editor.commands.setContent(opened.contents, { contentType: 'markdown' })
    setDocRef({ path: opened.path, name: opened.name })
    setDirty(false)
    refreshStats(editor)
    editor.commands.focus('start')
  }, [editor, refreshStats])

  const saveDocument = useCallback(
    async (saveAs = false) => {
      if (!editor) return
      const saved = await saveDocumentFile(
        editor.getMarkdown(),
        saveAs ? null : docRef.path,
        docRef.name,
      )
      if (!saved) return
      setDocRef(saved)
      setDirty(false)
    },
    [editor, docRef],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'o') {
        event.preventDefault()
        void openDocument()
      } else if (key === 's') {
        event.preventDefault()
        void saveDocument(event.shiftKey)
      } else if (key === 'n') {
        event.preventDefault()
        newDocument()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openDocument, saveDocument, newDocument])

  useEffect(() => {
    const title = `${docRef.name}${dirty ? ' •' : ''} — Essay`
    document.title = title
    if (isTauri()) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow().setTitle(title),
      )
    }
  }, [docRef, dirty])

  // Rough estimate until the Typst pipeline reports real pages (Milestone 2).
  const pages = Math.max(1, Math.ceil(words / 350))

  return (
    <div className="grid h-screen grid-rows-[auto_minmax(0,1fr)_auto] bg-[var(--essay-bg)] text-[var(--essay-text)]">
      <header className="flex items-baseline gap-3 border-b border-[var(--essay-border)] px-4 py-2">
        <span className="text-sm font-semibold">Essay</span>
        <span className="text-sm text-[var(--essay-text-faint)]">
          {docRef.name}
          {dirty && (
            <span className="ml-1.5 text-[var(--essay-accent)]" title="Unsaved changes">
              •
            </span>
          )}
        </span>
        <nav className="ml-auto flex gap-1 text-sm">
          <HeaderButton label="New" shortcut="Ctrl+N" onClick={newDocument} />
          <HeaderButton
            label="Open"
            shortcut="Ctrl+O"
            onClick={() => void openDocument()}
          />
          <HeaderButton
            label="Save"
            shortcut="Ctrl+S"
            onClick={() => void saveDocument()}
          />
        </nav>
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
            onReady={handleReady}
            onChanged={handleChanged}
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

function HeaderButton({
  label,
  shortcut,
  onClick,
}: {
  label: string
  shortcut: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={shortcut}
      className="rounded px-2 py-0.5 text-[var(--essay-text-muted)] hover:bg-[var(--essay-surface)] hover:text-[var(--essay-text)]"
    >
      {label}
    </button>
  )
}
