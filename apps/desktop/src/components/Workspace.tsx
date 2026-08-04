import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { Robot, SidebarSimple } from '@phosphor-icons/react'
import {
  extractMarks,
  extractOutline,
  getManuscript,
  manuscriptText,
  positionAtOffset,
  revealHeading,
  revealPosition,
  setFocusMode,
  setManuscript,
  wordCount,
  type DocumentMark,
  type Editor,
  type OutlineItem,
} from '@essay/editor'
import { registerCommand, type Command } from '@essay/commands'
import welcome from '#/content/welcome.md?raw'
import { samePath, type AppliedEdit, type ChangeSet } from '#/lib/agents'
import { cn } from '#/lib/cn'
import { diffDocuments, looksLikeARewrite } from '#/lib/diff'
import {
  clearJournal,
  closeDocument,
  exportPdfFile,
  journalBuffer,
  onExternalChange,
  openDocumentByPath,
  openDocumentFile,
  pendingRecovery,
  saveDocumentFile,
  type DocumentRef,
  type RecoverableBuffer,
} from '#/lib/documentFile'
import {
  loadMeasure,
  measureLabel,
  measureWidth,
  nextMeasure,
  saveMeasure,
  type MeasureId,
} from '#/lib/measure'
import {
  commandKey,
  isMac,
  shortcut,
  TRAFFIC_LIGHT_INSET,
} from '#/lib/platform'
import {
  authorLabel,
  checkpointDocument,
  originLabel,
  restoreRevision,
  revisionSource,
  revisionTime,
  type Revision,
} from '#/lib/revisions'
import {
  documentLabel,
  searchDocument,
  searchProject,
} from '#/lib/search'
import { documentDir, usePreview } from '#/lib/usePreview'
import { loadWorkspaceFolders } from '#/lib/workspace'
import { AgentPanel } from './AgentPanel'
import { CommandPalette, type SearchEntry } from './CommandPalette'
import type { ReviewRequest } from './DiffReview'
import { DocumentTabs, type OpenTab } from './DocumentTabs'
import { FilesPopover } from './FilesPopover'
import { ManuscriptEditor } from './ManuscriptEditor'
import { MeasureSelect } from './MeasureSelect'
import { DocName, Notice } from './Notice'
import { SelectionToolbar } from './SelectionToolbar'
import { Sidebar } from './Sidebar'
import { UpdateButton } from './UpdateButton'
import { IconButton } from './ui/icon-button'
import { Tip, TooltipProvider } from './ui/tooltip'
import { WindowControls } from './ui/window-controls'

/**
 * Surfaces that are absent until the author asks for one, so they are absent
 * from the chunk the window parses at launch too.
 *
 * The rule for what belongs here is narrow: a component that renders only
 * behind an explicit action, and that holds no state anyone needs while it is
 * closed. `AgentPanel` deliberately fails the second half — it stays mounted
 * so a running turn survives the pane being shut, and so the count of
 * decisions waiting can reach the header while it is. Making it lazy would
 * trade a real guarantee for a smaller number.
 */
const PrintPane = lazy(() =>
  import('./PrintPane').then((module) => ({ default: module.PrintPane })),
)
const FontsPage = lazy(() =>
  import('./FontsPage').then((module) => ({ default: module.FontsPage })),
)
const DiffReview = lazy(() =>
  import('./DiffReview').then((module) => ({ default: module.DiffReview })),
)

const UNTITLED: DocumentRef = { path: null, name: 'untitled.md' }

/** How long after the last keystroke the buffer is journalled for crash
    recovery. Well ahead of autosave, and the only protection an untitled
    buffer has at all. */
const JOURNAL_DELAY = 600

/** How long after the last keystroke a saved document writes itself. */
const AUTOSAVE_DELAY = 1500

type ViewMode = 'write' | 'preview'

/**
 * The document changed on disk while Essay had it open, or a save found it
 * already changed. Both versions exist — the editor's, and the file's — and
 * the file's is already in the document's history, so this is a choice
 * rather than a rescue.
 */
interface DiskConflict {
  diskHash: string
  diskContents: string
  /** The editor holds edits that never reached disk. */
  unsaved: boolean
  /** An agent was running against this document when the write landed, so
      the agent panel is telling the story and the notice would repeat it. */
  byAgent: boolean
}

/** How wide the agent pane runs. Wide enough for a readable transcript,
    narrow enough that a 42rem manuscript beside a 232px sidebar still fits a
    1280px window — and the sidebar is one Ctrl+B away when it does not. */
const AGENT_PANEL_WIDTH = 340

/** Untitled buffers have no path to key their journal by, so they get an id
    that is unique to this launch. */
let untitledCount = 0
const launchId = Math.random().toString(36).slice(2, 8)
function newUntitledKey(): string {
  untitledCount += 1
  return `untitled:${launchId}:${untitledCount}`
}

/** The welcome manuscript appears once, on first launch; after that new
    documents start empty. */
