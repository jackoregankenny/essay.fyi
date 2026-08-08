/**
 * ManuscriptImage — the Image node with a display-only src resolver.
 *
 * The Markdown file stores the author's path: relative to the document when
 * the image lives beside it, absolute otherwise, never a URL scheme only a
 * webview understands (invariant 2 — the file must read the same everywhere).
 * A webview usually cannot load that path directly, so the node view resolves
 * it at the <img> and nowhere else: node attrs and serialization keep the
 * original bytes, alt and title included.
 *
 * `resolveSrc` is the host's seam. The desktop shell hands in a Tauri
 * convertFileSrc-based resolver, tests hand in a fake, the default is
 * identity. This package stays framework-agnostic — the node view is plain
 * DOM and knows nothing about Tauri.
 *
 * A path that fails to load renders as a visible, selectable broken-image
 * block showing the original path and the alt text — never a blank hole. The
 * node stays selectable, deletable and repairable; a new src gets a fresh
 * attempt.
 */
import Image, { type ImageOptions } from '@tiptap/extension-image'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface ManuscriptImageOptions extends ImageOptions {
  /**
   * Turn a Markdown src into something the webview can display. Display
   * only — the value never reaches the document or the file.
   */
  resolveSrc: (src: string) => string
}

/** A torn-picture glyph, drawn inline so the package needs no icon library. */
const BROKEN_GLYPH =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">' +
  '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>' +
  '<path d="M1.5 10.5l3.5-3 2.5 2"/>' +
  '<path d="M9.5 9l1.5-1.5 3.5 3"/>' +
  '<line x1="13.5" y1="1.5" x2="2.5" y2="14.5"/>' +
  '</svg>'

export const ManuscriptImage = Image.extend<ManuscriptImageOptions>({
  addOptions() {
    return {
      // parent is Image's own addOptions, always present at runtime; the
      // cast undoes the optionality `?.()` introduces into the spread.
      ...(this.parent?.() as ImageOptions),
      resolveSrc: (src: string) => src,
    }
  },

  addNodeView() {
    const resolve = (src: string) => this.options.resolveSrc(src)

    return ({ node }) => {
      let current: ProseMirrorNode = node

      const dom = document.createElement('div')
      dom.className = 'essay-image'

      const img = document.createElement('img')

      // The fallback is built up front and shown by class, so an error is a
      // class flip rather than a DOM rebuild mid-mutation-observer.
      const broken = document.createElement('div')
      broken.className = 'essay-image-broken'
      broken.setAttribute('contenteditable', 'false')
      broken.innerHTML = BROKEN_GLYPH
      const pathEl = document.createElement('span')
      pathEl.className = 'essay-image-broken-path'
      const altEl = document.createElement('span')
      altEl.className = 'essay-image-broken-alt'
      broken.append(pathEl, altEl)

      img.addEventListener('error', () => dom.classList.add('is-broken'))
      img.addEventListener('load', () => dom.classList.remove('is-broken'))

      const sync = (n: ProseMirrorNode) => {
        const src = (n.attrs.src as string | null) ?? ''
        const alt = (n.attrs.alt as string | null) ?? ''
        const title = (n.attrs.title as string | null) ?? ''

        pathEl.textContent = src
        altEl.textContent = alt
        altEl.hidden = alt === ''

        if (alt) img.setAttribute('alt', alt)
        else img.removeAttribute('alt')
        if (title) img.setAttribute('title', title)
        else img.removeAttribute('title')

        // The one place resolution happens. Compared against the attribute,
        // not img.src — the property reflects back an absolutized URL.
        const resolved = src ? resolve(src) : ''
        if (img.getAttribute('src') !== resolved) {
          dom.classList.remove('is-broken')
          img.setAttribute('src', resolved)
        }
      }

      sync(current)
      dom.append(img, broken)

      return {
        dom,
        update(n: ProseMirrorNode) {
          if (n.type !== current.type) return false
          current = n
          sync(n)
          return true
        },
        // Leaf node, no contentDOM; the broken-state class flips are ours
        // and must not make ProseMirror redraw the view.
        ignoreMutation: () => true,
      }
    }
  },
})
