import { useEffect, useMemo } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { Warning } from '@phosphor-icons/react'
import type { PreviewState } from '#/lib/usePreview'

interface PrintPaneProps {
  preview: PreviewState
  words: number
}

/** The print view: real typeset pages from the embedded Typst compiler. */
export function PrintPane({ preview, words }: PrintPaneProps) {
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
    <aside className="flex h-full min-h-0 flex-col border-l border-[var(--essay-border)]">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <h2 className="text-[11px] font-[510] tracking-wider text-[var(--essay-text-faint)] uppercase">
          Print
        </h2>
        {preview.status === 'rendering' && (
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--essay-text-faint)]"
            title="Typesetting…"
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!isTauri() ? (
          <BrowserFallback />
        ) : preview.status === 'error' && pageUrls.length === 0 ? (
          <Diagnostics message={preview.error} />
        ) : pageUrls.length === 0 ? (
          <p className="px-1 py-2 text-[13px] text-[var(--essay-text-faint)]">
            Typesetting the first page…
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {pageUrls.map((url, index) => (
              <img
                key={`${index}-${url}`}
                src={url}
                alt={`Page ${index + 1}`}
                className="w-full rounded-[3px] bg-white shadow-[var(--essay-shadow-low)] ring-1 ring-black/10"
              />
            ))}
            {preview.status === 'error' && (
              <Diagnostics message={preview.error} stale />
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-[var(--essay-border)] px-4 py-1.5 text-[11px] tabular-nums text-[var(--essay-text-faint)]">
        {isTauri() && preview.pageCount > 0 ? (
          <span>
            {preview.pageCount} {preview.pageCount === 1 ? 'page' : 'pages'}
          </span>
        ) : (
          <span>≈ {Math.max(1, Math.ceil(words / 350))} pages</span>
        )}
        <span>{words} words</span>
      </div>
    </aside>
  )
}

function BrowserFallback() {
  return (
    <div className="flex flex-col items-center gap-4 pt-6">
      <div
        className="flex aspect-[1/1.414] w-full max-w-52 items-center justify-center rounded-[3px] bg-white shadow-[var(--essay-shadow-low)] ring-1 ring-black/10"
        aria-hidden
      >
        <p className="px-6 text-center text-xs leading-relaxed text-neutral-400">
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
    <div className="flex gap-2 rounded-md border border-[var(--essay-border)] bg-[var(--essay-surface)] p-3">
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