function initialManuscript(): string {
  try {
    if (localStorage.getItem('essay.welcomed')) return ''
    localStorage.setItem('essay.welcomed', '1')
    return welcome
  } catch {
    return welcome
  }
}

export function Workspace() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [initialDoc] = useState(initialManuscript)
  const [docRef, setDocRef] = useState<DocumentRef>(UNTITLED)
  /** Saved documents opened this session. Pure bookkeeping for the tab strip:
      the buffer always lives in the one editor, and a saved document has
      already been written by autosave before you leave it, so switching is a
      reload rather than a hand-off. */
  const [openTabs, setOpenTabs] = useState<DocumentRef[]>([])
  const [dirty, setDirty] = useState(false)
  /** The content hash Essay believes is on disk — the write guard. */
  const [baseHash, setBaseHash] = useState<string | null>(null)
  const [conflict, setConflict] = useState<DiskConflict | null>(null)
  /** What the review panel is showing, or null when it is closed. Composed by
      whoever asked for it — the conflict bar, or the agent panel with its own
      accept/reject verbs on it. */
  const [review, setReview] = useState<ReviewRequest | null>(null)
  /** The fonts page, over the manuscript. A machine-level surface rather than
      a document one, so it is not in the sidebar. */
  const [fontsOpen, setFontsOpen] = useState(false)
  const [recoverable, setRecoverable] = useState<RecoverableBuffer[]>([])
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [words, setWords] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [focusMode, setFocusModeState] = useState(false)
  const [mode, setMode] = useState<ViewMode>('write')
  const [measure, setMeasureState] = useState<MeasureId>(loadMeasure)
  const [marks, setMarks] = useState<DocumentMark[]>([])
  const [caretPos, setCaretPos] = useState(0)
  const [renderVersion, setRenderVersion] = useState(0)
  const [agentOpen, setAgentOpen] = useState(false)
  /** Decisions the agent panel is holding. Mirrored up here because it is the
      only thing that can show in the chrome while the panel is shut. */
  const [waitingOnAuthor, setWaitingOnAuthor] = useState(0)
  /** Edits an agent wrote to the file itself, which the watcher caught. Not
      proposals: these are already on disk. */
  const [appliedEdits, setAppliedEdits] = useState<AppliedEdit[]>([])
  /** Bumped whenever something happened that the timeline should show. */
  const [historyVersion, setHistoryVersion] = useState(0)

  /** Journal key for the open buffer: its path once saved, a per-launch id
      before that. A ref, not state, so loading a document can retire the old
      key and adopt the new one in one pass. */
  const docKeyRef = useRef(newUntitledKey())
  /** Latest document state for the external-change listener, which is
      registered once and would otherwise close over the first render. */
  const liveRef = useRef({
    path: null as string | null,
    dirty: false,
    editor: null as Editor | null,
    /** The agent with a session open on this document, if any. What lets the
        watcher's news be reported as "the agent wrote this" rather than as an
        anonymous edit. */
    agent: null as string | null,
  })

  useEffect(() => {
    liveRef.current = { ...liveRef.current, path: docRef.path, dirty, editor }
  }, [docRef.path, dirty, editor])

  const noteAgentSession = useCallback((agent: string | null) => {
    liveRef.current.agent = agent
  }, [])

  const setMeasure = useCallback((next: MeasureId) => {
    setMeasureState(next)
    saveMeasure(next)
  }, [])

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
    (
      editor: Editor,
      contents: string,
      ref: DocumentRef,
      hash: string | null,
      options: { dirty?: boolean; key?: string } = {},
    ) => {
      const previousKey = docKeyRef.current
      const key = options.key ?? ref.path ?? newUntitledKey()
      docKeyRef.current = key
      // The outgoing buffer was saved or explicitly discarded on the way
      // here, so its journal has nothing left to protect.
      if (previousKey !== key) void clearJournal(previousKey)

      setManuscript(editor, contents)
      setDocRef(ref)
      if (ref.path) {
        const path = ref.path
        setOpenTabs((tabs) =>
          tabs.some((tab) => tab.path === path) ? tabs : [...tabs, ref],
        )
      }
      setBaseHash(hash)
      setDirty(options.dirty ?? false)
      setConflict(null)
      setReview(null)
      refreshStats(editor)
      setMode('write')
      editor.commands.focus('start')
    },
    [refreshStats],
  )

  const saveDocument = useCallback(
    async (saveAs = false): Promise<boolean> => {
      if (!editor) return false
      const result = await saveDocumentFile(
        getManuscript(editor),
        saveAs ? null : docRef.path,
        docRef.name,
        saveAs ? null : baseHash,
      )
      if (result.status === 'cancelled') return false
      if (result.status === 'conflict') {
        setConflict({
          diskHash: result.diskHash,
          diskContents: result.diskContents,
          unsaved: true,
          byAgent: false,
        })
        return false
      }

      const previousKey = docKeyRef.current
      if (result.ref.path && result.ref.path !== previousKey) {
        docKeyRef.current = result.ref.path
        void clearJournal(previousKey)
      }
      setDocRef(result.ref)
      setBaseHash(result.hash)
      setDirty(false)
      return true
    },
    [editor, docRef, baseHash],
  )

  /**
   * Leaving an unsaved document: saved files are written silently (the
   * local-first default); an untitled buffer asks before discarding. A save
   * that cannot complete — the file changed underneath us — holds the author
   * where they are rather than moving on without their edits.
   */
  const settleUnsaved = useCallback(async (): Promise<boolean> => {
    if (!editor || !dirty) return true
    if (docRef.path) return saveDocument()
    return window.confirm('Discard unsaved changes to the untitled document?')
  }, [editor, dirty, docRef.path, saveDocument])

  const newDocument = useCallback(async () => {
    if (!editor || !(await settleUnsaved())) return
    await closeDocument()
    loadIntoEditor(editor, '', UNTITLED, null)
  }, [editor, settleUnsaved, loadIntoEditor])

  const openDocument = useCallback(async () => {
    if (!editor || !(await settleUnsaved())) return
    const opened = await openDocumentFile()
    if (!opened) return
    loadIntoEditor(editor, opened.contents, opened, opened.hash)
  }, [editor, settleUnsaved, loadIntoEditor])

  const openByPath = useCallback(
    async (path: string) => {
      if (!editor || path === docRef.path) return
      if (!(await settleUnsaved())) return
      const opened = await openDocumentByPath(path)
      if (!opened) return
      loadIntoEditor(editor, opened.contents, opened, opened.hash)
    },
    [editor, docRef.path, settleUnsaved, loadIntoEditor],
  )

  /**
   * Closing a tab is only ever bookkeeping: a saved document has already been
   * written by autosave, so there is nothing to settle. Closing the one you
   * are looking at moves to its neighbour, or to a blank document if it was
   * the last one.
   */
  const closeTab = useCallback(
    (tab: OpenTab) => {
      const remaining = openTabs.filter((open) => open.path !== tab.path)
      setOpenTabs(remaining)
      if (tab.path !== docRef.path) return
      const neighbour = remaining[remaining.length - 1]
      if (neighbour?.path) void openByPath(neighbour.path)
      else void newDocument()
    },
    [openTabs, docRef.path, openByPath, newDocument],
  )

  const exportPdf = useCallback(async () => {
    if (!editor) return
    await exportPdfFile(
      getManuscript(editor),
      docRef.name,
      documentDir(docRef.path),
    )
  }, [editor, docRef])

  // ——— Finding things ———

  /**
   * Open the document a result came from and put the caret on the match.
   *
   * The offset that came back with a project result is into the file's
   * Markdown, which says nothing about a ProseMirror position, so the phrase is
   * found again in the buffer once it is loaded. Two searches for one click,
   * both of them cheap, and the caret lands where the result promised instead
   * of at the top of the file.
   */
  const openAtMatch = useCallback(
    async (path: string, query: string) => {
      await openByPath(path)
      if (!editor) return
      const text = manuscriptText(editor)
      const found = await searchDocument(text.text, query)
      const first = found?.matches[0]
      if (first) revealPosition(editor, positionAtOffset(text, first.offset))
    },
    [editor, openByPath],
  )

  /**
   * The palette's query, answered by `essay-search` twice: once against the
   * buffer on screen, once across the workspace folders.
   *
   * The open document is searched from the editor rather than from its file —
   * the buffer is ahead of disk between autosaves, and it is the only version
   * whose offsets can become caret positions — which is why the file itself is
   * skipped in the folder pass.
   */
  const runSearch = useCallback(
    async (query: string): Promise<SearchEntry[]> => {
      if (!editor) return []
      const entries: SearchEntry[] = []

      const text = manuscriptText(editor)
      const here = await searchDocument(text.text, query)
      for (const match of here?.matches ?? []) {
        entries.push({
          key: `here-${match.offset}`,
          title: match.excerpt,
          group: docRef.name,
          // No line number here on purpose: the buffer is searched by block,
          // so its "line 4" is not the file's line 4, and a number that is
          // nearly right is worse than none.
          run: () => {
            setMode('write')
            revealPosition(editor, positionAtOffset(text, match.offset))
          },
        })
      }

      const roots = loadWorkspaceFolders().map((folder) => folder.path)
      if (roots.length === 0) return entries
      const project = await searchProject(roots, query, {}, docRef.path)
      for (const document of project?.documents ?? []) {
        for (const match of document.matches) {
          entries.push({
            key: `${document.path}:${match.offset}`,
            title: match.excerpt,
            // Grouped under the document, so a heading appears once and the
            // reader sees "four hits in this essay" rather than four rows that
            // each have to name their file.
            group: documentLabel(document),
            hint: `line ${match.line}`,
            run: () => void openAtMatch(document.path, query),
          })
        }
      }
      return entries
    },
    [editor, docRef.name, docRef.path, openAtMatch],
  )

  // ——— Reconciling with the file on disk ———

  /**
   * Take what is on disk, dropping whatever the editor was holding. This is
   * the one place a buffer is discarded on purpose, so its journal goes too —
   * otherwise the next launch would offer back edits the author just rejected.
   * The discarded version is still in the document's history.
   */
  const takeFromDisk = useCallback(() => {
    if (!editor || !conflict) return
    const key = docKeyRef.current
    loadIntoEditor(editor, conflict.diskContents, docRef, conflict.diskHash, {
      key,
    })
    void clearJournal(key)
  }, [editor, conflict, docRef, loadIntoEditor])

  /**
   * Keep the editor's version. Adopting the disk hash as the new base is what
   * makes the next save go through: the author has seen the other version and
   * chosen against it, and it stays in the document's history either way.
   */
  const keepEditorVersion = useCallback(() => {
    if (!conflict) return
    setBaseHash(conflict.diskHash)
    setConflict(null)
    setReview(null)
    if (conflict.unsaved) setDirty(true)
  }, [conflict])

  /**
   * Show what the other version actually says. Old is the editor's buffer and
   * new is the file, so the diff reads as "what would change if I took the
   * file" — the question the notice is really asking.
   *
   * Runs off in the background: the manuscript stays mounted and editable
   * underneath until the diff arrives.
   */
  const reviewConflict = useCallback(async () => {
    if (!editor || !conflict) return
    const diff = await diffDocuments(getManuscript(editor), conflict.diskContents)
    if (!diff) return
    setReview({
      diff,
      title: docRef.name,
      provenance: conflict.unsaved
        ? 'Your unsaved buffer compared with the file on disk'
        : 'The version you opened compared with the file on disk',
      oldLabel: 'Yours',
      newLabel: 'On disk',
      actions: [
        {
          label: conflict.unsaved ? 'Use the file' : 'Reload',
          onClick: takeFromDisk,
        },
        {
          label: conflict.unsaved ? 'Keep mine' : 'Keep editing',
          onClick: keepEditorVersion,
        },
      ],
    })
  }, [editor, conflict, docRef.name, takeFromDisk, keepEditorVersion])

  const closeReview = useCallback(() => {
    setReview(null)
    editor?.commands.focus()
  }, [editor])

  // ——— The document's own history ———

  /**
   * Every new state on disk is a new revision, and `baseHash` is the one
   * thing that changes exactly when that happens — a save, a restore, taking
   * the file after a conflict, accepting an agent's patch. Watching it means
   * the timeline never has to be refreshed by hand from four call sites that
   * would each have to remember to.
   */
  useEffect(() => {
    setHistoryVersion((version) => version + 1)
  }, [baseHash])

  /**
   * Put an earlier version back.
   *
   * Guarded by the hash the editor believes is on disk, so a restore decided
   * while reading a diff cannot silently overwrite an edit that landed during
   * the reading. A collision here is the same conversation as any other, so
   * it goes through the same bar.
   */
  const restoreTo = useCallback(
    async (revision: Revision) => {
      if (!editor || !docRef.path) return
      const result = await restoreRevision(
        docRef.path,
        revision.sourceHash,
        baseHash,
      )
      if (!result) return
      if (result.outcome.status === 'conflict') {
        setReview(null)
        setConflict({
          diskHash: result.outcome.diskHash,
          diskContents: result.outcome.diskContents,
          unsaved: dirty,
          byAgent: false,
        })
        return
      }
      const key = docKeyRef.current
      loadIntoEditor(editor, result.contents, docRef, result.outcome.hash, {
        key,
      })
      void clearJournal(key)
    },
    [editor, docRef, baseHash, dirty, loadIntoEditor],
  )

  /**
   * Show what a revision says, against the document as it stands.
   *
   * Old is the revision and new is now, so the diff reads forwards — "this is
   * what has happened since" — and restoring is the way back from it. That
   * direction is deliberate: a timeline is read to find out what changed, and
   * a diff that ran backwards would report every addition as a deletion.
   */
  const compareRevision = useCallback(
    async (revision: Revision) => {
      if (!editor || !docRef.path) return
      const source = await revisionSource(docRef.path, revision.sourceHash)
      if (source === null) return
      const diff = await diffDocuments(source, getManuscript(editor))
      if (!diff) return
      setReview({
        diff,
        title: docRef.name,
        provenance: `${originLabel(revision.origin)} by ${authorLabel(revision.author)}, ${revisionTime(revision.createdAt)}`,
        oldLabel: 'Then',
        newLabel: 'Now',
        actions: [
          {
            label: 'Restore this version',
            onClick: () => void restoreTo(revision),
          },
        ],
      })
    },
    [editor, docRef, restoreTo],
  )

  /**
   * Mark the document as it stands as a state worth keeping.
   *
   * Saves first when there is anything unsaved: a mark names a state, and an
   * unsaved buffer would put the author's name on the version *before* the
   * edit they are looking at.
   */
  const checkpoint = useCallback(async () => {
    if (!editor || !docRef.path) return
    if (dirty && !(await saveDocument())) return
    await checkpointDocument(docRef.path, getManuscript(editor))
    setHistoryVersion((version) => version + 1)
  }, [editor, docRef.path, dirty, saveDocument])

  // ——— Reconciling with an agent ———

  const settleApplied = useCallback(
    (edit: AppliedEdit, settled: 'kept' | 'reverted') => {
      setAppliedEdits((edits) =>
        edits.map((entry) =>
          entry.id === edit.id ? { ...entry, settled } : entry,
        ),
      )
    },
    [],
  )

  /** Let the agent's write stand: take the file, drop the buffer. */
  const keepApplied = useCallback(
    (edit: AppliedEdit) => {
      if (!editor) return
      const key = docKeyRef.current
      loadIntoEditor(editor, edit.contents, docRef, edit.hash, { key })
      void clearJournal(key)
      settleApplied(edit, 'kept')
    },
    [editor, docRef, loadIntoEditor, settleApplied],
  )

  /**
   * Put the author's version back over the agent's.
   *
   * Writes the buffer as it stands now rather than the snapshot taken when the
   * edit landed — the author may have kept typing, and "mine" means what is on
   * the screen. The guard is the hash the agent left, which is what lets this
   * write through the same check its own write just tripped. Both versions are
   * in the document's history either way, so this is an undo with a record.
   */
  const revertApplied = useCallback(
    async (edit: AppliedEdit) => {
      if (!editor) return
      const mine = getManuscript(editor)
      const result = await saveDocumentFile(
        mine,
        edit.file,
        docRef.name,
        edit.hash,
      )
      if (result.status !== 'written') return
      setBaseHash(result.hash)
      setDirty(false)
      setConflict(null)
      settleApplied(edit, 'reverted')
    },
    [editor, docRef.name, settleApplied],
  )

  /**
   * A proposal reached disk. The buffer has to follow it there, or the next
   * autosave would quietly write back the version the author just replaced.
   */
  const applyAccepted = useCallback(
    (change: ChangeSet, hash: string) => {
      setReview(null)
      // Accepting a change to some other file is a real thing an agent can
      // propose; it just has nothing to do with what is on screen.
      if (!editor || !samePath(change.file, docRef.path)) return
      setManuscript(editor, change.proposedContents)
      setBaseHash(hash)
      setDirty(false)
      setConflict(null)
      refreshStats(editor)
    },
    [editor, docRef.path, refreshStats],
  )

  /** The file moved under a proposal. Same conversation as any other disk
      conflict, so it goes through the same bar. */
  const acceptConflict = useCallback(
    (diskHash: string, diskContents: string) => {
      setReview(null)
      setConflict({ diskHash, diskContents, unsaved: dirty, byAgent: false })
    },
    [dirty],
  )

  useEffect(() => {
    let dispose: (() => void) | undefined
    void onExternalChange((change) => {
      const live = liveRef.current
      if (change.path !== live.path) return
      const agent = live.agent
      setConflict({
        diskHash: change.hash,
        diskContents: change.contents,
        unsaved: live.dirty,
        byAgent: agent !== null,
      })
      // Not every agent routes its writes through the protocol — opencode
      // edits the file with its own tools and Essay learns about it here, from
      // the watcher, with the bytes already on disk. That is a different fact
      // from a proposal and the panel has to be able to say so.
      if (!agent) return
      const before = live.editor ? getManuscript(live.editor) : ''
      const edit: AppliedEdit = {
        id: `applied-${change.hash.slice(0, 12)}-${Date.now()}`,
        agent,
        file: change.path,
        hash: change.hash,
        before,
        contents: change.contents,
        diff: null,
        looksLikeARewrite: false,
        at: Date.now(),
        settled: null,
      }
      setAppliedEdits((edits) => [
        // An unanswered edit that a later one overwrote is history, not a
        // decision: the author can only choose about the version on disk.
        ...edits.map((entry) =>
          entry.settled === null
            ? { ...entry, settled: 'superseded' as const }
            : entry,
        ),
        edit,
      ])
      // The size and the rewrite flag belong on the row, not behind a click.
      void diffDocuments(before, change.contents).then((diff) => {
        if (!diff) return
        setAppliedEdits((edits) =>
          edits.map((entry) =>
            entry.id === edit.id
              ? { ...entry, diff, looksLikeARewrite: looksLikeARewrite(diff) }
              : entry,
          ),
        )
      })
    }).then((fn) => {
      dispose = fn
    })
    return () => dispose?.()
  }, [])

  // ——— Durability ———

  // Autosave: documents with a path write themselves after the last
  // keystroke. The dirty dot is only ever visible for untitled buffers and
  // the brief moment before a save lands.
  useEffect(() => {
    if (!dirty || !docRef.path || !editor || conflict) return
    const timer = setTimeout(() => void saveDocument(), AUTOSAVE_DELAY)
    return () => clearTimeout(timer)
  }, [dirty, renderVersion, docRef.path, editor, conflict, saveDocument])

  // Crash recovery: journal the buffer itself, ahead of and independently of
  // reaching disk.
  useEffect(() => {
    if (!dirty || !editor) return
    const timer = setTimeout(() => {
      void journalBuffer({
        key: docKeyRef.current,
        name: docRef.name,
        path: docRef.path,
        contents: getManuscript(editor),
        baseHash,
      })
    }, JOURNAL_DELAY)
    return () => clearTimeout(timer)
  }, [dirty, renderVersion, editor, docRef, baseHash])

  useEffect(() => {
    void pendingRecovery().then(setRecoverable)
  }, [])

  const restoreBuffer = useCallback(
    async (entry: RecoverableBuffer) => {
      if (!editor) return
      let ref: DocumentRef = { path: entry.path, name: entry.name }
      let hash = entry.baseHash
      // Reading the file first re-establishes the watch and gives the hash
      // the document actually has now, which is what the recovered buffer
      // will be saved against.
      if (entry.path) {
        const disk = await openDocumentByPath(entry.path)
        if (disk) {
          ref = { path: disk.path, name: disk.name }
          hash = disk.hash
        }
      }
      loadIntoEditor(editor, entry.contents, ref, hash, {
        dirty: true,
        key: entry.key,
      })
      setRecoverable((entries) => entries.filter((e) => e.key !== entry.key))
    },
    [editor, loadIntoEditor],
  )

  const discardBuffer = useCallback((entry: RecoverableBuffer) => {
    void clearJournal(entry.key)
    setRecoverable((entries) => entries.filter((e) => e.key !== entry.key))
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      // The editor gets the keystroke first — it is nested, and this listener
      // is on `window`, the outermost target — and ProseMirror calls
      // preventDefault on every shortcut it handles. Without this check the
      // chrome acts on keys the manuscript has already consumed: Ctrl+B both
      // bolds and toggles the sidebar, Ctrl+Shift+B quotes and toggles it,
      // and Ctrl+Shift+S strikes through and opens Save As.
      //
      // Deliberately not a "did this come from the editor?" test. What
      // matters is whether the keystroke was *used*, not where it landed, so
      // Ctrl+B from the agent composer still reaches the sidebar.
      if (event.defaultPrevented) return
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
      } else if (key === 'f') {
        // Find lives in the palette rather than in a bar of its own: the
        // question "where did I write that" is the same question whether the
        // answer is in this document or in the folder beside it.
        event.preventDefault()
        setPaletteOpen(true)
      } else if (key === 'j') {
        event.preventDefault()
        setMode((m) => (m === 'write' ? 'preview' : 'write'))
      } else if (key === 'a' && event.shiftKey) {
        // Shifted, because Ctrl+A is select-all and an author reaching for it
        // mid-sentence must never lose their selection to a panel.
        event.preventDefault()
        setAgentOpen((open) => !open)
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
      // Shortcuts are declared in Windows/Linux spelling and translated here
      // (see `shortcut`): the handler has always accepted Cmd as well as Ctrl,
      // so on a Mac these labels were the only part that was wrong.
      { id: 'file.new', title: 'New document', group: 'File', shortcut: shortcut('Ctrl+N'), run: () => void newDocument() },
      { id: 'file.open', title: 'Open file…', group: 'File', shortcut: shortcut('Ctrl+O'), run: () => void openDocument() },
      { id: 'file.save', title: 'Save', group: 'File', shortcut: shortcut('Ctrl+S'), run: () => void saveDocument() },
      { id: 'file.saveAs', title: 'Save as…', group: 'File', shortcut: shortcut('Ctrl+Shift+S'), run: () => void saveDocument(true) },
      { id: 'file.exportPdf', title: 'Export PDF…', group: 'File', keywords: 'typeset print render', run: () => void exportPdf() },
      { id: 'file.checkpoint', title: 'Mark this version', group: 'File', keywords: 'checkpoint history revision snapshot milestone draft sent', run: () => void checkpoint() },
      { id: 'file.find', title: 'Find a phrase…', group: 'File', shortcut: shortcut('Ctrl+F'), keywords: 'search find look for text grep phrase across folders', run: () => setPaletteOpen(true) },
      { id: 'view.preview', title: 'Toggle preview', group: 'View', shortcut: shortcut('Ctrl+J'), keywords: 'typeset pages print render', run: () => setMode((m) => (m === 'write' ? 'preview' : 'write')) },
      { id: 'view.sidebar', title: 'Toggle sidebar', group: 'View', shortcut: shortcut('Ctrl+B'), run: () => setSidebarOpen((open) => !open) },
      { id: 'view.agent', title: 'Toggle agent panel', group: 'View', shortcut: shortcut('Ctrl+Shift+A'), keywords: 'ai assistant opencode claude propose changes review', run: () => setAgentOpen((open) => !open) },
      { id: 'view.focus', title: 'Toggle focus mode', group: 'View', keywords: 'zen typewriter dim centre center', run: () => setFocusModeState((on) => !on) },
      { id: 'view.measure', title: `Writing width: ${measureLabel(measure)}`, group: 'View', keywords: 'column measure line length narrow wide', run: () => setMeasure(nextMeasure(measure)) },
      { id: 'view.fonts', title: 'Fonts…', group: 'View', keywords: 'typeface font family install add serif typography', run: () => setFontsOpen(true) },
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
  }, [editor, newDocument, openDocument, saveDocument, exportPdf, checkpoint, measure, setMeasure])

  useEffect(() => {
    const title = `${docRef.name}${dirty ? ' •' : ''} — Essay`
    document.title = title
    if (isTauri()) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow().setTitle(title),
      )
    }
  }, [docRef, dirty])

  /** The strip's contents: saved documents, plus the untitled buffer when
      that is what you are looking at. Only the active tab can be dirty — the
      others were written on the way out. */
  const tabs: OpenTab[] = [
    ...openTabs.map((tab) => ({
      ...tab,
      dirty: tab.path === docRef.path && dirty,
    })),
    ...(docRef.path ? [] : [{ ...docRef, dirty }]),
  ]

  const activeOutlinePos = outline.reduce<number | null>(
    (active, item) => (item.pos <= caretPos ? item.pos : active),
    null,
  )

  const recovering = recoverable[0]

  return (
    <TooltipProvider>
      <div className="grid h-screen grid-rows-[auto_minmax(0,1fr)_auto] bg-[var(--essay-bg)] text-[var(--essay-text)]">
        <header
          data-tauri-drag-region
          className="grid h-10 grid-cols-[1fr_auto_1fr] items-center border-b border-[var(--essay-border)] px-2"
          // macOS draws the traffic lights over the top-left of the content
          // (titleBarStyle: Overlay) and the DOM has no way to know they are
          // there, so the header leaves the room itself — otherwise the
          // sidebar toggle sits under the close button. Only under Tauri: the
          // browser preview has no native title bar to make room for, and off
          // macOS there is nothing overlapping at all.
          style={
            isMac && isTauri()
              ? { paddingLeft: TRAFFIC_LIGHT_INSET }
              : undefined
          }
        >
          <div data-tauri-drag-region className="flex min-w-0 items-center gap-1">
            <Tip
              label="Toggle sidebar"
              shortcut={shortcut('Ctrl+B')}
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
              nameless={tabs.length > 1}
            />
            <DocumentTabs
              tabs={tabs}
              activeKey={docRef.path ?? 'untitled'}
              onSelect={(tab) =>
                tab.path ? void openByPath(tab.path) : undefined
              }
              onClose={closeTab}
            />
          </div>

          <ModeSwitch mode={mode} onChange={setMode} />

          <div data-tauri-drag-region className="flex items-center justify-end gap-0.5">
            {/* Saved means everything typed has reached disk: autosave clears
                `dirty` for documents with a path, and an untitled buffer with
                anything in it stays dirty by construction — it has nowhere to
                be saved to. An unanswered disk conflict is unfinished business
                of the same kind, so it counts as unsaved too. */}
            <UpdateButton documentsSaved={!dirty && !conflict} />
            <Tip
              label="Agent"
              shortcut={shortcut('Ctrl+Shift+A')}
              trigger={
                <IconButton
                  onClick={() => setAgentOpen((open) => !open)}
                  aria-pressed={agentOpen}
                  className={cn(
                    agentOpen && 'bg-[var(--essay-surface-hover)] text-[var(--essay-text)]',
                    // A decision waiting is worth a dot in the chrome; it is
                    // the only place it shows when the panel is closed.
                    waitingOnAuthor > 0 && 'text-[var(--essay-accent)]',
                  )}
                >
                  <Robot size={16} />
                </IconButton>
              }
            />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              title="Command palette"
              className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[var(--essay-text-muted)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
            >
              <Kbd>{commandKey}</Kbd>
              <Kbd>K</Kbd>
            </button>
            <WindowControls />
          </div>
        </header>

        <div
          className="grid min-h-0"
          // Built here rather than as classes: Tailwind cannot see a template
          // string, and the pane width is a measured decision (see
          // AGENT_PANEL_WIDTH) rather than a scale step.
          style={{
            gridTemplateColumns: [
              sidebarOpen ? '232px' : null,
              'minmax(0,1fr)',
              agentOpen ? `${AGENT_PANEL_WIDTH}px` : null,
            ]
              .filter(Boolean)
              .join(' '),
          }}
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
              documentPath={docRef.path}
              historyVersion={historyVersion}
              currentHash={baseHash}
              onCompareRevision={(revision) => void compareRevision(revision)}
              onCheckpoint={() => void checkpoint()}
            />
          )}
          <main className="relative flex min-h-0 flex-col overflow-hidden bg-[var(--essay-editor-bg)]">
            {recovering && (
              <Notice
                actions={[
                  {
                    label: 'Restore',
                    primary: true,
                    onClick: () => void restoreBuffer(recovering),
                  },
                  {
                    label: 'Discard',
                    onClick: () => discardBuffer(recovering),
                  },
                ]}
              >
                Unsaved work from your last session:{' '}
                <DocName>{recovering.name}</DocName>.
              </Notice>
            )}
            {conflict && !(conflict.byAgent && agentOpen) && (
              // Reviewing is the primary action, not reloading or keeping:
              // the two blunt choices are only safe to make once the author
              // has seen which one costs them something.
              //
              // Suppressed only when the agent panel is open and the edit came
              // from the agent it is showing — there it is already a row with
              // better words on it, and two bars saying the same thing in
              // different language is how an author stops reading either.
              <Notice
                actions={[
                  {
                    label: 'Review changes',
                    primary: true,
                    onClick: () => void reviewConflict(),
                  },
                  {
                    label: conflict.unsaved ? 'Use the file' : 'Reload',
                    onClick: takeFromDisk,
                  },
                  {
                    label: conflict.unsaved ? 'Keep mine' : 'Keep editing',
                    onClick: keepEditorVersion,
                  },
                ]}
              >
                <DocName>{docRef.name}</DocName> changed on disk
                {conflict.unsaved
                  ? ', and you have unsaved edits. Both versions are in this document’s history.'
                  : '.'}
              </Notice>
            )}
            <div className="relative min-h-0 flex-1">
              <div
                className={mode === 'preview' ? 'hidden' : 'h-full'}
                // Only `.essay-prose` reads this, so scoping it to the
                // manuscript keeps the print pane on the template's geometry.
                style={{ '--essay-measure': measureWidth(measure) } as CSSProperties}
              >
                <ManuscriptEditor
                  initialMarkdown={initialDoc}
                  onReady={handleReady}
                  onChanged={handleChanged}
                />
                {editor && <SelectionToolbar editor={editor} />}
              </div>
              {mode === 'preview' && (
                // No fallback: the pane already has a "rendering…" state of
                // its own, and a second one flashing in front of it for the
                // length of a disk read would read as two loads, not one.
                <Suspense fallback={null}>
                  <PrintPane preview={preview} />
                </Suspense>
              )}
              {/* Over the manuscript rather than instead of it: the editor
                  stays mounted with its selection and scroll intact, so Esc
                  puts the author back exactly where they were typing. A side
                  pane would be too narrow for prose lines, and a modal would
                  make a reading task feel like an interruption. */}
              {review && (
                <Suspense fallback={null}>
                  <DiffReview
                    className="absolute inset-0 z-20"
                    {...review}
                    onClose={closeReview}
                  />
                </Suspense>
              )}
              {fontsOpen && (
                <Suspense fallback={null}>
                  <FontsPage
                    className="absolute inset-0 z-20"
                    // Installing a face changes how the document prints, so a
                    // preview that is open has to re-typeset against the new
                    // set rather than keep showing the fallback.
                    onChanged={() => setRenderVersion((v) => v + 1)}
                    onClose={() => {
                      setFontsOpen(false)
                      editor?.commands.focus()
                    }}
                  />
                </Suspense>
              )}
            </div>
          </main>

          {/* Mounted whether or not it is showing: a session, a transcript and
              a queue of proposals all outlive the author glancing away, and an
              agent that kept working while the pane was shut must not come
              back to an empty panel. */}
          <AgentPanel
            open={agentOpen}
            documentPath={docRef.path}
            documentName={docRef.name}
            appliedEdits={appliedEdits}
            onSessionChange={noteAgentSession}
            onWaitingChange={setWaitingOnAuthor}
            onReview={setReview}
            onCloseReview={closeReview}
            onAccepted={applyAccepted}
            onAcceptConflict={acceptConflict}
            onKeepApplied={keepApplied}
            onRevertApplied={(edit) => void revertApplied(edit)}
            onClose={() => setAgentOpen(false)}
          />
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
          {mode === 'write' && (
            <MeasureSelect value={measure} onChange={setMeasure} />
          )}
          <span className="ml-auto">
            {conflict
              ? 'changed on disk'
              : docRef.path
                ? dirty
                  ? 'saving…'
                  : 'saved'
                : 'not saved yet'}
          </span>
        </footer>

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          outline={outline}
          onJumpToSection={(item) => {
            setMode('write')
            if (editor) revealHeading(editor, item.pos)
          }}
          onOpenFile={(path) => void openByPath(path)}
          onSearch={runSearch}
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
    <kbd className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-[var(--essay-border)] bg-[var(--essay-surface-hover)] px-1 font-(family-name:--essay-font-ui) text-[10px] font-[510]">
      {children}
    </kbd>
  )
}
