import { useCallback, useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { SidebarSimple } from '@phosphor-icons/react'
import {
  extractMarks,
  extractOutline,
  revealHeading,
  revealPosition,
  setFocusMode,
  wordCount,
  type DocumentMark,
  type Editor,
  type OutlineItem,
} from '@essay/editor'
import { registerCommand, type Command } from '@essay/commands'
import welcome from '#/content/welcome.md?raw'
import { cn } from '#/lib/cn'
import {
  exportPdfFile,
  openDocumentByPath,
  openDocumentFile,
  saveDocumentFile,
  type DocumentRef,
} from '#/lib/documentFile'
import { documentDir, usePreview } from '#/lib/usePreview'
import { CommandPalette } from './CommandPalette'
import { FilesPopover } from './FilesPopover'
import { ManuscriptEditor } from './ManuscriptEditor'
import { SelectionToolbar } from './SelectionToolbar'
import { Sidebar } from './Sidebar'
import { PrintPane } from './PrintPane'
import { IconButton } from './ui/icon-button'
import { Tip, TooltipProvider } from './ui/tooltip'

const UNTITLED: DocumentRef = { path: null, name: 'untitled.md' }

type ViewMode = 'write' | 'preview'

export function Workspace() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [docRef, setDocRef] = useState<DocumentRef>(UNTITLED)
  const [dirty, setDirty] = useState(false)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [words, setWords] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [focusMode, setFocusModeState] = useState(false)
  const [mode, setMode] = useState<ViewMode>('write')
  const [marks, setMarks] = useState<DocumentMark[]>([])
  const [caretPos, setCaretPos] = useState(0)
  const [renderVersion, setRenderVersion] = useState(0)

  const refreshStats = useCallback((editor: Editor) => {
    setOutline(extractOutline(editor))
    setWords(wordCount(editor))
    setMarks(extractMarks(editor))
    setRenderVersion((v) => v + 1)
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
      setMode('write')
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

  const exportPdf = useCallback(async () => {
    if (!editor) return
    await exportPdfFile(
      editor.getMarkdown(),
      docRef.name,
      documentDir(docRef.path),
    )
  }, [editor, docRef])

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
      } else if (key === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      } else if (key === 'j') {
        event.preventDefault()
        setMode((m) => (m === 'write' ? 'preview' : 'write'))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openDocument, saveDocument, newDocument])

  useEffect(() => {
    if (editor) setFocusMode(editor, focusMode)
  }, [editor, focusMode])

  // Caret tracking for the outline scroll-spy (which section am I in?).
  useEffect(() => {
    if (!editor) return
    const onSelection = () => setCaretPos(editor.state.selection.head)
    editor.on('selectionUpdate', onSelection)
    return () => {
      editor.off('selectionUpdate', onSelection)
    }
  }, [editor])

  const preview = usePreview(
    editor,
    documentDir(docRef.path),
    mode === 'preview',
    renderVersion,
  )

  // The palette reads this registry; File/View/Format/Insert all live here
  // so future surfaces (menus, buttons) share one source of truth.
  useEffect(() => {
    if (!editor) return
    const chain = () => editor.chain().focus()
    const commands: Command[] = [
      { id: 'file.new', title: 'New document', group: 'File', shortcut: 'Ctrl+N', run: () => void newDocument() },
      { id: 'file.open', title: 'Open file…', group: 'File', shortcut: 'Ctrl+O', run: () => void openDocument() },
      { id: 'file.save', title: 'Save', group: 'File', shortcut: 'Ctrl+S', run: () => void saveDocument() },
      { id: 'file.saveAs', title: 'Save as…', group: 'File', shortcut: 'Ctrl+Shift+S', run: () => void saveDocument(true) },
      { id: 'file.exportPdf', title: 'Export PDF…', group: 'File', keywords: 'typeset print render', run: () => void exportPdf() },
      { id: 'view.preview', title: 'Toggle preview', group: 'View', shortcut: 'Ctrl+J', keywords: 'typeset pages print render', run: () => setMode((m) => (m === 'write' ? 'preview' : 'write')) },
      { id: 'view.sidebar', title: 'Toggle sidebar', group: 'View', shortcut: 'Ctrl+B', run: () => setSidebarOpen((open) => !open) },
      { id: 'view.focus', title: 'Toggle focus mode', group: 'View', keywords: 'zen typewriter dim centre center', run: () => setFocusModeState((on) => !on) },
      { id: 'view.dark', title: 'Toggle dark mode', group: 'View', keywords: 'theme light appearance', run: () => {
        const root = document.documentElement
        if (root.dataset.theme === 'dark') delete root.dataset.theme
        else root.dataset.theme = 'dark'
      } },
      { id: 'format.h1', title: 'Heading 1', group: 'Format', keywords: 'title turn into', run: () => { chain().toggleHeading({ level: 1 }).run() } },
      { id: 'format.h2', title: 'Heading 2', group: 'Format', keywords: 'section turn into', run: () => { chain().toggleHeading({ level: 2 }).run() } },
      { id: 'format.h3', title: 'Heading 3', group: 'Format', keywords: 'subsection turn into', run: () => { chain().toggleHeading({ level: 3 }).run() } },
      { id: 'format.paragraph', title: 'Text', group: 'Format', keywords: 'paragraph body normal', run: () => { chain().setParagraph().run() } },
      { id: 'format.quote', title: 'Quote', group: 'Format', keywords: 'blockquote', run: () => { chain().toggleBlockquote().run() } },
      { id: 'format.codeBlock', title: 'Code block', group: 'Format', run: () => { chain().toggleCodeBlock().run() } },
      { id: 'format.highlight', title: 'Mark to come back to', group: 'Format', keywords: 'highlight revisit note comeback', run: () => { chain().toggleHighlight().run() } },
      { id: 'insert.table', title: 'Insert table', group: 'Insert', run: () => { chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() } },
      { id: 'insert.taskList', title: 'Insert task list', group: 'Insert', keywords: 'todo checkbox', run: () => { chain().toggleTaskList().run() } },
      { id: 'insert.divider', title: 'Insert section break', group: 'Insert', keywords: 'horizontal rule divider hr', run: () => { chain().setHorizontalRule().run() } },
    ]
    const unregister = commands.map(registerCommand)
    return () => unregister.forEach((fn) => fn())
  }, [editor, newDocument, openDocument, saveDocument, exportPdf])

  useEffect(() => {
    const title = `${docRef.name}${dirty ? ' •' : ''} — Essay`
    document.title = title
    if (isTauri()) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow().setTitle(title),
      )
    }
  }, [docRef, dirty])

  const activeOutlinePos = outline.reduce<number | null>(
    (active, item) => (item.pos <= caretPos ? item.pos : active),
    null,
  )

  return (
    <TooltipProvider>
      <div className="grid h-screen grid-rows-[auto_minmax(0,1fr)_auto] bg-[var(--essay-bg)] text-[var(--essay-text)]">
        <header className="grid h-10 grid-cols-[1fr_auto_1fr] items-center border-b border-[var(--essay-border)] px-2">
          <div className="flex min-w-0 items-center gap-1">
            <Tip
              label="Toggle sidebar"
              shortcut="Ctrl+B"
              trigger={
                <IconButton onClick={() => setSidebarOpen((open) => !open)}>
                  <SidebarSimple size={16} />
                </IconButton>
              }
            />
            <FilesPopover
              docName={docRef.name}
              dirty={dirty}
              onOpenFile={(path) => void openByPath(path)}
            />
          </div>

          <ModeSwitch mode={mode} onChange={setMode} />

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              title="Command palette"
              className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[var(--essay-text-muted)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
            >
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </button>
          </div>
        </header>

        <div
          className={`grid min-h-0 ${
            sidebarOpen ? 'grid-cols-[232px_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)]'
          }`}
        >
          {sidebarOpen && (
            <Sidebar
              outline={outline}
              activePos={activeOutlinePos}
              marks={marks}
              onSelectOutline={(item) => {
                setMode('write')
                if (editor) revealHeading(editor, item.pos)
              }}
              onSelectMark={(mark) => {
                setMode('write')
                if (editor) revealPosition(editor, mark.pos)
              }}
            />
          )}
          <main className="relative min-h-0 overflow-hidden bg-[var(--essay-editor-bg)]">
            <div className={mode === 'preview' ? 'hidden' : 'h-full'}>
              <ManuscriptEditor
                initialMarkdown={welcome}
                onReady={handleReady}
                onChanged={handleChanged}
              />
              {editor && <SelectionToolbar editor={editor} />}
            </div>
            {mode === 'preview' && <PrintPane preview={preview} />}
          </main>
        </div>

        <footer className="flex h-7 items-center gap-3 border-t border-[var(--essay-border)] px-3 text-[11px] text-[var(--essay-text-faint)]">
          <span className="tabular-nums">{words} words</span>
          <span className="tabular-nums">{outline.length} sections</span>
          {mode === 'preview' && preview.pageCount > 0 && (
            <span className="tabular-nums">{preview.pageCount} pages</span>
          )}
          {focusMode && (
            <button
              type="button"
              onClick={() => setFocusModeState(false)}
              className="text-[var(--essay-accent)]"
              title="Focus mode is on — click to turn off"
            >
              focus
            </button>
          )}
          <span className="ml-auto">local · works offline</span>
        </footer>

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          outline={outline}
          onJumpToSection={(item) => {
            setMode('write')
            if (editor) revealHeading(editor, item.pos)
          }}
        />
      </div>
    </TooltipProvider>
  )
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}) {
  return (
    <div className="flex h-7 items-center gap-0.5 rounded-lg bg-[var(--essay-surface-hover)] p-0.5">
      {(['write', 'preview'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            'h-6 rounded-md px-3 text-[12px] font-[510] capitalize transition-colors duration-100',
            mode === m
              ? 'bg-[var(--essay-bg)] text-[var(--essay-text)] shadow-[var(--essay-shadow-low)]'
              : 'text-[var(--essay-text-muted)] hover:text-[var(--essay-text)]',
          )}
        >
          {m}
        </button>
      ))}
    </div>
  )
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-[var(--essay-border)] bg-[var(--essay-surface-hover)] px-1 font-[var(--essay-font-ui)] text-[10px] font-[510]">
      {children}
    </kbd>
  )
}
