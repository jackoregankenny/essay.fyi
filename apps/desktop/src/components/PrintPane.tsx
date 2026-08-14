import { useEffect, useMemo, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { Select } from '@base-ui-components/react/select'
import { Check, FilePdf, Info, Warning } from '@phosphor-icons/react'
import { cn } from '#/lib/cn'
import { CollapseIcon, ExpandIcon } from '#/lib/icons'
import { formatLabel, type Format } from '#/lib/formats'
import type { PreviewState } from '#/lib/usePreview'

interface PrintPaneProps {
  preview: PreviewState
  /**
   * Every format this build can typeset. Empty outside the desktop shell,
   * where there is no compiler to ask — the picker then renders nothing at
   * all, which is honest, where an empty menu would be a lie about choice.
   */
  formats: readonly Format[]
  /**
   * What the document's front matter says right now, if the shell has read
   * it. Only consulted before the first compile has answered: after that the
   * pages themselves are the better witness to what this document is set in.
   */
  currentFormat: string | null
  /**
   * Set the document's format — this writes `format:` into the author's front
   * matter, so it is an edit to the manuscript, not a preference.
   */
  onFormat: (id: string) => void
  /**
   * Typeset to PDF. Awaited when it returns a promise, so the button can say
   * it is working through a compile the author would otherwise wait out with
   * no evidence anything happened.
   */
  onExport: () => void | Promise<void>
}

/**
 * Proof: the typeset document, and the controls that decide how it is dressed.
 *
 * The pane answers two different questions with one surface. *What does this
 * look like* is the pages, and they are the bulk of it. *What is it set in,
 * and how do I get it out* are decisions made while looking at the pages —
 * which is why the format picker and Export live here rather than in the
 * palette, where the author would be choosing blind.
 *
 * The controls sit outside the scroller deliberately. Export is the reason
 * this pane is open at the end of a document's life, and an action that
 * scrolls away after the first page is one the author has to go hunting for.
 */
export function PrintPane({
  preview,
  formats,
  currentFormat,
  onFormat,
  onExport,
}: PrintPaneProps) {
  const pageUrls = useMemo(
    () =>
      preview.pages.map((svg) =>
        URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })),
      ),
    [preview.pages],
  )
  useEffect(
    () => () => pageUrls.forEach((url) => URL.revokeObjectURL(url)),
    [pageUrls],
  )

  // What the author just chose, held until a compile confirms it. Choosing a
  // format writes front matter, waits out the debounce and then typesets the
  // whole document, which is a second or more of the picker still showing the
  // old answer — and a select that snaps back after a click reads as a click
  // that failed. Cleared on any completed compile rather than on a match, so
  // a write that never landed corrects the picker instead of persisting a
  // choice the document does not actually carry.
  const [chosen, setChosen] = useState<string | null>(null)
  useEffect(() => {
    if (preview.status === 'ready') setChosen(null)
  }, [preview.status, preview.formatId])

  const selected = chosen ?? preview.formatId ?? currentFormat

  const canPick = formats.length > 0
  // No compiler in the browser, so nothing to export and nothing to say about
  // it; `BrowserFallback` below already explains that once.
  const canExport = isTauri()

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      {(canPick || canExport) && (
        <div className="shrink-0 px-8 pt-8 pb-3">
          <div className="mx-auto flex max-w-[46rem] items-center gap-2">
            {canPick && (
              <FormatSelect
                formats={formats}
                selected={selected}
                requested={preview.requestedFormat}
                onFormat={onFormat}
              />
            )}
            {canExport && (
              <ExportButton
                onExport={onExport}
                ready={preview.pages.length > 0}
              />
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-8 pb-8',
          !canPick && !canExport && 'pt-8',
        )}
      >
        <div className="mx-auto max-w-[46rem]">
          <div className="mb-4 flex h-5 items-center gap-3 text-[11px] tabular-nums text-[var(--essay-text-faint)]">
            {preview.status === 'rendering' ? (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--essay-text-faint)]" />
                Typesetting…
              </span>
            ) : preview.pageCount > 0 ? (
              <span>
                {preview.pageCount} {preview.pageCount === 1 ? 'page' : 'pages'}
              </span>
            ) : null}
          </div>

          {/* Above the pages, not below them: a warning is about the document
              being looked at, and one that needs scrolling past a forty-page
              manuscript to find is the same as the one that was never shown.
              The substitution notice goes first because it is the one that
              changes how the pages themselves should be read. */}
          {preview.requestedFormat && (
            <Substitution
              requested={preview.requestedFormat}
              resolved={
                preview.formatLabel ??
                formatLabel(formats, preview.formatId ?? '')
              }
            />
          )}
          {preview.warnings.length > 0 && (
            <Warnings warnings={preview.warnings} />
          )}

          {!isTauri() ? (
            <BrowserFallback />
          ) : preview.status === 'error' && pageUrls.length === 0 ? (
            <Diagnostics message={preview.error} />
          ) : pageUrls.length === 0 ? (
            <p className="text-[13px] text-[var(--essay-text-faint)]">
              Typesetting the first page…
            </p>
          ) : (
            <div className="flex flex-col gap-6 pb-16">
              {pageUrls.map((url, index) => (
                <img
                  key={`${index}-${url}`}
                  src={url}
                  alt={`Page ${index + 1}`}
                  className="w-full rounded-[3px] bg-white shadow-[var(--essay-shadow-medium)] ring-1 ring-black/10"
                />
              ))}
              {preview.status === 'error' && (
                <Diagnostics message={preview.error} stale />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Which of the built-in formats this document is set in.
 *
 * Shows what the pages were actually set in rather than what the file asked
 * for, because the pages are the thing being looked at — when those two differ
 * `Substitution` says so in words, and the trigger's title carries the same
 * fact to anyone who hovers it.
 *
 * Descriptions belong in the menu and nowhere else. A format is chosen once a
 * document and then never thought about again, so the sentence explaining what
 * a Memo is for is worth its room at the moment of choosing and is clutter for
 * the rest of the document's life.
 */
function FormatSelect({
  formats,
  selected,
  requested,
  onFormat,
}: {
  formats: readonly Format[]
  selected: string | null
  requested: string | null
  onFormat: (id: string) => void
}) {
  return (
    <Select.Root
      value={selected}
      onValueChange={(next) => {
        if (next && next !== selected) onFormat(next)
      }}
    >
      <Select.Trigger
        aria-label="Format"
        title={
          requested && selected
            ? `Set in ${formatLabel(formats, selected)} — this document asks for ${requested}`
            : undefined
        }
        className="flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-[var(--essay-border)] bg-[var(--essay-surface)] px-2 text-[12px] text-[var(--essay-text)] transition-colors duration-[var(--essay-speed-quick)] ease-[var(--essay-ease-out)] hover:bg-[var(--essay-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)] data-[popup-open]:bg-[var(--essay-surface-hover)]"
      >
        {/* Not `Select.Value`: before the first compile there may be no
            selection at all, and a blank chip says less than the word for what
            the control is. */}
        <span className="min-w-0 truncate">
          {selected ? formatLabel(formats, selected) : 'Format'}
        </span>
        <ExpandIcon
          size={9}
          aria-hidden
          className="shrink-0 rotate-90 text-[var(--essay-text-faint)]"
        />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          // Native-select behaviour floats the popup over the trigger, which
          // in a 21rem column means the menu lands on top of the pages it is
          // describing.
          alignItemWithTrigger={false}
          className="z-50"
        >
          {/* Wider than the column it opens from, and allowed to be: the menu
              is portalled, so the descriptions get a readable measure instead
              of the companion's width. */}
          <Select.Popup className="essay-pop max-h-[320px] w-[17rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-[var(--essay-border)] bg-[var(--essay-surface)] p-1 shadow-[var(--essay-shadow-palette)] outline-none">
            <Select.List>
              {formats.map((format) => (
                <Select.Item
                  key={format.id}
                  value={format.id}
                  className="flex cursor-default items-start gap-2 rounded-md px-2 py-1.5 text-[12px] text-[var(--essay-text-muted)] outline-none select-none data-[highlighted]:bg-[var(--essay-surface-hover)] data-[highlighted]:text-[var(--essay-text)] data-[selected]:text-[var(--essay-text)]"
                >
                  {/* The slot is reserved by the wrapper, not the indicator:
                      the indicator only renders when selected, and labels must
                      not shift as the selection moves. */}
                  <span className="mt-0.5 flex w-3 shrink-0 justify-center">
                    <Select.ItemIndicator className="text-[var(--essay-accent)]">
                      <Check size={11} weight="bold" />
                    </Select.ItemIndicator>
                  </span>
                  <span className="min-w-0 flex-1">
                    <Select.ItemText>{format.label}</Select.ItemText>
                    <span className="mt-px block text-[11px] leading-[1.4] text-[var(--essay-text-faint)]">
                      {format.description}
                    </span>
                  </span>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

/**
 * Getting the document out, where the document is being looked at.
 *
 * Disabled rather than hidden until there are pages: exporting a manuscript
 * that has not compiled yet produces the compiler's error in a file dialog,
 * and a button that appears once the first page lands moves the other controls
 * under the author's pointer as it arrives.
 */
function ExportButton({
  onExport,
  ready,
}: {
  onExport: () => void | Promise<void>
  ready: boolean
}) {
  const [exporting, setExporting] = useState(false)
  const idle = ready && !exporting

  return (
    <button
      type="button"
      disabled={!idle}
      title={ready ? undefined : 'Nothing typeset to export yet'}
      onClick={() => {
        const running = onExport()
        // A caller that hands back nothing is telling us it has already
        // handed off — a save dialog of its own, say — and there is no
        // duration here to report.
        if (!(running instanceof Promise)) return
        setExporting(true)
        void running.finally(() => setExporting(false))
      }}
      className={cn(
        'ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-[var(--essay-weight-medium)]',
        'transition-colors duration-[var(--essay-speed-quick)] ease-[var(--essay-ease-out)]',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]',
        // Accent ink on the accent tint, as elsewhere: visibly the action
        // without shouting, and hover deepens the tint in the token's own
        // space rather than filter-brightening it.
        'bg-[var(--essay-accent-tint)] text-[var(--essay-accent)]',
        // Hover is spoken here rather than as a `hover:` utility so that it is
        // off while the button is disabled — a control that lights up under
        // the pointer and then does nothing is worse than one that does not.
        idle
          ? 'hover:bg-[color-mix(in_oklch,var(--essay-accent-tint),var(--essay-accent)_10%)]'
          : 'cursor-default opacity-45',
      )}
    >
      <FilePdf size={13} aria-hidden />
      {exporting ? 'Exporting…' : 'Export PDF'}
    </button>
  )
}

/**
 * The document asked to be set in a format this copy of Essay does not have,
 * and was set in something else.
 *
 * Deliberately not rendered as a warning. Nothing is wrong with the document —
 * a colleague's template is simply not installed here — and the pages on
 * screen are real pages that just are not the ones the file describes. So it
 * gets prose, in the author's terms, naming both formats and pointing at the
 * control that resolves it.
 *
 * The compiler usually reports the same substitution in its own words, so this
 * can read twice. That is the better failure: suppressing a diagnostic by
 * matching its wording would go quietly wrong the first time Typst rephrases
 * it, and a little repetition costs an author nothing.
 */
function Substitution({
  requested,
  resolved,
}: {
  requested: string
  resolved: string
}) {
  return (
    <div className="mb-4 flex gap-2 rounded-lg border border-[var(--essay-border)] bg-[var(--essay-surface)] px-2.5 py-2">
      <Info
        size={13}
        aria-hidden
        className="mt-0.5 shrink-0 text-[var(--essay-text-faint)]"
      />
      <p className="min-w-0 text-[12px] leading-relaxed text-[var(--essay-text-muted)]">
        This document asks to be set as{' '}
        <span className="text-[var(--essay-text)]">{requested}</span>, which
        this copy of Essay does not have. The pages below are{' '}
        <span className="text-[var(--essay-text)]">{resolved}</span> instead.
        Choosing a format above changes what the document asks for.
      </p>
    </div>
  )
}

/**
 * What the compiler said about a document it nonetheless typeset.
 *
 * Distinct from `Diagnostics`, and the distinction is the whole point: an
 * error means there are no pages, so it replaces them; a warning means the
 * pages are right there and something about them is worth knowing. Rendering
 * the second like the first would teach an author to ignore both.
 *
 * Collapsed by default, because the pages are the answer and this is a
 * footnote to it — but present and counted, so it cannot go unnoticed the way
 * it did when these travelled to the frontend and stopped there.
 */
function Warnings({ warnings }: { warnings: string[] }) {
  const [open, setOpen] = useState(false)

  // Typst reports per occurrence, so one bad construct used in twenty places
  // is twenty identical strings. Twenty rows saying the same sentence reads
  // as twenty problems; one row saying it happened twenty times is the fact.
  const grouped = useMemo(() => {
    const counts = new Map<string, number>()
    for (const warning of warnings) {
      counts.set(warning, (counts.get(warning) ?? 0) + 1)
    }
    return [...counts.entries()]
  }, [warnings])

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-[var(--essay-border)] bg-[var(--essay-surface)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--essay-accent)]"
      >
        {open ? (
          <CollapseIcon size={11} aria-hidden className="text-[var(--essay-text-faint)]" />
        ) : (
          <ExpandIcon size={11} aria-hidden className="text-[var(--essay-text-faint)]" />
        )}
        <Warning size={13} aria-hidden className="text-[var(--essay-text-muted)]" />
        <span className="text-[12px] text-[var(--essay-text-muted)]">
          {grouped.length} typesetting{' '}
          {grouped.length === 1 ? 'warning' : 'warnings'}
        </span>
      </button>
      {open && (
        <ul className="border-t border-[var(--essay-border)]">
          {grouped.map(([warning, count]) => (
            <li
              key={warning}
              className={cn(
                'flex gap-2 px-2.5 py-1.5 text-[12px] leading-relaxed',
                'border-b border-[var(--essay-border)] last:border-b-0',
              )}
            >
              <pre className="min-w-0 flex-1 font-(family-name:--essay-font-mono) whitespace-pre-wrap text-[var(--essay-text-muted)]">
                {warning}
              </pre>
              {count > 1 && (
                <span className="shrink-0 text-[11px] tabular-nums text-[var(--essay-text-faint)]">
                  ×{count}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BrowserFallback() {
  return (
    <div className="flex flex-col items-start gap-3">
      <div
        className="flex aspect-[1/1.414] w-full max-w-72 items-center justify-center rounded-[3px] bg-white shadow-[var(--essay-shadow-medium)] ring-1 ring-black/10"
        aria-hidden
      >
        <p className="px-8 text-center text-[13px] leading-relaxed text-neutral-400">
          Typeset pages render in the desktop app
        </p>
      </div>
      <p className="text-[12px] text-[var(--essay-text-faint)]">
        bun run tauri dev
      </p>
    </div>
  )
}

function Diagnostics({
  message,
  stale,
}: {
  message: string | null
  stale?: boolean
}) {
  return (
    <div className="flex gap-2 rounded-lg border border-[var(--essay-border)] bg-[var(--essay-surface)] p-3">
      <Warning
        size={14}
        className="mt-0.5 shrink-0 text-[var(--essay-text-muted)]"
      />
      <div className="min-w-0 text-[12px] leading-relaxed text-[var(--essay-text-muted)]">
        {stale && (
          <p className="mb-1 font-[510]">
            Showing the last good pages — the current draft has an issue:
          </p>
        )}
        <pre className="font-(family-name:--essay-font-mono) whitespace-pre-wrap">
          {message ?? 'Unknown rendering error'}
        </pre>
      </div>
    </div>
  )
}
