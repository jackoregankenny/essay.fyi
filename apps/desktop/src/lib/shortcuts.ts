// Every keystroke Essay answers to, declared once.
//
// This file exists because the same binding used to be written down in three
// places that could disagree: the keydown handler in `Workspace`, the
// `shortcut:` string on the matching command in the palette registry, and the
// footer hints in `ShortcutHints`. Nothing kept them in step. `ShortcutHints`
// said so in its own doc comment and drew the only conclusion available to it
// at the time — that a hint which could drift from its handler is worse than
// no hint, so it would only ever *describe*. That instinct was right and the
// answer to it is not a fourth list; it is to make the description and the
// binding the same declaration. Every surface now reads from `BINDINGS`.
//
// What this file is not: a keymap. It does not bind anything, and it cannot —
// the two surfaces that own these keys bind them in incompatible ways.
// Tiptap's extensions register `Mod-b` through ProseMirror's keymap plugin,
// inside the editor's own view; the chrome listens on `window`. A "generic"
// binder over both would have to be a worse version of each. So the honest
// arrangement is that the catalogue is the written record — the one place a
// key is spelled — and the handlers read from it or, for the manuscript's
// half, are transcribed against it. The transcription was taken from the
// installed extensions rather than from memory (see the note on `BINDINGS`),
// and `manuscriptShadow()` is what catches the one failure mode that a shared
// declaration cannot: two surfaces spelling the same chord.
//
// # Two surfaces, and the order between them matters
//
// The manuscript (Tiptap) is nested inside the window, so it sees every
// keystroke first, and ProseMirror calls `preventDefault` on every shortcut it
// handles. `Workspace`'s listener therefore bails on `event.defaultPrevented`:
// the chrome only ever acts on keys the manuscript did not want. That is not
// an implementation detail to hide behind a uniform list — it decides whether
// a binding works at all while the caret is in the prose, which is where the
// caret nearly always is. `surface` records it, and `manuscriptShadow()` is
// how a reference list can say out loud which chrome bindings the manuscript
// takes first.
//
// This is how the two binding changes of 2026-08-19 were found and argued:
// Structure was on Ctrl+B, which Tiptap spends on bold before the chrome is
// consulted, so the panel had been unreachable from the prose since the day
// the editor became rich text; it is now Ctrl+\. And comment moved from
// Ctrl+Alt+M — Word's and Docs' binding, chosen for the muscle memory — to
// the simpler Ctrl+/, which is free in both surfaces.
//
// # Spelling
//
// Keys are written in the Windows/Linux spelling, which is also the spelling
// the handlers use, and `shortcut()` from `#/lib/platform` translates the
// label at the point it is read. The handler has always accepted `metaKey` as
// well as `ctrlKey`, so on macOS only the labels were ever wrong. `macKeys` is
// the escape hatch for the one binding where the *key itself* differs rather
// than its name.

import { isMac, shortcut } from '#/lib/platform'

/**
 * Who consumes the keystroke.
 *
 * `manuscript` — bound by a Tiptap extension (StarterKit, the list kit,
 * Highlight, or one of Essay's own in `@essay/editor`). Fires only while the
 * caret is in the prose, and fires *before* the chrome sees anything.
 *
 * `chrome` — bound by `Workspace`'s window listener. Fires from anywhere in
 * the app *except* where the manuscript has already claimed the same keys.
 */
export type Surface = 'manuscript' | 'chrome'

/**
 * Grouping for the reference list, by what the author is trying to do rather
 * than by which surface answers. A reader looking for "how do I comment on
 * this?" does not know or care that the comment composer is chrome and the
 * highlight beside it is a Tiptap mark, so the groups mix the two freely and
 * the reference names the surface only where it changes the answer.
 */
export interface ShortcutGroup {
  id: string
  title: string
  /** One line under the heading. Empty for groups that need no explaining. */
  blurb?: string
}

export const GROUPS: readonly ShortcutGroup[] = [
  {
    id: 'around',
    title: 'Getting around',
    blurb: 'The doors onto everything not listed here.',
  },
  { id: 'documents', title: 'Documents' },
  { id: 'views', title: 'Views' },
  {
    id: 'writing',
    title: 'Writing',
    blurb: 'What the selection is for.',
  },
  {
    id: 'blocks',
    title: 'Blocks',
    blurb: 'Turn the paragraph the caret is in into something else.',
  },
]

