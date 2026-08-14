import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '#/lib/cn'
import { CloseIcon, FontIcon, RemoveIcon } from '#/lib/icons'
import {
  installFontsFromDisk,
  listFontFamilies,
  removeFontFamily,
  type FontFamily,
} from '#/lib/fonts'

/**
 * The typefaces this machine can set a document in, and a way to add more.
 *
 * Essay embeds no fonts. Without this page an author's only lever over how
 * their document prints is installing fonts system-wide — a chore that differs
 * on every platform, and one nobody should have to do to change a typeface in
 * a writing app. Files added here are picked up by the next render; there is
 * nothing to restart.
 *
 * A page rather than a sidebar pane, and that is not arbitrary: the sidebar is
 * about navigating *this document* — its sections, its marks, its history —
 * and a typeface is a property of the machine that outlives any manuscript.
 * It also needs the room, because browsing typefaces means seeing them.
 *
 * The list is deliberately everything the typesetter can resolve, not only
 * Essay's own. What an author wants to know is which names they can put in a
 * template; where a face came from is a detail on the row rather than a reason
 * to keep two lists.
 *
 * Choosing one here writes `font:` into the document's own front matter, which
 * is to say it edits the manuscript: the buffer goes dirty and the choice is
 * undoable, because it is an edit the author made. That is the point rather
 * than a cost — a typeface held in a preference would print differently on
 * every machine the file reached, and this way the document carries its own
 * answer. The face the document names need not exist here; a name this machine
 * cannot resolve degrades to the format's own stack when it prints, so the
 * page says so rather than hiding the choice.
 */
interface FontsPageProps {
  /** Called after the installed set changes, so an open preview re-typesets. */
  onChanged: () => void
  /** The family the open document's front matter names, verbatim, or null when
      it leaves the typeface to the format. */
  documentFont: string | null
  /** Set the document's face; null clears it back to the format's own stack. */
  onDocumentFont: (family: string | null) => void
  onClose: () => void
  className?: string
}

