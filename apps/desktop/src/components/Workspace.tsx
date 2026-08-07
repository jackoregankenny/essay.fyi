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
import { cn } from '#/lib/cn'
import welcome from '#/content/welcome.md?raw'
import { samePath, type AppliedEdit, type ChangeSet } from '#/lib/agents'
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
  applyProseFont,
  loadProseFont,
  nextProseFont,
  proseFontLabel,
  saveProseFont,
  type ProseFontId,
} from '#/lib/proseFont'
import { commandKey, shortcut } from '#/lib/platform'
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
  type SearchOptions,
} from '#/lib/search'
import { insertImage } from '#/lib/images'
import { documentDir, usePreview } from '#/lib/usePreview'
import { loadWorkspaceFolders } from '#/lib/workspace'
import { AgentPanel } from './AgentPanel'
import { CommandPalette, type SearchEntry } from './CommandPalette'
import {
  Companion,
  loadCompanionTenant,
  saveCompanionTenant,
  type CompanionTenant,
} from './Companion'
import type { ReviewRequest } from './DiffReview'
import { Gutter } from './Gutter'
import { HistoryPane } from './HistoryPane'
import { ManuscriptEditor } from './ManuscriptEditor'
import { MeasureSelect } from './MeasureSelect'
import { DocName, Notice } from './Notice'
import { SelectionToolbar } from './SelectionToolbar'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { TooltipProvider } from './ui/tooltip'

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
const FilesPanel = lazy(() =>
  import('./FilesPanel').then((module) => ({ default: module.FilesPanel })),
)

const UNTITLED: DocumentRef = { path: null, name: 'untitled.md' }

/** How long after the last keystroke the buffer is journalled for crash
    recovery. Well ahead of autosave, and the only protection an untitled
    buffer has at all. */
const JOURNAL_DELAY = 600

