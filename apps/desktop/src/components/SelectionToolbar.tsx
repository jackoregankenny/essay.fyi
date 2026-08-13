import { useEffect, useRef, useState } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState } from '@tiptap/react'
import {
  ArrowElbowDownLeft,
  ChatCircle,
  Code,
  Columns,
  ColumnsPlusLeft,
  ColumnsPlusRight,
  HighlighterCircle,
  Link as LinkIcon,
  ListBullets,
  ListNumbers,
  Rows,
  RowsPlusBottom,
  RowsPlusTop,
  Swap,
  Table as TableIcon,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextItalic,
  TextStrikethrough,
  Trash,
} from '@phosphor-icons/react'
import type { Editor } from '@essay/editor'
import { cn } from '#/lib/cn'
import { replaceImage } from '#/lib/images'

type ColumnAlign = 'left' | 'center' | 'right' | null

/** The selected image node's attrs, or null when the selection is not one. */
function selectedImage(editor: Editor) {
  const selection = editor.state.selection as unknown as {
    node?: { type: { name: string }; attrs: Record<string, unknown> }
    from: number
  }
  const node = selection.node
  if (!node || node.type.name !== 'image') return null
  return {
    src: (node.attrs.src as string | null) ?? '',
    alt: (node.attrs.alt as string | null) ?? '',
    title: (node.attrs.title as string | null) ?? '',
    pos: selection.from,
  }
}

/** Floating formatting toolbar over text selections — the Typora feel. */
export function SelectionToolbar({
  editor,
  onComment,
}: {
  editor: Editor
  /** Open the comment composer on the given selection. One action for any
      non-empty text or cell selection, including multi-block sweeps —
      commenting spans the argument, not the paragraph. */
  onComment?: (from: number, to: number) => void
}) {
  const [linkMode, setLinkMode] = useState(false)
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const marks = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      code: editor.isActive('code'),
      link: editor.isActive('link'),
      highlight: editor.isActive('highlight'),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      table: editor.isActive('table'),
      caretOnly: editor.state.selection.empty,
      image: selectedImage(editor),
      // Alignment of the caret's column, for the active state on the three
      // align buttons. Read from whichever cell kind the caret is in.
      tableAlign: ((editor.getAttributes('tableCell').align ??
        editor.getAttributes('tableHeader').align ??
        null) as ColumnAlign),
    }),
  })

  useEffect(() => {
    if (linkMode) inputRef.current?.focus()
  }, [linkMode])

  const applyLink = () => {
    const href = url.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (href) chain.setLink({ href }).run()
    else chain.unsetLink().run()
    setLinkMode(false)
    setUrl('')
  }

  return (
    <BubbleMenu
      editor={editor}
      updateDelay={60}
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor, state }) => {
        // A bare caret inside a table still gets the toolbar: the table
        // controls (add/delete row/column) act on position, not on a
        // selection, and a caret is how an author is usually in a table.
        // Node selections are rejected except for images, which get their
        // own compact toolbar (alt, title, replace) below.
        if ('node' in state.selection) {
          const node = (state.selection as { node?: { type: { name: string } } }).node
          return node?.type.name === 'image' ? editor.isEditable : false
        }
        if (state.selection.empty && !editor.isActive('table')) return false
        if (editor.isActive('codeBlock')) return false
        return editor.isEditable
      }}
      className="essay-bubble z-40 flex items-center gap-0.5 rounded-[var(--essay-radius-6)] border border-[var(--essay-border)] bg-[var(--essay-surface)] p-1 shadow-[var(--essay-shadow-low)] focus-within:border-[var(--essay-border-strong)]"
    >
      {marks?.image ? (
        // Keyed by position so selecting a different image resets the inputs.
        <ImageControls key={marks.image.pos} editor={editor} image={marks.image} />
      ) : linkMode ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            applyLink()
          }}
        >
          <input
            ref={inputRef}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setLinkMode(false)
                editor.commands.focus()
              }
            }}
            placeholder="Paste or type a link…"
            className="h-7 w-56 rounded-md bg-transparent px-2 text-[13px] text-[var(--essay-text)] outline-none placeholder:text-[var(--essay-text-faint)]"
          />
          <FormatButton title="Apply link" onClick={applyLink}>
            <ArrowElbowDownLeft size={14} />
          </FormatButton>
        </form>
      ) : (
        <>
          {/* Marks still apply inside table cells, so the table controls are
              appended after a divider rather than replacing them — replacing
              would take bold/italic away exactly where an author is styling a
              header row. On a bare caret the mark buttons would act on
              nothing, so only the table group renders. */}
          {!marks?.caretOnly && <MarkButtons editor={editor} marks={marks} openLink={() => {
            const current = editor.getAttributes('link') as { href?: string }
            setUrl(current.href ?? '')
            setLinkMode(true)
          }} />}
          {/* One Comment action for any non-empty selection — a cell
              selection lands here too, and its comment honestly covers the
              contiguous flattened text between the selection's corners. */}
          {!marks?.caretOnly && onComment && (
            <>
              <span className="mx-0.5 h-4 w-px bg-[var(--essay-border)]" />
              <FormatButton
                title="Comment on selection"
                onClick={() => {
                  const { from, to } = editor.state.selection
                  onComment(from, to)
                }}
              >
                <ChatCircle size={14} />
              </FormatButton>
            </>
          )}
          {marks?.table && (
            <TableButtons editor={editor} align={marks?.tableAlign ?? null} caretOnly={marks?.caretOnly} />
          )}
        </>
      )}
    </BubbleMenu>
  )
}

