/**
 * ManuscriptImage: the resolver is display-only, the file keeps the author's
 * bytes, and a broken path is a visible, selectable node — never a hole.
 */
import { describe, expect, test } from 'bun:test'
import './dom'
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'

import { manuscriptExtensions, getManuscript, setManuscript } from '../src/index'
import { ManuscriptImage } from '../src/image'

/** A resolver a webview would need — visibly different from the source path. */
const resolve = (src: string) => `asset://localhost/${src}`

/**
 * The manuscript surface with the stock Image swapped for ManuscriptImage —
 * exactly the substitution the host will make in manuscriptExtensions().
 */
function imageEditor(resolveSrc?: (src: string) => string): Editor {
  const extensions = manuscriptExtensions().map(ext =>
    ext.name === 'image' ? ManuscriptImage.configure(resolveSrc ? { resolveSrc } : {}) : ext,
  )
  return new Editor({ element: document.createElement('div'), extensions })
}

function withEditor<T>(source: string, fn: (editor: Editor) => T): T {
  const editor = imageEditor(resolve)
  try {
    setManuscript(editor, source)
    return fn(editor)
  } finally {
    editor.destroy()
  }
}

/** Position of the first image node in the document. */
function imagePos(editor: Editor): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'image') found = pos
    return found === -1
  })
  return found
}

describe('serialization keeps the author\'s bytes', () => {
  const keeps = (source: string) => {
    expect(withEditor(source, getManuscript)).toBe(source)
  }

  test('alt, path and title round-trip byte for byte', () => {
    keeps('![alt](assets/pic.png "title")\n')
  })

  test('a bare image with no alt or title round-trips', () => {
    keeps('![](assets/pic.png)\n')
  })

  test('an absolute path round-trips', () => {
    keeps('![diagram](/Users/someone/figures/diagram.svg)\n')
  })

  test('a remote URL round-trips', () => {
    keeps('![alt text](https://example.com/image.png)\n')
  })

  test('the resolver never leaks into the file across an attribute edit', () => {
    const editor = imageEditor(resolve)
    try {
      setManuscript(editor, '![alt](assets/pic.png "title")\n')
      editor.commands.updateAttributes('image', { alt: 'better alt' })
      expect(getManuscript(editor)).toBe('![better alt](assets/pic.png "title")\n')
    } finally {
      editor.destroy()
    }
  })
})

describe('the node view resolves for display only', () => {
  test('the <img> shows the resolved src while the node keeps the original', () => {
    withEditor('![alt](assets/pic.png "title")\n', editor => {
      const img = editor.view.dom.querySelector('.essay-image img')
      expect(img).not.toBeNull()
      expect(img?.getAttribute('src')).toBe('asset://localhost/assets/pic.png')
      expect(img?.getAttribute('alt')).toBe('alt')
      expect(img?.getAttribute('title')).toBe('title')

      const node = editor.state.doc.nodeAt(imagePos(editor))
      expect(node?.attrs.src).toBe('assets/pic.png')
    })
  })

  test('without a resolver the src passes through untouched', () => {
    const editor = imageEditor()
    try {
      setManuscript(editor, '![](x.png)\n')
      expect(editor.view.dom.querySelector('.essay-image img')?.getAttribute('src')).toBe('x.png')
    } finally {
      editor.destroy()
    }
  })
})

describe('a missing image is a visible, repairable node', () => {
  // happy-dom never loads images, so the error path is driven by hand —
  // which is also exactly what a webview does with a dead path.
  const breakImage = (editor: Editor) => {
    const img = editor.view.dom.querySelector('.essay-image img')
    img?.dispatchEvent(new Event('error'))
    return editor.view.dom.querySelector('.essay-image')
  }

  test('a failed load shows the fallback with the original path and alt', () => {
    withEditor('![the alt](missing/pic.png)\n', editor => {
      const wrapper = breakImage(editor)
      expect(wrapper?.classList.contains('is-broken')).toBe(true)
      expect(wrapper?.querySelector('.essay-image-broken-path')?.textContent).toBe(
        'missing/pic.png',
      )
      expect(wrapper?.querySelector('.essay-image-broken-alt')?.textContent).toBe('the alt')
    })
  })

  test('the broken node is still selectable and deletable', () => {
    withEditor('Before.\n\n![](missing/pic.png)\n', editor => {
      breakImage(editor)
      const pos = imagePos(editor)
      editor.commands.setNodeSelection(pos)
      expect(editor.state.selection).toBeInstanceOf(NodeSelection)
      editor.commands.deleteSelection()
      expect(getManuscript(editor)).toBe('Before.\n')
    })
  })

  test('a repaired src gets a fresh attempt', () => {
    withEditor('![](missing/pic.png)\n', editor => {
      const wrapper = breakImage(editor)
      editor.commands.updateAttributes('image', { src: 'assets/found.png' })
      expect(wrapper?.classList.contains('is-broken')).toBe(false)
      expect(wrapper?.querySelector('img')?.getAttribute('src')).toBe(
        'asset://localhost/assets/found.png',
      )
      // ...and the file records the repair, not the resolution.
      expect(getManuscript(editor)).toBe('![](assets/found.png)\n')
    })
  })

  test('a broken image still serializes untouched', () => {
    withEditor('![alt](missing/pic.png "title")\n', editor => {
      breakImage(editor)
      expect(getManuscript(editor)).toBe('![alt](missing/pic.png "title")\n')
    })
  })
})
