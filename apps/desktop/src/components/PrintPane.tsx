interface PrintPaneProps {
  words: number
  pages: number
}

// Placeholder for the Typst preview (Milestone 2). The real pane renders
// pages compiled by essay-render and supports editor-to-page navigation.
export function PrintPane({ words, pages }: PrintPaneProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-[var(--essay-border)] bg-[var(--essay-surface)]">
      <div className="px-4 pt-4 pb-2 text-xs font-medium tracking-wide text-[var(--essay-text-faint)] uppercase">
        Print
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6">
        <div
          className="flex aspect-[1/1.414] w-full max-w-56 items-center justify-center rounded-sm bg-white shadow-md ring-1 ring-black/10"
          aria-hidden
        >
          <p className="px-6 text-center text-xs leading-relaxed text-neutral-400">
            The typeset document appears here in Milestone 2
          </p>
        </div>
        <p className="text-sm text-[var(--essay-text-muted)]">
          ≈ {pages} {pages === 1 ? 'page' : 'pages'} · {words} words
        </p>
      </div>
    </aside>
  )
}
