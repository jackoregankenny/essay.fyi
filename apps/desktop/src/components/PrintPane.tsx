import { useEffect, useMemo } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { Warning } from '@phosphor-icons/react'
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
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--essay-bg)]">
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
        <pre className="font-[var(--essay-font-mono)] whitespace-pre-wrap">
          {message ?? 'Unknown rendering error'}
        </pre>
      </div>
    </div>
  )
}
