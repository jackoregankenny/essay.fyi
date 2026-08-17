import { shortcut } from '#/lib/platform'

/**
 * What you could press right now, said quietly in the footer.
 *
 * The problem this answers is the one the Structure pane had: Essay's good
 * parts are reachable by keys nobody has been told about, and a feature you
 * cannot find is a feature you do not have. A cheatsheet behind `?` would be a
 * reference — something you go and consult, once, and then never again. This
 * is the other kind: it sits where the eye already goes for state, says only
 * what applies to the cursor as it is *this second*, and is learned by
 * peripheral vision rather than by study. That is what makes it teach.
 *
 * Two at a time, never more. A row of eight bindings is a toolbar with the
 * buttons taken away, and it stops being read within a day — the discipline
 * that keeps this legible is that most of what Essay can do is deliberately
 * *not* here, and the palette is the honest home for the long tail.
 *
 * The pairs are chosen by what is otherwise hardest to discover. With a
 * passage selected: comment and mark, the two things the selection is *for*
 * and the two whose absence sent an author looking through menus. With no
 * selection: the palette and find, which is how you reach everything else.
 *
 * Bindings are declared here as they are written in the handler that owns them
 * (`Workspace`'s keydown, and Tiptap's own `Mod-Shift-h` for highlight), and
 * `shortcut()` translates the label for the platform. Nothing here binds
 * anything — a hint that could drift from its handler is worse than no hint,
 * so this file only ever describes.
 */

interface Hint {
  keys: string
  label: string
}

/** With a passage selected — the two actions the selection exists for. */
const ON_SELECTION: Hint[] = [
  { keys: shortcut('Ctrl+Alt+M'), label: 'comment' },
  { keys: shortcut('Ctrl+Shift+H'), label: 'mark' },
]

/** Otherwise — the two doors onto everything not listed. */
const ON_CARET: Hint[] = [
  { keys: shortcut('Ctrl+K'), label: 'commands' },
  { keys: shortcut('Ctrl+F'), label: 'find' },
]

export function ShortcutHints({ selectionEmpty }: { selectionEmpty: boolean }) {
  const hints = selectionEmpty ? ON_CARET : ON_SELECTION

  return (
    // Hidden below `md`, where the footer is already choosing between counts.
    // A hint is the most droppable thing in the row: it is the one item whose
    // whole value is that it costs nothing, and it stops being free the moment
    // it pushes a fact about the document off the screen.
    <span
      className="hidden shrink-0 items-center gap-2.5 text-[var(--essay-text-faint)] md:flex"
      // Announced only on request. A live region here would interrupt a screen
      // reader with a shortcut list every time the selection changed, which is
      // the opposite of unobtrusive; the same bindings are on the commands
      // themselves, where assistive tech already reads them.
      aria-hidden
    >
      {hints.map((hint) => (
        <span key={hint.label} className="flex items-center gap-1">
          <kbd className="font-(family-name:--essay-font-ui) text-[10px] tracking-wide">
            {hint.keys}
          </kbd>
          {hint.label}
        </span>
      ))}
    </span>
  )
}
