// The comments controller: one owner for the open document's threads, their
// live ranges, and the 'comment' decoration layer.
//
// Coordinates move in one direction. At load, the backend places every
// anchor against the buffer (essay-context decides; this module never
// guesses). From then on the ranges are the editor's: mapped here through
// every transaction — the same arithmetic the decoration layer does, kept in
// parallel because the layer's ranges carry no identity back out. At save,
// the current ranges become the new anchors (`refreshCommentAnchors`), so
// "exact" stays exact against the state that just reached disk. Unplaced
// threads never join that refresh: their stale anchor is the evidence a
// manual reattachment needs.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorEvents } from '@tiptap/core'
import {
  clearDecorationLayer,
  manuscriptText,
  positionAtOffset,
  setDecorationLayer,
  type DecorationRange,
  type Editor,
  type ManuscriptText,
} from '@essay/editor'
import { buildAnchorFrom, sectionSpans } from './commentAnchors'
import {
  createComment,
  deleteComment,
  listComments,
  reattachComment,
  refreshCommentAnchors,
  reopenComment,
  replyComment,
  resolveComment,
  type AnchorUpdate,
  type CommentAnchor,
  type CommentEntry,
  type CommentThread,
  type Placement,
  type PlacedThread,
} from './comments'

export interface CommentRange {
  from: number
  to: number
}

/** One thread as the UI holds it. The live range is read via `rangeOf`,
    never stored here — it moves with every keystroke. */
export interface CommentItem {
  thread: CommentThread
  entries: CommentEntry[]
  anchor: CommentAnchor
  /** What the backend said at the last reconciliation — `unplaced` is a
      visible state the rows must show, never a guess. */
  placement: Placement['kind']
}

export interface CommentsController {
  items: CommentItem[]
  /** Current editor range for a thread, or null when it has none (unplaced,
      or its text was deleted in this session). */
  rangeOf: (threadId: string) => CommentRange | null
  /** The thread open in Structure's detail view / strengthened in the text. */
  activeId: string | null
  setActiveId: (threadId: string | null) => void
  /** The composer's range: non-null while the author is writing a comment.
      Mapped through edits like any thread range. */
  pendingRange: CommentRange | null
  beginComposer: (from: number, to: number) => void
  cancelComposer: () => void
  /** Create on `range` (defaults to the composer's). True on success. */
  create: (body: string, range?: CommentRange) => Promise<boolean>
  reply: (threadId: string, body: string) => Promise<boolean>
  resolve: (threadId: string) => Promise<void>
  reopen: (threadId: string) => Promise<void>
  remove: (threadId: string) => Promise<void>
  /** Point an unplaced thread at the current selection. True on success. */
  reattach: (threadId: string) => Promise<boolean>
}

function itemOf(placed: PlacedThread): CommentItem {
  return {
    thread: placed.thread,
    entries: placed.entries,
    anchor: placed.anchor,
    placement: placed.placement.kind,
  }
}

/** A placement in the current buffer's editor coordinates, using the same
    flattened text the backend answered against. */
function rangeOfPlacement(
  placement: Placement,
  text: ManuscriptText,
  docSize: number,
): CommentRange | null {
  if (placement.kind === 'unplaced') return null
  let from: number
  let to: number
  if (placement.kind === 'exact') {
    from = Math.max(0, Math.min(placement.pmFrom, docSize))
    to = Math.max(0, Math.min(placement.pmTo, docSize))
  } else {
    from = positionAtOffset(text, placement.offsetFrom)
    to = positionAtOffset(text, placement.offsetTo)
  }
  return to > from ? { from, to } : null
}