export function FontsPage({
  onChanged,
  documentFont,
  onDocumentFont,
  onClose,
  className,
}: FontsPageProps) {
  const [families, setFamilies] = useState<FontFamily[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const headingRef = useRef<HTMLHeadingElement>(null)

  // The manuscript is still mounted underneath and still has focus; moving it
  // here is what stops keystrokes landing in a document the author cannot see.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const refresh = useCallback(async () => {
    try {
      setFamilies(await listFontFamilies())
    } catch (error) {
      setFailure(String(error))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const install = useCallback(async () => {
    setFailure(null)
    setBusy(true)
    try {
      const added = await installFontsFromDisk()
      if (added.length > 0) {
        await refresh()
        onChanged()
      }
    } catch (error) {
      // The host parses every file before copying it and says which one failed,
      // so this is worth showing verbatim.
      setFailure(String(error))
    } finally {
      setBusy(false)
    }
  }, [refresh, onChanged])

  const remove = useCallback(
    async (family: FontFamily) => {
      setFailure(null)
      try {
        await removeFontFamily(family.name)
        await refresh()
        onChanged()
      } catch (error) {
        setFailure(String(error))
      }
    },
    [refresh, onChanged],
  )

  const q = query.trim().toLowerCase()
  const shown = q
    ? families.filter((family) => family.name.toLowerCase().includes(q))
    : families
  const mine = families.filter((family) => family.installedByAuthor).length

  // Case-insensitively: the renderer lowercases the format value on its way to
  // a format id but leaves the font value alone, and family names come off the
  // system with whatever casing they were built with. An author who typed
  // `font: iowan old style` by hand is naming the same face as this list is.
  const chosen = documentFont?.trim().toLowerCase() ?? null
  const isChosen = (family: FontFamily) => family.name.toLowerCase() === chosen
  // Only claimed once there is a list to claim it against — the families
  // arrive a tick after the page does, and "this machine does not have it"
  // flashing before the answer is known would be a lie the author reads.
  const missing =
    chosen !== null && families.length > 0 && !families.some(isChosen)

  return (
    <section
      aria-label="Fonts"
      className={cn(
        'essay-pop flex min-h-0 flex-col bg-[var(--essay-editor-bg)]',
        className,
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--essay-border)] px-3">
        <FontIcon size={15} className="shrink-0 text-[var(--essay-text-faint)]" />
        <div className="min-w-0 flex-1">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="truncate text-[13px] font-[var(--essay-weight-medium)] text-[var(--essay-text)] outline-none"
          >
            Fonts
          </h2>
          <p className="truncate text-[11px] text-[var(--essay-text-faint)]">
            {families.length} available to typeset with
            {mine > 0 && ` · ${mine} added by you`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void install()}
          disabled={busy}
          className="h-7 shrink-0 rounded-md bg-[var(--essay-surface-hover)] px-2.5 text-[12px] text-[var(--essay-text)] transition-colors duration-100 hover:bg-[var(--essay-selection)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
        >
          {busy ? 'Adding…' : 'Add font files…'}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-md p-1 text-[var(--essay-text-faint)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
        >
          <CloseIcon size={14} />
        </button>
      </header>

      {failure && (
        <p
          role="alert"
          className="shrink-0 border-b border-[var(--essay-border)] bg-[var(--essay-diff-remove-bg)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--essay-text)]"
        >
          {failure}
        </p>
      )}

      {/* The one place the current choice can always be seen and undone. The
          row below carries the same mark, but a machine with three hundred
          families and a filter box is a poor place to have to find it again —
          and a face this machine cannot resolve has no row at all. */}
      {documentFont !== null && (
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--essay-border)] px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-[12px] leading-[1.5] text-[var(--essay-text-muted)]">
            {missing ? (
              <>
                This document asks for “{documentFont}”, which this machine
                does not have — it will print in the format’s own typeface.
              </>
            ) : (
              <>
                This document is set in{' '}
                {/* Named in its own face, like the rows: the answer to "which
                    one is that?" is the shape of the letters. */}
                <span
                  className="text-[var(--essay-text)]"
                  style={{ fontFamily: `"${documentFont}", var(--essay-font-ui)` }}
                >
                  {documentFont}
                </span>
                .
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => onDocumentFont(null)}
            className="h-7 shrink-0 rounded-md px-2 text-[12px] text-[var(--essay-text-muted)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
          >
            Use the format’s typeface
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[42rem] px-4 py-4">
          {families.length > 12 && (
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter typefaces…"
              className="mb-3 h-8 w-full rounded-md bg-[var(--essay-surface-hover)] px-2.5 text-[13px] text-[var(--essay-text)] outline-none placeholder:text-[var(--essay-text-faint)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
            />
          )}

          {shown.length === 0 ? (
            <p className="py-8 text-center text-[13px] leading-[1.6] text-[var(--essay-text-faint)]">
              {families.length === 0
                ? 'No typefaces found on this machine. Add font files and your documents will typeset in them.'
                : 'No typeface matches that.'}
            </p>
          ) : (
            <ul className="flex flex-col">
              {shown.map((family) => (
                <li
                  key={family.name}
                  className="group flex items-center gap-3 border-b border-[var(--essay-border)] py-2.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    {/* Shown in the face itself, which is the only thing an
                        author is really asking of this list. The WebView
                        resolves an installed family by name just as Typst
                        does, so this preview is the printed result. */}
                    <p
                      className="truncate text-[17px] leading-[1.4] text-[var(--essay-text)]"
                      style={{ fontFamily: `"${family.name}", var(--essay-font-ui)` }}
                    >
                      The quick brown fox jumps over the lazy dog
                    </p>
                    <p className="truncate text-[11px] text-[var(--essay-text-faint)]">
                      {family.name} · {family.faces}{' '}
                      {family.faces === 1 ? 'face' : 'faces'}
                      {family.installedByAuthor ? ' · added by you' : ''}
                    </p>
                  </div>
                  {/* Set is the row's verb, so it is the row's button:
                      hover-revealed like Remove, because a column of three
                      hundred buttons is a wall rather than an offer. The
                      chosen one stays lit — it is a fact about the document
                      and not an action waiting to be taken — and clicking it
                      again is the way back, which the title says out loud
                      since a check mark on its own never could. */}
                  {isChosen(family) ? (
                    <button
                      type="button"
                      onClick={() => onDocumentFont(null)}
                      aria-pressed
                      title="Set in this document — click to go back to the format’s own typeface"
                      className="shrink-0 rounded-md bg-[var(--essay-selection)] px-2 py-1 text-[11px] text-[var(--essay-text)] transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
                    >
                      This document
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onDocumentFont(family.name)}
                      aria-label={`Set this document in ${family.name}`}
                      title="Set this document in it"
                      className={cn(
                        'shrink-0 rounded-md px-2 py-1 text-[11px] text-[var(--essay-text-muted)] opacity-0 transition-opacity duration-100',
                        'group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]',
                        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
                      )}
                    >
                      Set
                    </button>
                  )}
                  {family.installedByAuthor && (
                    <button
                      type="button"
                      onClick={() => void remove(family)}
                      aria-label={`Remove ${family.name}`}
                      title="Remove — this one is yours, not the system's"
                      className={cn(
                        'shrink-0 rounded-md p-1.5 text-[var(--essay-text-faint)] opacity-0 transition-opacity duration-100',
                        'group-hover:opacity-100 focus-visible:opacity-100 hover:text-[var(--essay-text)]',
                        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
                      )}
                    >
                      <RemoveIcon size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className="pt-4 text-[11px] leading-[1.6] text-[var(--essay-text-faint)]">
            Essay does not ship fonts of its own — it typesets with what this
            machine has. Setting a document in one writes the family’s name
            into the document itself, so the choice travels with the file;
            a machine without that family prints it in the format’s own
            typeface instead. Browsing and downloading open-source families
            from inside Essay is planned; for now, add files you already have.
          </p>
        </div>
      </div>
    </section>
  )
}
