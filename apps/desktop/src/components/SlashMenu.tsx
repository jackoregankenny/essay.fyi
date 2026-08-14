import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react'
import { createPortal } from 'react-dom'
import {
  CheckSquare,
  CodeBlock,
  ListBullets,
  ListNumbers,
  Minus,
  Quotes,
  Table,
  TextHOne,
  TextHTwo,
  TextT,
} from '@phosphor-icons/react'
import type { Editor } from '@essay/editor'
import { cn } from '#/lib/cn'

interface SlashState {
  from: number
  to: number
  query: string
  left: number
  top: number
}

interface SlashCommand {
  title: string
  detail: string
  keywords: string
  icon: ComponentType<{ size?: number; className?: string }>
  run: (editor: Editor) => void
}

const COMMANDS: ReadonlyArray<SlashCommand> = [
  {
    title: 'Text',
    detail: 'Plain paragraph',
    keywords: 'paragraph body normal',
    icon: TextT,
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    title: 'Heading 1',
    detail: 'Document title',
    keywords: 'title h1',
    icon: TextHOne,
    run: (editor) => editor.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    detail: 'Section heading',
    keywords: 'section h2',
    icon: TextHTwo,
    run: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    title: 'Bullet list',
    detail: 'Unordered list',
    keywords: 'list bullets unordered',
    icon: ListBullets,
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    detail: 'Ordered list',
    keywords: 'list numbers ordered',
    icon: ListNumbers,
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: 'Task list',
    detail: 'Checklist',
    keywords: 'todo checkbox checklist',
    icon: CheckSquare,
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    title: 'Quote',
    detail: 'Block quotation',
    keywords: 'blockquote citation',
    icon: Quotes,
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    title: 'Code block',
    detail: 'Fenced code',
    keywords: 'code fence snippet',
    icon: CodeBlock,
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: 'Table',
    detail: '3 × 3 with header',
    keywords: 'grid rows columns',
    icon: Table,
    run: (editor) =>
      editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    title: 'Divider',
    detail: 'Section break',
    keywords: 'horizontal rule separator',
    icon: Minus,
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
]

/**
 * A small block-command menu summoned by `/` at the start of a paragraph.
 *
 * The slash remains ordinary manuscript text until the author chooses a
 * command. Choosing removes exactly the typed `/query` range, then runs the
 * normal Tiptap command; no temporary node or sidecar state enters Markdown.
 */
export function SlashMenu({ editor }: { editor: Editor }) {
  const [state, setState] = useState<SlashState | null>(null)
  const [active, setActive] = useState(0)
  const dismissedAt = useRef<string | null>(null)

  useEffect(() => {
    const refresh = () => {
      const { selection } = editor.state
      if (!selection.empty || !editor.isEditable) {
        setState(null)
        return
      }
      const { $from } = selection
      if (!$from.parent.isTextblock || $from.parent.type.name !== 'paragraph') {
        setState(null)
        return
      }
      const before = $from.parent.textBetween(0, $from.parentOffset, '\0', '\0')
      const match = /^\/([^\s/]*)$/.exec(before)
      if (!match) {
        dismissedAt.current = null
        setState(null)
        return
      }
      const identity = `${selection.from}:${before}`
      if (dismissedAt.current === identity) return
      const coords = editor.view.coordsAtPos(selection.from)
      const menuAbove = coords.bottom + 330 > window.innerHeight
      setState({
        from: selection.from - before.length,
        to: selection.from,
        query: match[1].toLowerCase(),
        left: Math.max(8, Math.min(coords.left, window.innerWidth - 296)),
        top: menuAbove ? Math.max(8, coords.top - 318) : coords.bottom + 8,
      })
    }
    editor.on('update', refresh)
    editor.on('selectionUpdate', refresh)
    return () => {
      editor.off('update', refresh)
      editor.off('selectionUpdate', refresh)
    }
  }, [editor])

  const items = useMemo(() => {
    if (!state) return []
    const query = state.query
    return COMMANDS.filter((command) =>
      `${command.title} ${command.detail} ${command.keywords}`
        .toLowerCase()
        .includes(query),
    )
  }, [state])

  useEffect(() => setActive(0), [state?.query])

  const choose = (command: SlashCommand) => {
    if (!state) return
    dismissedAt.current = null
    editor.chain().focus().deleteRange({ from: state.from, to: state.to }).run()
    command.run(editor)
    setState(null)
  }

  useEffect(() => {
    if (!state) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive((index) => (items.length ? (index + 1) % items.length : 0))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((index) =>
          items.length ? (index - 1 + items.length) % items.length : 0,
        )
      } else if (event.key === 'Enter') {
        const command = items[active]
        if (!command) return
        event.preventDefault()
        choose(command)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        dismissedAt.current = `${state.to}:${editor.state.selection.$from.parent.textBetween(0, editor.state.selection.$from.parentOffset, '\0', '\0')}`
        setState(null)
      }
    }
    const dom = editor.view.dom
    // Capture before ProseMirror's own key handler. If Enter reaches it first,
    // it creates a fresh paragraph and the chosen block appears one row late.
    dom.addEventListener('keydown', onKeyDown, true)
    return () => dom.removeEventListener('keydown', onKeyDown, true)
  }, [active, editor, items, state])

  if (!state) return null

  return createPortal(
    <div
      role="menu"
      aria-label="Insert block"
      className="essay-floating essay-slash-menu essay-pop fixed w-72 overflow-hidden"
      style={{ left: state.left, top: state.top }}
    >
      <div className="border-b border-[var(--essay-border)] px-3 py-2 text-[10px] font-[590] tracking-wider text-[var(--essay-text-faint)] uppercase">
        Insert
      </div>
      <ul className="max-h-[276px] overflow-y-auto p-1.5">
        {items.length === 0 ? (
          <li className="px-2.5 py-3 text-[12px] text-[var(--essay-text-faint)]">
            No block matches “{state.query}”
          </li>
        ) : (
          items.map((command, index) => {
            const Icon = command.icon
            return (
              <li key={command.title}>
                <button
                  type="button"
                  role="menuitem"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    choose(command)
                  }}
                  onMouseMove={() => setActive(index)}
                  className={cn(
                    'relative flex w-full items-center gap-2.5 rounded-[var(--essay-radius-6)] px-2.5 py-1.5 text-left',
                    index === active
                      ? 'bg-[var(--essay-surface-hover)] text-[var(--essay-text)]'
                      : 'text-[var(--essay-text-muted)]',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-y-1 left-0.5 w-0.5 rounded-full bg-[var(--essay-accent)] transition-opacity duration-[var(--essay-speed-quick)]',
                      index === active ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <Icon size={15} className="shrink-0 text-[var(--essay-text-faint)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-[510]">
                      {command.title}
                    </span>
                    <span className="block truncate text-[10.5px] text-[var(--essay-text-faint)]">
                      {command.detail}
                    </span>
                  </span>
                </button>
              </li>
            )
          })
        )}
      </ul>
    </div>,
    document.body,
  )
}
