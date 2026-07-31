import { useEffect, useRef, useState } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState } from '@tiptap/react'
import {
  ArrowElbowDownLeft,
  Code,
  Link as LinkIcon,
  TextB,
  TextItalic,
  TextStrikethrough,
} from '@phosphor-icons/react'
import type { Editor } from '@essay/editor'
import { cn } from '#/lib/cn'

/** Floating formatting toolbar over text selections — the Typora feel. */
export function SelectionToolbar({ editor }: { editor: Editor }) {
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
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor, state }) => {
        if (state.selection.empty) return false
        if ('node' in state.selection) return false
        if (editor.isActive('codeBlock')) return false
        return editor.isEditable
      }}
      className="z-40 flex items-center gap-0.5 rounded-lg border border-[var(--essay-border)] bg-[var(--essay-bg)] p-1 shadow-lg"
    >
      {linkMode ? (
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
            title="Link"
            active={marks?.link}
            onClick={() => {
              const current = editor.getAttributes('link') as { href?: string }
              setUrl(current.href ?? '')
              setLinkMode(true)
            }}
          >
            <LinkIcon size={14} />
          </FormatButton>
        </>
      )}
    </BubbleMenu>
  )
}

function FormatButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-100',
        active
          ? 'bg-[var(--essay-selection)] text-[var(--essay-text)]'
          : 'text-[var(--essay-text-muted)] hover:bg-[color-mix(in_oklab,var(--essay-text)_8%,transparent)] hover:text-[var(--essay-text)]',
      )}
    >
      {children}
    </button>
  )
}
