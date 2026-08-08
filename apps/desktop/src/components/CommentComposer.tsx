import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { ChatCircle } from '@phosphor-icons/react'
import type { Editor } from '@essay/editor'
import { selectionQuote, truncateMiddle } from '#/lib/commentAnchors'
import { cn } from '#/lib/cn'

/**
 * The comment composer: one compact card at the selection, one plain-text
 * field, Comment or Cancel (docs/authoring-backlog.md item 7.2). Not a
 * formatting canvas, and never a stack of floating cards — the range itself
 * is already lit (the composer's pending paint), so the card only needs to
 * hold the words.
 *
 * Positioned once, at open, against the selection's end; the author is here
 * to type, not to scroll. On an untitled document the card says why it
 * cannot comment yet instead of failing silently: the sidecar needs a file
 * to live beside.
 */
export function CommentComposer({
  editor,
  range,
  needsSave,
  onSaveFirst,
  onSubmit,
  onCancel,
}: {
  editor: Editor
  range: { from: number; to: number }
  /** No path yet: comments live in `.essay/` beside the file. */
  needsSave: boolean
  onSaveFirst: () => void
  onSubmit: (body: string) => Promise<boolean>
  onCancel: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })

  // Below the selection's last line, clamped to the manuscript cell. One
  // measurement at open — the card does not chase the text afterwards.
  useLayoutEffect(() => {
    const card = cardRef.current
    const parent = card?.offsetParent
    if (!card || !parent) return
    let coords: { left: number; bottom: number; top: number }
    try {
      coords = editor.view.coordsAtPos(Math.min(range.to, editor.state.doc.content.size))
    } catch {
      onCancel()
      return
    }
    const parentRect = parent.getBoundingClientRect()
    const width = card.offsetWidth
    const height = card.offsetHeight
    const left = Math.max(
      8,
      Math.min(coords.left - parentRect.left, parentRect.width - width - 8),
    )
    let top = coords.bottom - parentRect.top + 8
    if (top + height > parentRect.height - 8) {
      top = Math.max(8, coords.top - parentRect.top - height - 8)
    }
    setStyle({ top, left })
    fieldRef.current?.focus({ preventScroll: true })
    // Measured once at open, on purpose: the card does not chase the text.
  }, [])

  const submit = async () => {
    const trimmed = body.trim()
    if (!trimmed || busy || needsSave) return
    setBusy(true)
    const ok = await onSubmit(trimmed)
    setBusy(false)
    if (!ok) fieldRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  // Memoised: flattening walks the whole document, and the card re-renders
  // on every keystroke in its own field.
  const quote = useMemo(
    () => truncateMiddle(selectionQuote(editor, range.from, range.to)),
    [editor, range.from, range.to],
  )

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Comment on selection"
      style={style}
      className={cn(
        'absolute z-30 w-80 rounded-lg border border-[var(--essay-border)]',
        'bg-[color-mix(in_oklab,var(--essay-bg)_94%,transparent)] p-2.5 shadow-[var(--essay-shadow-medium)] backdrop-blur-md',
        'motion-safe:animate-[essay-pop_var(--essay-speed-quick)_var(--essay-ease-out)_both]',
      )}
    >
      <div className="mb-1.5 flex items-start gap-1.5 text-[11px] leading-[1.45] text-[var(--essay-text-faint)]">
        <ChatCircle size={12} className="mt-[2px] shrink-0" aria-hidden />
        <span className="min-w-0 italic">“{quote}”</span>
      </div>
      {needsSave ? (
        <>
          <p className="mb-2 text-[12px] leading-[1.5] text-[var(--essay-text-muted)]">
            Save the document first — comments live beside the file, and an
            untitled draft has nothing to live beside.
          </p>
          <div className="flex justify-end gap-1.5">
            <ComposerButton onClick={onCancel}>Cancel</ComposerButton>
            <ComposerButton primary onClick={onSaveFirst}>
              Save document…
            </ComposerButton>
          </div>
        </>
      ) : (
        <>
          <textarea
            ref={fieldRef}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Say it about this passage…"
            aria-label="Comment"
            spellCheck
            className={cn(
              'mb-1.5 w-full resize-none rounded-md bg-transparent px-1 py-0.5',
              'text-[13px] leading-[1.5] text-[var(--essay-text)] outline-none',
              'placeholder:text-[var(--essay-text-faint)]',
            )}
          />
          <div className="flex items-center justify-end gap-1.5">
            <ComposerButton onClick={onCancel}>Cancel</ComposerButton>
            <ComposerButton
              primary
              disabled={!body.trim() || busy}
              onClick={() => void submit()}
            >
              Comment
            </ComposerButton>
          </div>
        </>
      )}
    </div>
  )
}

function ComposerButton({
  children,
  primary,
  disabled,
  onClick,
}: {
  children: string
  primary?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-6 shrink-0 rounded-md px-2.5 text-[12px] font-[var(--essay-weight-medium)]',
        'transition-colors duration-[var(--essay-speed-quick)] ease-[var(--essay-ease-out)]',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
        'disabled:pointer-events-none disabled:opacity-40',
        primary
          ? 'bg-[var(--essay-accent-tint)] text-[var(--essay-accent)] hover:bg-[color-mix(in_oklch,var(--essay-accent-tint),var(--essay-accent)_10%)]'
          : 'text-[var(--essay-text-muted)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]',
      )}
    >
      {children}
    </button>
  )
}