export function useComments({
  editor,
  path,
  baseHash,
  loadVersion,
  onOpenFromText,
}: {
  editor: Editor | null
  path: string | null
  baseHash: string | null
  /** Bumped by every `loadIntoEditor` — the signal that the buffer itself
      was replaced (open, restore, reload), as opposed to saved. */
  loadVersion: number
  /** A decorated range was clicked: the shell should bring Structure out. */
  onOpenFromText: (threadId: string) => void
}): CommentsController {
  const [items, setItems] = useState<CommentItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [pendingRange, setPendingRange] = useState<CommentRange | null>(null)
  /** threadId → live range. A ref, not state: it moves on every keystroke
      and nothing should re-render for that — the decoration layer maps its
      own copy, and readers pull the current value at render time. */
  const rangesRef = useRef(new Map<string, CommentRange | null>())
  /** Bumped only when placement *membership* changes (a range collapsed, a
      reconcile landed) — the cases the paint and the rows must react to. */
  const [rangesVersion, setRangesVersion] = useState(0)
  /** Latest-wins guard for reconciles racing typing or each other. */
  const reconcileToken = useRef(0)
  const loadSeenRef = useRef(-1)

  const live = useRef({ editor, path, baseHash, items })
  live.current = { editor, path, baseHash, items }
  const onOpenRef = useRef(onOpenFromText)
  onOpenRef.current = onOpenFromText

  // ——— Load-time reconciliation, and the post-save anchor refresh ———
  //
  // One effect, two causes, told apart by `loadVersion`: a bumped version is
  // a replaced buffer (reconcile from the store), an unbumped `baseHash`
  // change is a save that landed (push the live ranges back as anchors).
  useEffect(() => {
    if (!editor) return
    const loaded = loadSeenRef.current !== loadVersion
    loadSeenRef.current = loadVersion

    if (loaded) {
      const token = ++reconcileToken.current
      const settle = (placed: PlacedThread[], text: ManuscriptText) => {
        const map = new Map<string, CommentRange | null>()
        for (const p of placed) {
          map.set(
            p.thread.id,
            rangeOfPlacement(p.placement, text, editor.state.doc.content.size),
          )
        }
        rangesRef.current = map
        setItems(placed.map(itemOf))
        setActiveId((current) =>
          current && placed.some((p) => p.thread.id === current) ? current : null,
        )
        setPendingRange(null)
        setRangesVersion((v) => v + 1)
      }
      const run = async () => {
        if (!path || !baseHash) {
          settle([], { text: '', runs: [] })
          return
        }
        // Captured before the round trip: if the doc moves underneath the
        // answer, the offsets no longer name what they named — re-ask.
        const doc = editor.state.doc
        const text = manuscriptText(editor)
        const sections = sectionSpans(editor, text)
        const placed = await listComments(path, text.text, baseHash, sections)
        if (token !== reconcileToken.current) return
        if (editor.isDestroyed) return
        if (editor.state.doc !== doc) {
          void run()
          return
        }
        settle(placed, text)
      }
      void run()
      return
    }

    // A save landed: every *placed* thread's anchor follows the new hash,
    // rebuilt from where its range is now. Unplaced threads stay untouched.
    if (!path || !baseHash) return
    const text = manuscriptText(editor)
    const spans = sectionSpans(editor, text)
    const updates: AnchorUpdate[] = []
    for (const item of live.current.items) {
      const range = rangesRef.current.get(item.thread.id)
      if (!range || range.to <= range.from) continue
      updates.push({
        threadId: item.thread.id,
        ...buildAnchorFrom(text, spans, range.from, range.to),
      })
    }
    if (updates.length > 0) void refreshCommentAnchors(path, baseHash, updates)
  }, [editor, path, baseHash, loadVersion])

  // ——— Ranges track edits ———
  useEffect(() => {
    if (!editor) return
    const onTransaction = ({ transaction }: EditorEvents['transaction']) => {
      if (!transaction.docChanged) return
      let collapsed = false
      for (const [id, range] of rangesRef.current) {
        if (!range) continue
        // Insertions at either boundary stay outside the comment: text typed
        // just before or just after a commented passage was not commented on.
        const from = transaction.mapping.map(range.from, 1)
        const to = transaction.mapping.map(range.to, -1)
        if (to > from) {
          rangesRef.current.set(id, { from, to })
        } else {
          // The commented text is gone. The thread stays, visibly detached —
          // and it is excluded from the next refresh, so the stored anchor
          // keeps describing the text that once existed.
          rangesRef.current.set(id, null)
          collapsed = true
        }
      }
      setPendingRange((range) => {
        if (!range) return range
        const from = transaction.mapping.map(range.from, 1)
        const to = transaction.mapping.map(range.to, -1)
        return to > from ? { from, to } : null
      })
      if (collapsed) setRangesVersion((v) => v + 1)
    }
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
    }
  }, [editor])

  // ——— Paint ———
  //
  // Whole-state replace on the layer, but only when membership or emphasis
  // changes — between these sets the layer maps itself, so typing never
  // re-enters here (rangesVersion deliberately does not track plain moves).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const ranges: DecorationRange[] = []
    for (const item of items) {
      const isActive = item.thread.id === activeId
      // Open threads paint; resolved ones leave the page — except the one
      // the author is currently reading, which needs its "where".
      if (item.thread.state !== 'open' && !isActive) continue
      const range = rangesRef.current.get(item.thread.id)
      if (!range) continue
      ranges.push({
        from: range.from,
        to: range.to,
        attrs: {
          class: isActive ? 'is-active' : '',
          'data-thread': item.thread.id,
        },
      })
    }
    if (pendingRange) {
      ranges.push({
        from: pendingRange.from,
        to: pendingRange.to,
        attrs: { class: 'is-active' },
      })
    }
    setDecorationLayer(editor, 'comment', ranges)
  }, [editor, items, activeId, pendingRange, rangesVersion])

  useEffect(() => {
    if (!editor) return
    return () => {
      if (!editor.isDestroyed) clearDecorationLayer(editor, 'comment')
    }
  }, [editor])

  // ——— Clicking a commented range opens its thread ———
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('.essay-deco-comment')) return
      const pos = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      })?.pos
      if (pos == null) return
      // Innermost first: with overlapping threads the smallest range is the
      // one whose words were clicked; the rest stay one row away in
      // Structure (never stacked cards over the prose).
      let best: { id: string; size: number } | null = null
      for (const item of live.current.items) {
        if (item.thread.state !== 'open') continue
        const range = rangesRef.current.get(item.thread.id)
        if (!range || pos < range.from || pos > range.to) continue
        const size = range.to - range.from
        if (!best || size < best.size) best = { id: item.thread.id, size }
      }
      if (!best) return
      setActiveId(best.id)
      onOpenRef.current(best.id)
    }
    dom.addEventListener('click', onClick)
    return () => dom.removeEventListener('click', onClick)
  }, [editor])

  // ——— Verbs ———

  const rangeOf = useCallback(
    (threadId: string) => rangesRef.current.get(threadId) ?? null,
    [],
  )

  const beginComposer = useCallback((from: number, to: number) => {
    if (to > from) setPendingRange({ from, to })
  }, [])

  const cancelComposer = useCallback(() => {
    setPendingRange(null)
  }, [])

  const create = useCallback(
    async (body: string, range?: CommentRange): Promise<boolean> => {
      const { editor, path, baseHash } = live.current
      if (!editor || !path || !baseHash) return false
      const target = range ?? pendingRange
      if (!target || !(target.to > target.from)) return false
      const text = manuscriptText(editor)
      const anchor = buildAnchorFrom(
        text,
        sectionSpans(editor, text),
        target.from,
        target.to,
      )
      const placed = await createComment(path, baseHash, body, anchor)
      if (!placed) return false
      rangesRef.current.set(placed.thread.id, { from: target.from, to: target.to })
      setItems((prev) => [...prev, itemOf(placed)])
      setPendingRange(null)
      setRangesVersion((v) => v + 1)
      return true
    },
    [pendingRange],
  )

  const reply = useCallback(
    async (threadId: string, body: string): Promise<boolean> => {
      const { path } = live.current
      if (!path) return false
      const entry = await replyComment(path, threadId, body)
      if (!entry) return false
      setItems((prev) =>
        prev.map((item) =>
          item.thread.id === threadId
            ? { ...item, entries: [...item.entries, entry] }
            : item,
        ),
      )
      return true
    },
    [],
  )

  const applyThread = useCallback((thread: CommentThread | null) => {
    if (!thread) return
    setItems((prev) =>
      prev.map((item) => (item.thread.id === thread.id ? { ...item, thread } : item)),
    )
  }, [])

  const resolve = useCallback(
    async (threadId: string) => {
      const { path } = live.current
      if (!path) return
      applyThread(await resolveComment(path, threadId))
    },
    [applyThread],
  )

  const reopen = useCallback(
    async (threadId: string) => {
      const { path } = live.current
      if (!path) return
      applyThread(await reopenComment(path, threadId))
    },
    [applyThread],
  )

  const remove = useCallback(async (threadId: string) => {
    const { path } = live.current
    if (!path) return
    const gone = await deleteComment(path, threadId)
    if (!gone) return
    rangesRef.current.delete(threadId)
    setItems((prev) => prev.filter((item) => item.thread.id !== threadId))
    setActiveId((current) => (current === threadId ? null : current))
  }, [])

  const reattach = useCallback(async (threadId: string): Promise<boolean> => {
    const { editor, path, baseHash } = live.current
    if (!editor || !path || !baseHash) return false
    const { from, to, empty } = editor.state.selection
    if (empty || !(to > from)) return false
    const text = manuscriptText(editor)
    const anchor = buildAnchorFrom(text, sectionSpans(editor, text), from, to)
    const placed = await reattachComment(path, threadId, baseHash, anchor)
    if (!placed) return false
    rangesRef.current.set(threadId, { from, to })
    setItems((prev) =>
      prev.map((item) => (item.thread.id === threadId ? itemOf(placed) : item)),
    )
    setRangesVersion((v) => v + 1)
    return true
  }, [])

  return {
    items,
    rangeOf,
    activeId,
    setActiveId,
    pendingRange,
    beginComposer,
    cancelComposer,
    create,
    reply,
    resolve,
    reopen,
    remove,
    reattach,
  }
}
