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
}

const INITIAL: PreviewState = {
  status: 'idle',
  pages: [],
  warnings: [],
  error: null,
  pageCount: 0,
}

interface RenderedDocument {
  pages: string[]
  warnings: string[]
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
      setState((s) => ({ ...INITIAL, pages: s.pages, pageCount: s.pageCount }))
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
