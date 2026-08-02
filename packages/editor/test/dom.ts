/**
 * A DOM for the tests.
 *
 * Tiptap is ProseMirror, and ProseMirror is a view over real DOM nodes: an
 * `Editor` cannot be constructed without `document`. Bun runs the tests in a
 * bare JavaScript runtime, so happy-dom is registered as the global
 * environment before any Tiptap module is evaluated.
 *
 * Import this module *first* in every test file. Static imports are evaluated
 * in source order, so `import './dom'` above `import { Editor } from ...` is
 * what guarantees the globals exist by the time ProseMirror looks for them.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'

if (typeof globalThis.document === 'undefined') {
  GlobalRegistrator.register()
}
