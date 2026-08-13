import { useEffect, useMemo, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { Warning } from '@phosphor-icons/react'
import { cn } from '#/lib/cn'
import { CollapseIcon, ExpandIcon } from '#/lib/icons'
import type { PreviewState } from '#/lib/usePreview'

interface PrintPaneProps {
  preview: PreviewState
}

/**
 * The print step: a full, calm view of the typeset document. Not a side
 * pane — previewing is its own act, toggled with Ctrl+J.
 */
export function PrintPane({ preview }: PrintPaneProps) {
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

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-transparent">
      <div className="mx-auto max-w-[46rem] px-8 py-8">
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
            manuscript to find is the same as the one that was never shown. */}
        {preview.warnings.length > 0 && <Warnings warnings={preview.warnings} />}

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