export interface Binding {
  /**
   * Stable id. Where a palette command exists for the same action this is
   * *its* id, so `keysFor('view.structure')` and the command are provably
   * about the same thing rather than two strings that happen to match.
   */
  id: string
  /** Windows/Linux spelling, exactly as the owning handler writes it. */
  keys: string
  /**
   * A second way to reach the same action, shown after a middle dot. Only for
   * genuine aliases the handler really accepts — not for near misses.
   */
  alsoKeys?: string
  /**
   * Used verbatim on macOS instead of translating `keys`. Exactly one binding
   * needs this and the reason is in its comment; if a second ever does, be
   * suspicious.
   */
  macKeys?: string
  /** Sentence-case, for the reference list. */
  label: string
  /**
   * The footer's one-word form. Present only on bindings that are candidates
   * for `ShortcutHints`, which is most of them not.
   */
  hint?: string
  surface: Surface
  group: (typeof GROUPS)[number]['id']
  /** A caveat worth printing beside the row in the reference. */
  note?: string
}

/**
 * The catalogue.
 *
 * Order within a group is presentation order in the reference list. The
 * manuscript half was transcribed from the extensions themselves rather than
 * from memory — @tiptap/starter-kit, @tiptap/extension-list and
 * @tiptap/extension-highlight as installed — because Tiptap's defaults are not
 * all the ones a Word user would guess (`Ctrl+E` is code, not centre) and a
 * reference that is wrong about a key is worse than one that omits it.
 *
 * Deliberately absent, and each for a reason:
 *
 * - **Ctrl+U, underline.** StarterKit binds it and it is not disabled, so it
 *   does apply the mark — but @tiptap/markdown has no spelling for underline,
 *   so it is dropped on save. Listing it would be advertising a mark the file
 *   cannot carry, which invariant 2 makes the worst kind of promise to break.
 * - **The find strip's own keys** (Enter, Shift+Enter, Alt+C, Alt+W). They
 *   only apply while the strip is on screen, and the strip labels every one of
 *   them on the control it belongs to. A reference is for what is invisible.
 * - **ProseMirror's editing keys** (Ctrl+A, Ctrl+Backspace, Tab in a list).
 *   Every text field on the machine has these; they are not Essay's to teach.
 */