/** How long after the last keystroke a saved document writes itself. */
const AUTOSAVE_DELAY = 1500

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
  /** The folder explorer, over the manuscript. A layer, not a rail: browsing
      the workspace is a deliberate act, and quick-open covers the everyday
      case of moving between documents. */
  const [explorerOpen, setExplorerOpen] = useState(false)
  const [recoverable, setRecoverable] = useState<RecoverableBuffer[]>([])
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [words, setWords] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [focusMode, setFocusModeState] = useState(false)
  /** What the companion slot holds, or null when the author has the page to
      themselves. One slot, one tenant — the whole layout discipline
      (docs/ui-overhaul.md). Restored per document in `loadIntoEditor`. */
  const [tenant, setTenantState] = useState<CompanionTenant | null>(null)
  const [measure, setMeasureState] = useState<MeasureId>(loadMeasure)
  /** The manuscript's face — Geist or the machine's best serif. A root
      attribute rather than component state in spirit, but mirrored here so
      the palette command's title can name the current one. */
  const [proseFont, setProseFontState] = useState<ProseFontId>(loadProseFont)
  const [marks, setMarks] = useState<DocumentMark[]>([])
  const [caretPos, setCaretPos] = useState(0)
  const [renderVersion, setRenderVersion] = useState(0)
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

  // The face is applied at mount (the saved choice survives a relaunch) and
  // whenever the palette cycles it.
  useEffect(() => {
    applyProseFont(proseFont)
  }, [proseFont])

  const cycleProseFont = useCallback(() => {
    setProseFontState((current) => {
      const next = nextProseFont(current)
      saveProseFont(next)
      return next
    })
  }, [])

  /**
   * Change the slot's tenant and remember the choice for this document. Keyed
   * by path, so an untitled buffer never records one — "closed" is the flow's
   * default posture and a fresh document opens with the page to itself.
   */
  const setTenant = useCallback((next: CompanionTenant | null) => {
    setTenantState(next)
    const path = liveRef.current.path
    if (path) saveCompanionTenant(path, next)
  }, [])

  /** The keystroke verb: Ctrl+B lands on structure, Ctrl+J on proof,
      Ctrl+Shift+A on agent. Pressing it again puts the page back. */
  const toggleTenant = useCallback(
    (candidate: CompanionTenant) => {
      setTenant(tenant === candidate ? null : candidate)
    },
    [tenant, setTenant],
  )

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
      setBaseHash(hash)
      setDirty(options.dirty ?? false)
      setConflict(null)
      setReview(null)
      refreshStats(editor)
      // The slot follows the document: the memo being finished left Proof
      // open, the chapter mid-argument left Structure — and a document Essay
      // has never seen opens with the page to itself. Restoring 'agent' also
      // pre-warms the panel's last-used adapter, which is the behaviour the
      // panel already promises when it opens.
      setTenantState(ref.path ? loadCompanionTenant(ref.path) : null)
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
    async (query: string, options?: SearchOptions): Promise<SearchEntry[]> => {
      if (!editor) return []
      const entries: SearchEntry[] = []

      const text = manuscriptText(editor)
      const here = await searchDocument(text.text, query, options ?? {})
      for (const match of here?.matches ?? []) {
        entries.push({
          key: `here-${match.offset}`,
          title: match.excerpt,
          group: docRef.name,
          // No line number here on purpose: the buffer is searched by block,
          // so its "line 4" is not the file's line 4, and a number that is
          // nearly right is worse than none.
          run: () => {
            revealPosition(editor, positionAtOffset(text, match.offset))
          },
        })
      }

      const roots = loadWorkspaceFolders().map((folder) => folder.path)
      if (roots.length === 0) return entries
      const project = await searchProject(roots, query, options ?? {}, docRef.path)
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
        toggleTenant('structure')
      } else if (key === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      } else if (key === 'f' && event.shiftKey) {
        // Shifted find is focus: the author asking for the room to themselves.
        event.preventDefault()
        setFocusModeState((on) => !on)
      } else if (key === 'f') {
        // Find lives in the palette rather than in a bar of its own: the
        // question "where did I write that" is the same question whether the
        // answer is in this document or in the folder beside it.
        event.preventDefault()
        setPaletteOpen(true)
      } else if (key === 'j') {
        event.preventDefault()
        toggleTenant('proof')
      } else if (key === 'a' && event.shiftKey) {
        // Shifted, because Ctrl+A is select-all and an author reaching for it
        // mid-sentence must never lose their selection to a panel.
        event.preventDefault()
        toggleTenant('agent')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openDocument, saveDocument, newDocument, toggleTenant])

  useEffect(() => {
    if (editor) setFocusMode(editor, focusMode)
  }, [editor, focusMode])

  // The chrome recedes as the author sinks into the writing — not on the
  // first keystroke, which would read as the UI flinching. A run of typing
  // has to sustain itself for a moment (updates arriving close together for
  // over a second) before `data-typing` engages and every `.essay-chrome`
  // surface eases to a murmur (styles.css — the fade out is slow, the
  // return is quick). Moving the pointer — the author looking up from the
  // page — brings it back at once; so does a moment of stillness. Doc
  // changes only, never selection: arrowing around a paragraph is reading,
  // and reading wants the chrome where the eye left it.
  useEffect(() => {
    if (!editor) return
    const root = document.documentElement
    /** A pause this long ends the run; the next keystroke starts a new one. */
    const RUN_GAP = 1500
    /** How long a run must sustain before the room dims. */
    const FLOW_AFTER = 1200
    let runStart = 0
    let lastStroke = 0
    let timer: number | null = null
    const stop = () => {
      root.removeAttribute('data-typing')
      runStart = 0
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
    const onUpdate = () => {
      const now = performance.now()
      if (now - lastStroke > RUN_GAP) runStart = now
      lastStroke = now
      if (now - runStart >= FLOW_AFTER) root.setAttribute('data-typing', '')
      if (timer !== null) clearTimeout(timer)
      timer = window.setTimeout(stop, RUN_GAP)
    }
    editor.on('update', onUpdate)
    window.addEventListener('pointermove', stop)
    return () => {
      editor.off('update', onUpdate)
      window.removeEventListener('pointermove', stop)
      stop()
    }
  }, [editor])

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
    tenant === 'proof',
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
      { id: 'file.folders', title: 'Browse folders…', group: 'File', keywords: 'explorer workspace tree files directory root', run: () => setExplorerOpen(true) },
      { id: 'view.proof', title: 'Toggle proof', group: 'View', shortcut: shortcut('Ctrl+J'), keywords: 'typeset pages print render preview', run: () => toggleTenant('proof') },
      { id: 'view.structure', title: 'Toggle structure', group: 'View', shortcut: shortcut('Ctrl+B'), keywords: 'outline sidebar sections marks', run: () => toggleTenant('structure') },
      { id: 'view.agent', title: 'Toggle agent panel', group: 'View', shortcut: shortcut('Ctrl+Shift+A'), keywords: 'ai assistant opencode claude propose changes review', run: () => toggleTenant('agent') },
      { id: 'view.history', title: 'Show history', group: 'View', keywords: 'revisions timeline versions restore checkpoint', run: () => setTenant('history') },
      { id: 'view.focus', title: 'Toggle focus mode', group: 'View', shortcut: shortcut('Ctrl+Shift+F'), keywords: 'zen typewriter dim centre center', run: () => setFocusModeState((on) => !on) },
      { id: 'view.measure', title: `Writing width: ${measureLabel(measure)}`, group: 'View', keywords: 'column measure line length narrow wide', run: () => setMeasure(nextMeasure(measure)) },
      { id: 'view.proseFont', title: `Prose face: ${proseFontLabel(proseFont)}`, group: 'View', keywords: 'font serif sans typeface geist charter georgia face typography', run: cycleProseFont },
      { id: 'view.fonts', title: 'Fonts…', group: 'View', keywords: 'typeface font family install add serif typography', run: () => setFontsOpen(true) },
      // Dark is the identity (theme.css); light is the explicit departure.
      { id: 'view.light', title: 'Toggle light mode', group: 'View', keywords: 'theme dark appearance day night', run: () => {
        const root = document.documentElement
        if (root.dataset.theme === 'light') delete root.dataset.theme
        else root.dataset.theme = 'light'
      } },
      { id: 'format.h1', title: 'Heading 1', group: 'Format', keywords: 'title turn into', run: () => { chain().toggleHeading({ level: 1 }).run() } },
      { id: 'format.h2', title: 'Heading 2', group: 'Format', keywords: 'section turn into', run: () => { chain().toggleHeading({ level: 2 }).run() } },
      { id: 'format.h3', title: 'Heading 3', group: 'Format', keywords: 'subsection turn into', run: () => { chain().toggleHeading({ level: 3 }).run() } },
      { id: 'format.paragraph', title: 'Text', group: 'Format', keywords: 'paragraph body normal', run: () => { chain().setParagraph().run() } },
      { id: 'format.quote', title: 'Quote', group: 'Format', keywords: 'blockquote', run: () => { chain().toggleBlockquote().run() } },
      { id: 'format.codeBlock', title: 'Code block', group: 'Format', run: () => { chain().toggleCodeBlock().run() } },
      { id: 'format.highlight', title: 'Mark to come back to', group: 'Format', keywords: 'highlight revisit note comeback', run: () => { chain().toggleHighlight().run() } },
      { id: 'insert.table', title: 'Insert table', group: 'Insert', run: () => { chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() } },
      { id: 'insert.image', title: 'Insert image…', group: 'Insert', keywords: 'picture figure photo png jpg', run: () => void insertImage(editor, documentDir(docRef.path)) },
      { id: 'insert.taskList', title: 'Insert task list', group: 'Insert', keywords: 'todo checkbox', run: () => { chain().toggleTaskList().run() } },
      { id: 'insert.divider', title: 'Insert section break', group: 'Insert', keywords: 'horizontal rule divider hr', run: () => { chain().setHorizontalRule().run() } },
    ]
    const unregister = commands.map(registerCommand)
    return () => unregister.forEach((fn) => fn())
  }, [editor, newDocument, openDocument, saveDocument, exportPdf, checkpoint, measure, setMeasure, toggleTenant, setTenant, proseFont, cycleProseFont, docRef.path])

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

  const recovering = recoverable[0]

  return (
    <TooltipProvider>
      {/* The spine: manuscript, then the one companion slot. `auto` for the
          slot because the Companion fixes its own width and collapses to
          nothing (display: none) when closed — the grid never has to know
          which. No chrome rows: the top bar and the status line float over
          the manuscript column (Jack, 2026-08-07 — buttons float, the canvas
          runs edge to edge, letters not bars). */}
      <div className="grid h-screen grid-cols-[minmax(0,1fr)_auto] bg-[var(--essay-bg)] text-[var(--essay-text)]">
          <main className="relative flex min-h-0 flex-col overflow-hidden bg-[var(--essay-editor-bg)]">
            <TopBar
              docName={docRef.name}
              dirty={dirty}
              conflict={conflict !== null}
              tenant={tenant}
              onToggleTenant={toggleTenant}
              filesOpen={explorerOpen}
              onToggleFiles={() => setExplorerOpen((open) => !open)}
              onOpenPalette={() => setPaletteOpen(true)}
              waitingOnAuthor={waitingOnAuthor}
            />
            {/* Below the floating bar, above the page: the notices are the
                one piece of chrome that must not fade or float — they are
                asking the author a question about their own words. */}
            {recovering && (
              <div className="relative z-20 mt-10">
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
              </div>
            )}
            {conflict && !(conflict.byAgent && tenant === 'agent') && (
              // Reviewing is the primary action, not reloading or keeping:
              // the two blunt choices are only safe to make once the author
              // has seen which one costs them something.
              //
              // Suppressed only when the agent panel is open and the edit came
              // from the agent it is showing — there it is already a row with
              // better words on it, and two bars saying the same thing in
              // different language is how an author stops reading either.
              <div className={cn('relative z-20', !recovering && 'mt-10')}>
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
              </div>
            )}
            <div className="relative min-h-0 flex-1">
              <div
                className="h-full"
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
              {/* The gutter: ambient navigation at the manuscript's edge,
                  overlaid so the prose column's centring never shifts when
                  the companion opens or closes. Hidden in focus mode — the
                  point of focus mode is that nothing else is lit. */}
              {!focusMode && (
                <div className="essay-chrome absolute inset-y-0 left-1.5 z-10 flex">
                  <Gutter
                    outline={outline}
                    marks={marks}
                    activePos={activeOutlinePos}
                    onSelect={(item) => {
                      if (editor) revealHeading(editor, item.pos)
                    }}
                  />
                </div>
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
              {explorerOpen && (
                // Files grow out of the folders button (Jack, 2026-08-07):
                // an anchored popover — recents first, expandable into a
                // floating sidebar — never a centred modal. The panel plays
                // its own exit and calls onClose after — which is why the
                // conditional mount here doesn't clip the animation.
                <Suspense fallback={null}>
                  <FilesPanel
                    open={explorerOpen}
                    onClose={() => {
                      setExplorerOpen(false)
                      editor?.commands.focus()
                    }}
                    onOpenFile={(path) => void openByPath(path)}
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

            {/* The status line: letters, not a bar. It floats over the page's
                bottom edge and lets clicks fall through to the prose except on
                its own controls; the words carry enough contrast to be read
                and no frame to be noticed. */}
            <footer className="essay-chrome pointer-events-none absolute inset-x-0 bottom-0 z-30 flex h-9 items-center gap-4 px-4 text-[11px] font-[510] text-[var(--essay-text-muted)]">
              <span className="tabular-nums">{words.toLocaleString()} words</span>
              <span className="tabular-nums">{outline.length} sections</span>
              {tenant === 'proof' && preview.pageCount > 0 && (
                <span className="tabular-nums">{preview.pageCount} pages</span>
              )}
              {focusMode && (
                <button
                  type="button"
                  onClick={() => setFocusModeState(false)}
                  className="pointer-events-auto text-[var(--essay-accent)]"
                  title="Focus mode is on — click to turn off"
                >
                  focus
                </button>
              )}
              <span className="pointer-events-auto">
                <MeasureSelect value={measure} onChange={setMeasure} />
              </span>
              {/* The status line tells the truth in the durability layer's own
                  terms: a document with a path is guarded by hash and journal,
                  so "safe on disk" is a claim Essay can actually stand behind.
                  An untitled buffer is journalled but homeless, and the line
                  says so rather than pretending "unsaved" is a state of the
                  file. */}
              <span className="ml-auto text-[var(--essay-text-faint)]">
                {conflict
                  ? 'changed on disk'
                  : docRef.path
                    ? dirty
                      ? 'writing…'
                      : 'safe on disk'
                    : `only in memory — ${commandKey}S gives it a home`}
              </span>
            </footer>
          </main>

          <Companion
            tenant={tenant}
            onTenantChange={setTenant}
            structure={
              <Sidebar
                outline={outline}
                activePos={activeOutlinePos}
                marks={marks}
                onSelectOutline={(item) => {
                  if (editor) revealHeading(editor, item.pos)
                }}
                onSelectMark={(mark) => {
                  if (editor) revealPosition(editor, mark.pos)
                }}
              />
            }
            proof={
              // No fallback: the pane already has a "rendering…" state of
              // its own, and a second one flashing in front of it for the
              // length of a disk read would read as two loads, not one.
              <Suspense fallback={null}>
                <PrintPane preview={preview} />
              </Suspense>
            }
            agent={
              // The panel is passed mounted whether or not it is the visible
              // tenant (the Companion hides rather than unmounts it): a
              // session, a transcript and a queue of proposals all outlive
              // the author glancing away. The wrapper strips the panel's own
              // left border — the companion column already drew the frame.
              <div className="h-full [&>aside]:border-l-0">
                <AgentPanel
                  open={tenant === 'agent'}
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
                  onClose={() => setTenant(null)}
                />
              </div>
            }
            history={
              <HistoryPane
                documentPath={docRef.path}
                version={historyVersion}
                currentHash={baseHash}
                onCompare={(revision) => void compareRevision(revision)}
                onCheckpoint={() => void checkpoint()}
              />
            }
          />

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          outline={outline}
          onJumpToSection={(item) => {
            if (editor) revealHeading(editor, item.pos)
          }}
          onOpenFile={(path) => void openByPath(path)}
          onSearch={runSearch}
          currentPath={docRef.path}
        />
      </div>
    </TooltipProvider>
  )
}

