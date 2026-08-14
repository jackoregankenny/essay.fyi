/**
 * Front matter is the one part of a manuscript the editor never holds, and
 * `setFrontMatter` is how the app's format and face pickers change it.
 *
 * The failure mode these guard is quiet in the worst way: metadata written
 * through the wrong door either fails to stick, or takes the prose with it.
 * Nothing throws in either case — the document simply comes back different
 * from how it went in, one autosave later.
 */
import './dom'

import { describe, expect, test } from 'bun:test'
import { Editor } from '@tiptap/core'

import {
  getManuscript,
  manuscriptExtensions,
  setFrontMatter,
  setManuscript,
  splitFrontMatter,
} from '../src'

function editorWith(source: string): Editor {
  const editor = new Editor({ extensions: manuscriptExtensions() })
  setManuscript(editor, source)
  return editor
}

const BODY = '# A heading\n\nA paragraph that must survive untouched.\n'

describe('setFrontMatter', () => {
  test('adds metadata to a document that had none', () => {
    const editor = editorWith(BODY)
    setFrontMatter(editor, '---\nformat: memo\n---\n\n')
    expect(getManuscript(editor)).toBe('---\nformat: memo\n---\n\n' + BODY)
  })

  test('replaces metadata without disturbing the prose', () => {
    const source = '---\ntitle: A\nformat: essay\n---\n\n' + BODY
    const editor = editorWith(source)
    const next = '---\ntitle: A\nformat: report\n---\n\n'
    setFrontMatter(editor, next)
    const out = getManuscript(editor)
    expect(out).toBe(next + BODY)
    // The half that matters: the body is byte-identical, not merely similar.
    expect(splitFrontMatter(out).body).toBe(splitFrontMatter(source).body)
  })

  test('removes the block when handed nothing', () => {
    const editor = editorWith('---\nformat: memo\n---\n\n' + BODY)
    setFrontMatter(editor, '')
    expect(getManuscript(editor)).toBe(BODY)
  })

  test('leaves the line ending the file arrived with', () => {
    // A CRLF document rewritten as LF is a diff on every line of a file
    // nobody edited — the reason `crlf` is held aside in the first place.
    const source = '---\r\nformat: essay\r\n---\r\n\r\n# Heading\r\n\r\nText.\r\n'
    const editor = editorWith(source)
    setFrontMatter(editor, '---\r\nformat: memo\r\n---\r\n\r\n')
    const out = getManuscript(editor)
    expect(out.startsWith('---\r\nformat: memo\r\n---\r\n\r\n')).toBe(true)
    expect(out).toContain('\r\n')
    expect(/[^\r]\n/.test(out)).toBe(false)
  })

  test('holds metadata for a buffer that never went through setManuscript', () => {
    // No held entry exists in that case. Defaulting rather than refusing is
    // the deliberate choice: metadata that silently fails to stick would be
    // worse than a document that gains a conventional trailing newline.
    const editor = new Editor({ extensions: manuscriptExtensions() })
    setFrontMatter(editor, '---\nformat: rfc\n---\n\n')
    expect(getManuscript(editor).startsWith('---\nformat: rfc\n---\n\n')).toBe(true)
  })
})
