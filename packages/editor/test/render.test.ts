/**
 * What the author sees, not just what the file holds.
 *
 * The round-trip suite proves saving keeps the Markdown; this one proves the
 * manuscript surface *draws* a list as a list. The historical failure was
 * exactly here: Tailwind preflight sets `list-style: none` on every ul and ol,
 * and for a while a document written with `- ` rendered on screen as prose
 * that happened to break oddly while its bytes stayed perfect. These tests pin
 * both halves of that lesson — the DOM structure Tiptap emits, and the CSS
 * rules in prose.css that put the markers back.
 */
import { describe, expect, test } from 'bun:test'
import './dom'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Editor } from '@tiptap/core'

import { manuscriptExtensions } from '../src/index'
import { setManuscript } from '../src/frontmatter'
import { fileURLToPath } from 'node:url'

function editorWith(source: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: manuscriptExtensions(),
  })
  setManuscript(editor, source)
  return editor
}

describe('lists are drawn as lists', () => {
  test('a bullet list renders ul and li elements', () => {
    const editor = editorWith('- First\n- Second\n- Third\n')
    try {
      const ul = editor.view.dom.querySelector('ul')
      expect(ul).not.toBeNull()
      expect(ul?.querySelectorAll(':scope > li').length).toBe(3)
      expect(ul?.querySelector('li')?.textContent).toContain('First')
    } finally {
      editor.destroy()
    }
  })

  test('an ordered list renders an ol element', () => {
    const editor = editorWith('1. First\n2. Second\n')
    try {
      const ol = editor.view.dom.querySelector('ol')
      expect(ol).not.toBeNull()
      expect(ol?.querySelectorAll(':scope > li').length).toBe(2)
      // A list that starts past one carries its start into the DOM.
      const started = editorWith('7. Seventh\n8. Eighth\n')
      try {
        expect(started.view.dom.querySelector('ol')?.getAttribute('start')).toBe(
          '7',
        )
      } finally {
        started.destroy()
      }
    } finally {
      editor.destroy()
    }
  })

  test('nesting nests: an li contains its own sub-list', () => {
    const editor = editorWith('- One\n  - Nested\n    - Deeper\n')
    try {
      const outer = editor.view.dom.querySelectorAll('ul')[0]
      const mid = outer.querySelector('ul')
      const deep = mid?.querySelector('ul')
      expect(mid).not.toBeNull()
      expect(deep).not.toBeNull()
      expect(deep?.textContent).toContain('Deeper')
    } finally {
      editor.destroy()
    }
  })

  test('a task list renders real checkboxes', () => {
    const editor = editorWith('- [ ] Unfinished\n- [x] Finished\n')
    try {
      const boxes = editor.view.dom.querySelectorAll<HTMLInputElement>(
        'ul[data-type="taskList"] input[type="checkbox"]',
      )
      expect(boxes.length).toBe(2)
      expect(boxes[0].checked).toBe(false)
      expect(boxes[1].checked).toBe(true)
    } finally {
      editor.destroy()
    }
  })

  test('prose.css restores what preflight takes away', () => {
    // happy-dom does not cascade stylesheets, so the guard is over the sheet's
    // own text: these selectors must carry explicit list-style rules, because
    // `@import "tailwindcss"` zeroes them globally and nothing else puts them
    // back.
    const css = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
        'prose.css',
      ),
      'utf8',
    )
    expect(css).toMatch(/\.essay-prose ul\b[^{]*\{[^}]*list-style-type:\s*disc/)
    expect(css).toMatch(/\.essay-prose ol\b[^{]*\{[^}]*list-style-type:\s*decimal/)
    expect(css).toMatch(/\.essay-prose ul,[^{]*\{[^}]*list-style-position:\s*outside/)
  })
})
