import { useEffect, useRef } from 'react'
import { createManuscriptEditor, type EditorView } from '@essay/editor'

interface ManuscriptEditorProps {
  initialDoc: string
  onDocChanged?: (doc: string) => void
  onReady?: (view: EditorView) => void
}

export function ManuscriptEditor({
  initialDoc,
  onDocChanged,
  onReady,
}: ManuscriptEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const callbacksRef = useRef({ onDocChanged, onReady })
  callbacksRef.current = { onDocChanged, onReady }

  useEffect(() => {
    const parent = containerRef.current
    if (!parent) return
    const view = createManuscriptEditor({
      parent,
      doc: initialDoc,
      onDocChanged: (doc) => callbacksRef.current.onDocChanged?.(doc),
    })
    callbacksRef.current.onReady?.(view)
    return () => view.destroy()
    // The editor owns its document after mount; recreating it on prop
    // changes would throw away cursor, scroll and undo state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} className="h-full min-h-0 [&>.cm-editor]:h-full" />
}
