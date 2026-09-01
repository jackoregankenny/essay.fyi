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

  // ——— The cascade, not the file ———
  //
  // What stood here was a regex over prose.css's own text, justified by the
  // claim that happy-dom does not cascade stylesheets. It does, for longhand
  // properties, so the guard passed whenever the rule *existed* — which is not
  // the property this file is named for. A rule that exists and loses draws
  // exactly the bug it was written to catch, with every test still green.
  //
  // What happy-dom will and will not do, measured rather than assumed, because
  // the first rewrite of this block got it wrong in the other direction:
  //
  //   no stylesheet at all        list-style-type: ""      <- no UA stylesheet
  //   `list-style: none`          list-style-type: ""      <- shorthand ignored
  //   `list-style-type: none`     list-style-type: "none"
  //   longhand none + prose.css   list-style-type: "disc"
  //
  // The second line is the load-bearing one. happy-dom does not expand the
  // `list-style` shorthand, and preflight is written as a shorthand, so these
  // tests cannot stage the specificity contest between preflight and prose.css
  // and must not claim to. What they can prove is the half that actually
  // regressed: prose.css names an explicit marker on the manuscript surface,
  // and a live editor's list picks it up. The first line is why that means
  // something — with nothing loaded the value is empty, so `disc` cannot arrive
  // by default and can only have come from the sheet under test.
  //
  // Also out of reach from here, stated rather than implied: that the app
  // imports prose.css at all, and that ManuscriptEditor keeps
  // `class: 'essay-prose'` on the surface. Both live in apps/desktop.

  const here = path.dirname(fileURLToPath(import.meta.url))
  const PROSE = path.join(here, '..', 'prose.css')

  /** Attaches prose.css to the document and hands back the undo, because
      happy-dom's document outlives any one test. */
  function loadProse(): () => void {
    const el = document.createElement('style')
    el.textContent = readFileSync(PROSE, 'utf8')
    document.head.appendChild(el)
    return () => el.remove()
  }

  /** A live editor attached to the document — getComputedStyle only cascades for
      elements actually in it, which is why editorWith's detached div cannot be
      reused here — carrying the same class ManuscriptEditor puts on the
      manuscript surface. */
  function mounted(source: string) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = new Editor({
      element: host,
      extensions: manuscriptExtensions(),
      editorProps: { attributes: { class: 'essay-prose' } },
    })
    setManuscript(editor, source)
    return {
      editor,
      dispose: () => {
        editor.destroy()
        host.remove()
      },
    }
  }

  test('without prose.css a list has no marker at all', () => {
    // The sensitivity check, and the only reason to trust the next test. If a
    // marker ever turns up here, `disc` below is arriving from somewhere other
    // than the sheet under test and the assertion has stopped being able to
    // fail.
    const list = mounted('- First\n- Second\n')
    try {
      const ul = list.editor.view.dom.querySelector('ul')!
      expect(getComputedStyle(ul).listStyleType).toBe('')
    } finally {
      list.dispose()
    }
  })

  test('prose.css gives a rendered list its marker back', () => {
    const restore = loadProse()
    const bullets = mounted('- First\n- Second\n')
    const numbers = mounted('1. First\n2. Second\n')
    try {
      const ul = bullets.editor.view.dom.querySelector('ul')!
      const ol = numbers.editor.view.dom.querySelector('ol')!

      expect(getComputedStyle(ul).listStyleType).toBe('disc')
      expect(getComputedStyle(ol).listStyleType).toBe('decimal')

      // A marker is only generated for a list-item box. `display: flex` — which
      // is what the task-list rule sets — removes it with no other visible
      // effect, so assert the box and not only the type.
      expect(getComputedStyle(ul.querySelector('li')!).display).toBe('list-item')
      expect(getComputedStyle(ol.querySelector('li')!).display).toBe('list-item')

      // Preflight zeroes list padding too, and a marker set `outside` with no
      // padding to hang in sits off the edge of the measure.
      expect(getComputedStyle(ul).listStylePosition).toBe('outside')
      expect(parseFloat(getComputedStyle(ul).paddingLeft)).toBeGreaterThan(0)
    } finally {
      bullets.dispose()
      numbers.dispose()
      restore()
    }
  })

  test('a task list is a checkbox list, not a bulleted one', () => {
    // The counter-case. Task items are deliberately unmarked and flex, so a
    // future rule broad enough to give every li a marker back would regress in
    // the opposite direction while reading as a fix. Asserted structurally: the
    // rule that suppresses the bullet is a `list-style` shorthand, which is the
    // one thing happy-dom drops.
    const restore = loadProse()
    const tasks = mounted('- [ ] Todo\n- [x] Done\n')
    try {
      const ul = tasks.editor.view.dom.querySelector('ul[data-type="taskList"]')
      expect(ul).not.toBeNull()
      expect(ul!.querySelectorAll('input[type="checkbox"]').length).toBe(2)
    } finally {
      tasks.dispose()
      restore()
    }
  })
})