export const BINDINGS: readonly Binding[] = [
  // ── Getting around ──────────────────────────────────────────────────────
  {
    id: 'palette.open',
    keys: 'Ctrl+K',
    label: 'Command palette',
    hint: 'commands',
    surface: 'chrome',
    group: 'around',
  },
  {
    id: 'file.findInDocument',
    keys: 'Ctrl+F',
    label: 'Find in document',
    hint: 'find',
    surface: 'chrome',
    group: 'around',
  },
  {
    id: 'file.nextTab',
    keys: 'Ctrl+Tab',
    // The one binding that is not Ctrl→⌘. ⌘Tab is the macOS application
    // switcher and never reaches a window, so document cycling stays on
    // Control there; the handler already accepts either modifier, so only the
    // label moves.
    macKeys: '⌃Tab',
    label: 'Next document',
    surface: 'chrome',
    group: 'around',
  },
  {
    id: 'file.prevTab',
    keys: 'Ctrl+Shift+Tab',
    macKeys: '⌃⇧Tab',
    label: 'Previous document',
    surface: 'chrome',
    group: 'around',
  },
  {
    id: 'file.selectTab',
    keys: 'Ctrl+1…9',
    label: 'Go to an open document',
    note: '9 is the last one open, whatever the count.',
    surface: 'chrome',
    group: 'around',
  },
  {
    id: 'chrome.dismiss',
    keys: 'Esc',
    label: 'Close what is open',
    note: 'Proof, then the explorer, then find, then the companion.',
    surface: 'chrome',
    group: 'around',
  },

  // ── Documents ───────────────────────────────────────────────────────────
  {
    id: 'file.new',
    keys: 'Ctrl+N',
    // Ctrl+T as well, because in a workspace that shows open documents the
    // reflex is "new tab", and here a new tab *is* a new document.
    alsoKeys: 'Ctrl+T',
    label: 'New document',
    surface: 'chrome',
    group: 'documents',
  },
  {
    id: 'file.open',
    keys: 'Ctrl+O',
    label: 'Open a file',
    surface: 'chrome',
    group: 'documents',
  },
  {
    id: 'file.save',
    keys: 'Ctrl+S',
    label: 'Save',
    surface: 'chrome',
    group: 'documents',
  },
  {
    id: 'file.saveAs',
    keys: 'Ctrl+Shift+S',
    label: 'Save as',
    surface: 'chrome',
    group: 'documents',
  },
  {
    id: 'file.closeTab',
    keys: 'Ctrl+W',
    label: 'Close document',
    surface: 'chrome',
    group: 'documents',
  },

  // ── Views ───────────────────────────────────────────────────────────────
  {
    id: 'view.structure',
    // Was Ctrl+B until 2026-08-19, and unreachable from the prose for all of
    // that time: Tiptap bolds on Ctrl+B and marks the event handled, so the
    // chrome never saw it. Ctrl+\ is claimed by neither surface, and sits
    // beside the panel it opens on a physical keyboard.
    keys: 'Ctrl+\\',
    label: 'Structure',
    surface: 'chrome',
    group: 'views',
  },
  {
    id: 'view.proof',
    keys: 'Ctrl+J',
    label: 'Proof',
    surface: 'chrome',
    group: 'views',
  },
  {
    id: 'view.agent',
    // Shifted, because Ctrl+A is select-all and an author reaching for it
    // mid-sentence must never lose their selection to a panel.
    keys: 'Ctrl+Shift+A',
    label: 'Agent',
    surface: 'chrome',
    group: 'views',
  },
  {
    id: 'view.focus',
    // Shifted find is focus: the author asking for the room to themselves.
    keys: 'Ctrl+Shift+F',
    label: 'Focus mode',
    surface: 'chrome',
    group: 'views',
  },
  {
    id: 'app.settings',
    // The one binding every desktop app already agreed on.
    keys: 'Ctrl+,',
    label: 'Settings',
    surface: 'chrome',
    group: 'views',
  },

  // ── Writing ─────────────────────────────────────────────────────────────
  {
    id: 'comment.selection',
    // Was Ctrl+Alt+M — what Word and Docs both bind, chosen for the muscle
    // memory that comes with it. Simplified to Ctrl+/ on the owner's ask.
    // Free in both surfaces: nothing in StarterKit, the list kit, Highlight or
    // Essay's own extensions claims it, and the slash menu is triggered by
    // *typing* "/" into the prose, which is a text input and not a chord.
    keys: 'Ctrl+/',
    label: 'Comment on the selection',
    hint: 'comment',
    surface: 'chrome',
    group: 'writing',
  },
  {
    id: 'format.highlight',
    keys: 'Ctrl+Shift+H',
    label: 'Mark to come back to',
    hint: 'mark',
    surface: 'manuscript',
    group: 'writing',
  },
  {
    id: 'format.bold',
    keys: 'Ctrl+B',
    label: 'Bold',
    surface: 'manuscript',
    group: 'writing',
  },
  {
    id: 'format.italic',
    keys: 'Ctrl+I',
    label: 'Italic',
    surface: 'manuscript',
    group: 'writing',
  },
  {
    id: 'format.code',
    keys: 'Ctrl+E',
    label: 'Code',
    surface: 'manuscript',
    group: 'writing',
  },
  {
    id: 'format.strike',
    keys: 'Ctrl+Shift+S',
    label: 'Strikethrough',
    surface: 'manuscript',
    group: 'writing',
  },
  {
    id: 'edit.undo',
    keys: 'Ctrl+Z',
    label: 'Undo',
    surface: 'manuscript',
    group: 'writing',
  },
  {
    id: 'edit.redo',
    keys: 'Ctrl+Shift+Z',
    alsoKeys: 'Ctrl+Y',
    label: 'Redo',
    surface: 'manuscript',
    group: 'writing',
  },
  {
    id: 'edit.pasteLiteral',
    keys: 'Ctrl+Shift+V',
    label: 'Paste as plain text',
    note: 'An ordinary paste reads Markdown structure; this one does not.',
    surface: 'manuscript',
    group: 'writing',
  },

  // ── Blocks ──────────────────────────────────────────────────────────────
  {
    id: 'format.paragraph',
    keys: 'Ctrl+Alt+0',
    label: 'Text',
    surface: 'manuscript',
    group: 'blocks',
  },
  {
    id: 'format.h1',
    keys: 'Ctrl+Alt+1',
    label: 'Heading 1',
    surface: 'manuscript',
    group: 'blocks',
  },
  {
    id: 'format.h2',
    keys: 'Ctrl+Alt+2',
    label: 'Heading 2',
    surface: 'manuscript',
    group: 'blocks',
  },
  {
    id: 'format.h3',
    keys: 'Ctrl+Alt+3',
    label: 'Heading 3',
    surface: 'manuscript',
    group: 'blocks',
  },
  {
    id: 'format.h4',
    keys: 'Ctrl+Alt+4',
    label: 'Heading 4',
    surface: 'manuscript',
    group: 'blocks',
  },
  {
    id: 'format.h5',
    keys: 'Ctrl+Alt+5',
    label: 'Heading 5',
    surface: 'manuscript',
    group: 'blocks',
  },
  {
    id: 'format.h6',
    keys: 'Ctrl+Alt+6',
    label: 'Heading 6',
    surface: 'manuscript',
    group: 'blocks',
  },
  {
    id: 'format.orderedList',
    keys: 'Ctrl+Shift+7',
    label: 'Numbered list',
    surface: 'manuscript',
    group: 'blocks',
  },
  {
    id: 'format.bulletList',
    keys: 'Ctrl+Shift+8',
    label: 'Bullet list',
    surface: 'manuscript',
    group: 'blocks',
  },
  {
    id: 'insert.taskList',
    keys: 'Ctrl+Shift+9',
    label: 'Task list',
    surface: 'manuscript',
    group: 'blocks',
  },
  {
    id: 'format.quote',
    keys: 'Ctrl+Shift+B',
    label: 'Quote',
    surface: 'manuscript',
    group: 'blocks',
  },
  {
    id: 'format.codeBlock',
    keys: 'Ctrl+Alt+C',
    label: 'Code block',
    surface: 'manuscript',
    group: 'blocks',
  },
]