function MarkButtons({
  editor,
  marks,
  openLink,
}: {
  editor: Editor
  marks:
    | {
        bold: boolean
        italic: boolean
        strike: boolean
        code: boolean
        link: boolean
        highlight: boolean
        bulletList: boolean
        orderedList: boolean
      }
    | null
    | undefined
  openLink: () => void
}) {
  return (
    <>
      <FormatButton
        title="Bold"
        active={marks?.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <TextB size={14} weight="bold" />
      </FormatButton>
      <FormatButton
        title="Italic"
        active={marks?.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <TextItalic size={14} />
      </FormatButton>
      <FormatButton
        title="Strikethrough"
        active={marks?.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <TextStrikethrough size={14} />
      </FormatButton>
      <FormatButton
        title="Code"
        active={marks?.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code size={14} />
      </FormatButton>
      <span className="mx-0.5 h-4 w-px bg-[var(--essay-border)]" />
      <FormatButton
        title="Bullet list"
        active={marks?.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <ListBullets size={14} />
      </FormatButton>
      <FormatButton
        title="Numbered list"
        active={marks?.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListNumbers size={14} />
      </FormatButton>
      <span className="mx-0.5 h-4 w-px bg-[var(--essay-border)]" />
      <FormatButton
        title="Mark to come back to"
        active={marks?.highlight}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      >
        <HighlighterCircle size={14} />
      </FormatButton>
      <FormatButton title="Link" active={marks?.link} onClick={openLink}>
        <LinkIcon size={14} />
      </FormatButton>
    </>
  )
}

/** The table control group: structure, header, per-column alignment. */
function TableButtons({
  editor,
  align,
  caretOnly,
}: {
  editor: Editor
  align: ColumnAlign
  caretOnly: boolean | undefined
}) {
  // ManuscriptTableEditing's command typings reach '@essay/editor' consumers
  // only once the extension is wired into manuscriptExtensions(); until that
  // wiring lands this cast keeps the seam visible — and the command optional,
  // because on an editor without the extension it is undefined, not a no-op.
  const tableEditing = editor.commands as unknown as {
    setColumnAlign?: (align: ColumnAlign) => boolean
  }
  // Clicking the active alignment clears it back to the bare `---` marker.
  const applyAlign = (next: Exclude<ColumnAlign, null>) => {
    editor.commands.focus()
    tableEditing.setColumnAlign?.(align === next ? null : next)
  }

  return (
    <>
      {!caretOnly && <span className="mx-0.5 h-4 w-px bg-[var(--essay-border)]" />}
      <FormatButton
        title="Add row above"
        onClick={() => editor.chain().focus().addRowBefore().run()}
      >
        <RowsPlusTop size={14} />
      </FormatButton>
      <FormatButton
        title="Add row below"
        onClick={() => editor.chain().focus().addRowAfter().run()}
      >
        <RowsPlusBottom size={14} />
      </FormatButton>
      <FormatButton
        title="Add column left"
        onClick={() => editor.chain().focus().addColumnBefore().run()}
      >
        <ColumnsPlusLeft size={14} />
      </FormatButton>
      <FormatButton
        title="Add column right"
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      >
        <ColumnsPlusRight size={14} />
      </FormatButton>
      <span className="mx-0.5 h-4 w-px bg-[var(--essay-border)]" />
      <FormatButton
        title="Toggle header row"
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
      >
        <TableIcon size={14} />
      </FormatButton>
      <FormatButton
        title="Align column left"
        active={align === 'left'}
        onClick={() => applyAlign('left')}
      >
        <TextAlignLeft size={14} />
      </FormatButton>
      <FormatButton
        title="Align column centre"
        active={align === 'center'}
        onClick={() => applyAlign('center')}
      >
        <TextAlignCenter size={14} />
      </FormatButton>
      <FormatButton
        title="Align column right"
        active={align === 'right'}
        onClick={() => applyAlign('right')}
      >
        <TextAlignRight size={14} />
      </FormatButton>
      <span className="mx-0.5 h-4 w-px bg-[var(--essay-border)]" />
      <FormatButton
        title="Delete row"
        onClick={() => editor.chain().focus().deleteRow().run()}
      >
        <Rows size={14} />
      </FormatButton>
      <FormatButton
        title="Delete column"
        onClick={() => editor.chain().focus().deleteColumn().run()}
      >
        <Columns size={14} />
      </FormatButton>
      <FormatButton
        title="Delete table"
        onClick={() => editor.chain().focus().deleteTable().run()}
      >
        <Trash size={14} />
      </FormatButton>
    </>
  )
}

/**
 * The image bubble: alt and title (applied on Enter or blur), replace via
 * the native picker, and the original Markdown path shown quietly — the
 * honest answer to "which file is this?", especially while it is broken.
 * "Reveal in Finder"/"Open" wait on an opener plugin the app does not ship
 * yet (no @tauri-apps/plugin-opener in the workspace).
 */
function ImageControls({
  editor,
  image,
}: {
  editor: Editor
  image: { src: string; alt: string; title: string }
}) {
  const [alt, setAlt] = useState(image.alt)
  const [title, setTitle] = useState(image.title)

  const apply = () => {
    // Empty stays null so `![](x.png)` does not grow an empty title.
    editor
      .chain()
      .focus()
      .updateAttributes('image', {
        alt: alt.trim() || null,
        title: title.trim() || null,
      })
      .run()
  }

  const keys = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      apply()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      editor.commands.focus()
    }
  }

  return (
    <div className="flex items-center gap-1">
      <input
        value={alt}
        onChange={(event) => setAlt(event.target.value)}
        onBlur={apply}
        onKeyDown={keys}
        placeholder="Alt text"
        aria-label="Alt text"
        className="h-7 w-36 rounded-md bg-transparent px-2 text-[13px] text-[var(--essay-text)] outline-none placeholder:text-[var(--essay-text-faint)]"
      />
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={apply}
        onKeyDown={keys}
        placeholder="Title"
        aria-label="Title"
        className="h-7 w-28 rounded-md bg-transparent px-2 text-[13px] text-[var(--essay-text)] outline-none placeholder:text-[var(--essay-text-faint)]"
      />
      <FormatButton title="Replace image…" onClick={() => void replaceImage(editor)}>
        <Swap size={14} />
      </FormatButton>
      {/* Disabled honestly rather than pretending: an image contributes no
          text to the flattened buffer, so an anchor here would have no quote
          to find itself with after an edit. */}
      <FormatButton
        title="An image has no quotable text to anchor a comment — select the prose around it instead"
        disabled
        onClick={() => {}}
      >
        <ChatCircle size={14} />
      </FormatButton>
      <span
        title={image.src}
        className="max-w-44 truncate px-1.5 font-mono text-[11px] text-[var(--essay-text-faint)]"
      >
        {image.src}
      </span>
    </div>
  )
}

function FormatButton({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-[color,background-color,transform] duration-[var(--essay-speed-quick)] ease-[var(--essay-ease-out)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)] motion-safe:active:scale-[0.96]',
        // No pointer-events-none: the title is the explanation, and it only
        // shows if the pointer still reaches the button.
        'disabled:opacity-40 disabled:hover:bg-transparent',
        active
          ? 'bg-[var(--essay-selection)] text-[var(--essay-text)]'
          : 'text-[var(--essay-text-muted)] hover:bg-[color-mix(in_oklab,var(--essay-text)_8%,transparent)] hover:text-[var(--essay-text)]',
      )}
    >
      {children}
    </button>
  )
}
