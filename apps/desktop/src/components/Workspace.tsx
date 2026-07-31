import { useCallback, useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import {
  FilePlus,
  FloppyDisk,
  FolderOpen,
  SidebarSimple,
} from '@phosphor-icons/react'
import {
  extractOutline,
  revealHeading,
  wordCount,
  type Editor,
  type OutlineItem,
} from '@essay/editor'
import welcome from '#/content/welcome.md?raw'
import {
  openDocumentByPath,
  openDocumentFile,
  saveDocumentFile,
  type DocumentRef,
} from '#/lib/documentFile'
import { ManuscriptEditor } from './ManuscriptEditor'
import { Sidebar } from './Sidebar'
import { PrintPane } from './PrintPane'
import { IconButton } from './ui/icon-button'
import { Tip, TooltipProvider } from './ui/tooltip'

const UNTITLED: DocumentRef = { path: null, name: 'untitled.md' }

export function Workspace() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [docRef, setDocRef] = useState<DocumentRef>(UNTITLED)
  const [dirty, setDirty] = useState(false)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [words, setWords] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)

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

  const loadIntoEditor = useCallback(
    (editor: Editor, contents: string, ref: DocumentRef) => {
      editor.commands.setContent(contents, { contentType: 'markdown' })
      setDocRef(ref)
      setDirty(false)
      refreshStats(editor)
      editor.commands.focus('start')
    },
    [refreshStats],
  )

  /**
   * Leaving an unsaved document: saved files are written silently (the
   * local-first default); an untitled buffer asks before discarding.
   */
  const settleUnsaved = useCallback(async (): Promise<boolean> => {
    if (!editor || !dirty) return true
    if (docRef.path) {
      await saveDocumentFile(editor.getMarkdown(), docRef.path, docRef.name)
      return true
    }
    return window.confirm('Discard unsaved changes to the untitled document?')
  }, [editor, dirty, docRef])

  const newDocument = useCallback(async () => {
    if (!editor || !(await settleUnsaved())) return
    loadIntoEditor(editor, '', UNTITLED)
  }, [editor, settleUnsaved, loadIntoEditor])

  const openDocument = useCallback(async () => {
    if (!editor || !(await settleUnsaved())) return
    const opened = await openDocumentFile()
    if (!opened) return
    loadIntoEditor(editor, opened.contents, opened)
  }, [editor, settleUnsaved, loadIntoEditor])

  const openByPath = useCallback(
    async (path: string) => {
      if (!editor || path === docRef.path) return
      if (!(await settleUnsaved())) return
      const opened = await openDocumentByPath(path)
      if (!opened) return
      loadIntoEditor(editor, opened.contents, opened)
    },
    [editor, docRef.path, settleUnsaved, loadIntoEditor],
  )

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
        void newDocument()
      } else if (key === 'b') {
        event.preventDefault()
        setSidebarOpen((open) => !open)
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
    <TooltipProvider>
      <div className="grid h-screen grid-rows-[auto_minmax(0,1fr)_auto] bg-[var(--essay-bg)] text-[var(--essay-text)]">
        <header className="flex h-10 items-center gap-1 border-b border-[var(--essay-border)] px-2">
          <Tip
            label="Toggle sidebar"
            shortcut="Ctrl+B"
            trigger={
              <IconButton onClick={() => setSidebarOpen((open) => !open)}>
                <SidebarSimple size={16} />
              </IconButton>
            }
          />
          <div className="mx-1 flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-medium">
              {docRef.name}
            </span>
            {dirty && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--essay-accent)]"
                title="Unsaved changes"
              />
            )}
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            <Tip
              label="New document"
              shortcut="Ctrl+N"
              trigger={
                <IconButton onClick={() => void newDocument()}>
                  <FilePlus size={16} />
                </IconButton>
              }
            />
            <Tip
              label="Open file"
              shortcut="Ctrl+O"
              trigger={
                <IconButton onClick={() => void openDocument()}>
                  <FolderOpen size={16} />
                </IconButton>
              }
            />
            <Tip
              label="Save"
              shortcut="Ctrl+S"
              trigger={
                <IconButton onClick={() => void saveDocument()}>
                  <FloppyDisk size={16} />
                </IconButton>
              }
            />
          </div>
        </header>

        <div
          className={`grid min-h-0 ${
            sidebarOpen
              ? 'grid-cols-[248px_minmax(0,1fr)] lg:grid-cols-[248px_minmax(0,1fr)_minmax(280px,32%)]'
              : 'grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(280px,32%)]'
          }`}
        >
          {sidebarOpen && (
            <Sidebar
              outline={outline}
              onSelectOutline={(item) => {
                if (editor) revealHeading(editor, item.pos)
              }}
              onOpenFile={(path) => void openByPath(path)}
            />
          )}
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

        <footer className="flex h-7 items-center gap-3 border-t border-[var(--essay-border)] px-3 text-[11px] text-[var(--essay-text-faint)]">
          <span className="tabular-nums">{words} words</span>
          <span className="tabular-nums">{outline.length} sections</span>
          <span className="ml-auto">local · works offline</span>
        </footer>
      </div>
    </TooltipProvider>
  )
}
