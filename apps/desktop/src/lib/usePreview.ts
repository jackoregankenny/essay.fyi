import { useEffect, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getManuscript, type Editor } from '@essay/editor'

export interface PreviewState {
  /**
   * unavailable — browser preview (no compiler); idle — preview pane off;
   * ready/error carry the latest completed compile. Stale pages stay
   * visible while the next compile runs so the pane never flashes.
   */
  status: 'unavailable' | 'idle' | 'rendering' | 'ready' | 'error'
  pages: string[]
  warnings: string[]
  error: string | null
  pageCount: number
  /**
   * What the last completed compile was actually set in, and — only when the
   * document named a format that does not exist here — what it asked for. The
   * fallback also arrives as a warning; these carry the same news in a form
   * the pane can act on rather than print.
   */
  formatId: string | null
  formatLabel: string | null
  requestedFormat: string | null
}

const INITIAL: PreviewState = {
  status: 'idle',
  pages: [],
  warnings: [],
  error: null,
  pageCount: 0,
  formatId: null,
  formatLabel: null,
  requestedFormat: null,
}

interface RenderedDocument {
  pages: string[]
  warnings: string[]
  formatId: string
  formatLabel: string
  requestedFormat: string | null
}

const DEBOUNCE_MS = 500

/**
 * Debounced, latest-wins Typst compilation. Typing never waits on this:
 * compilation happens in Rust on a blocking thread, results arrive
 * asynchronously, and stale responses are dropped.
 */
export function usePreview(
  editor: Editor | null,
  docDir: string | null,
  enabled: boolean,
  version: number,
): PreviewState {
  const [state, setState] = useState<PreviewState>(INITIAL)
  const requestSeq = useRef(0)

  useEffect(() => {
    if (!enabled || !editor) {
      // The format is kept alongside the stale pages for the same reason they
      // are: it is still what this document is set in, and dropping it would
      // blank a menu the moment the pane closes.
      setState((s) => ({
        ...INITIAL,
        pages: s.pages,
        pageCount: s.pageCount,
        formatId: s.formatId,
        formatLabel: s.formatLabel,
        requestedFormat: s.requestedFormat,
      }))
      return
    }
    if (!isTauri()) {
      setState({ ...INITIAL, status: 'unavailable' })
      return
    }

    const seq = ++requestSeq.current
    setState((s) => ({ ...s, status: 'rendering' }))
    const timer = setTimeout(() => {
      invoke<RenderedDocument>('render_document', {
        source: getManuscript(editor),
        root: docDir,
      })
        .then((result) => {
          if (requestSeq.current !== seq) return
          setState({
            status: 'ready',
            pages: result.pages,
            warnings: result.warnings,
            error: null,
            pageCount: result.pages.length,
            formatId: result.formatId,
            formatLabel: result.formatLabel,
            requestedFormat: result.requestedFormat,
          })
        })
        .catch((err: unknown) => {
          if (requestSeq.current !== seq) return
          setState((s) => ({
            ...s,
            status: 'error',
            error: String(err),
          }))
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [editor, docDir, enabled, version])

  return state
}

/** Directory of the current document, for resolving relative images. */
export function documentDir(path: string | null): string | null {
  if (!path) return null
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return index > 0 ? path.slice(0, index) : null
}