const BY_ID = new Map(BINDINGS.map((binding) => [binding.id, binding]))

/**
 * The keys for one binding, spelled for this platform.
 *
 * Throws on an unknown id rather than returning undefined. A missing shortcut
 * label is invisible — the palette row simply renders without one — so a typo
 * would ship silently and the drift this file exists to end would be back,
 * wearing a different coat. Every call site is module-level or in a render
 * that runs on the first frame, so this fails at the desk, not in the wild.
 */
export function keysFor(id: string): string {
  const binding = BY_ID.get(id)
  if (!binding) throw new Error(`No shortcut declared for '${id}'`)
  const primary = binding.macKeys && isMac ? binding.macKeys : shortcut(binding.keys)
  if (!binding.alsoKeys) return primary
  // A middle dot, not a slash or a comma: both of those turn up *inside*
  // shortcuts (Ctrl+, is Settings), and a separator that could be read as part
  // of a key is a separator that will be.
  return `${primary} · ${shortcut(binding.alsoKeys)}`
}

/** One binding, or undefined if nothing is declared under that id. */
export function bindingFor(id: string): Binding | undefined {
  return BY_ID.get(id)
}

/**
 * A hint for the footer: the platform label and the one-word form.
 *
 * `ShortcutHints` chooses *which* hints to show — that is an editorial
 * decision about discoverability and belongs with the component that has to
 * fit two of them in a footer. This only answers what they say.
 */
export function hintFor(id: string): { keys: string; label: string } {
  const binding = BY_ID.get(id)
  if (!binding?.hint) throw new Error(`No footer hint declared for '${id}'`)
  return { keys: keysFor(id), label: binding.hint }
}

/**
 * The manuscript binding that claims the same keys as a chrome one, if there
 * is one — meaning the chrome binding does nothing while the caret is in the
 * prose, because Tiptap has already consumed the keystroke and called
 * `preventDefault`.
 *
 * This is the check that found the Structure/bold collision, and it is
 * exported rather than run once and forgotten because the next collision will
 * be introduced by someone who is not thinking about ProseMirror's keymap. The
 * reference list prints it as a caveat rather than hiding the row: a shortcut
 * that works everywhere except the one place you spend your time is a fact
 * about the app, and quietly omitting it would leave an author pressing it.
 *
 * One collision survives on purpose. Save As and strikethrough both want
 * Ctrl+Shift+S, and both have a strong claim — Shift+Save is every file
 * dialog's spelling, and Mod-Shift-s is StarterKit's. Ctrl+S saves either way,
 * so what the collision actually costs is the *dialog*, which the palette and
 * the File affordances both still reach. Moving either would trade a
 * well-known binding for a private one.
 */
export function manuscriptShadow(binding: Binding): Binding | undefined {
  if (binding.surface !== 'chrome') return undefined
  return BINDINGS.find(
    (other) =>
      other.surface === 'manuscript' &&
      (other.keys === binding.keys || other.alsoKeys === binding.keys),
  )
}

/** The catalogue arranged for a reference list: groups in declared order,
    each with the bindings that named it, and empty groups dropped. */
export function groupedBindings(): {
  group: ShortcutGroup
  bindings: Binding[]
}[] {
  return GROUPS.map((group) => ({
    group,
    bindings: BINDINGS.filter((binding) => binding.group === group.id),
  })).filter((entry) => entry.bindings.length > 0)
}
