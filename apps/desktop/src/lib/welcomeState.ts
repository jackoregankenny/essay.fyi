// Whether this author has real documents yet.
//
// The welcome manuscript is the empty state, not a one-off greeting. It used to
// appear exactly once — a `essay.welcomed` flag set on first launch — which
// meant the one person most likely to want it back, someone who opened Essay,
// looked around and closed it, could never see it again. Now it is what an
// untitled buffer contains until there is something else to have opened, and
// the help tab can summon it whenever.
//
// "Has real documents" is answered from two signals rather than one. The flag
// below is set when a document is saved, which is the event the behaviour is
// actually about. But the recents list already records every file *opened*, so
// it is consulted too: an author with a workspace full of manuscripts has
// obviously used Essay before, and greeting them with the welcome document
// because this particular machine has not seen a save yet would be a strange
// thing to insist on. It also means nobody who has been using Essay gets
// re-welcomed by this change landing.

import { loadRecentFiles } from './recents'

const STORAGE_KEY = 'essay.saved.document.v1'

/**
 * Has this author saved or opened a document?
 *
 * Both reads are wrapped: `localStorage` throws rather than returning null in
 * a hardened WebView, and the honest answer when storage cannot be read is
 * "no" — showing the welcome to someone who has seen it costs a keystroke,
 * hiding it from someone who has not costs them the introduction.
 */
export function hasRealDocuments(): boolean {
  try {
    if (localStorage.getItem(STORAGE_KEY)) return true
  } catch {
    return false
  }
  try {
    return loadRecentFiles().length > 0
  } catch {
    return false
  }
}

/** Record that a document has been saved to a real path. Called from the save
    funnel, and idempotent — a write per save is cheaper than a read to decide
    whether to write. */
export function markRealDocument(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // Nothing to do. The welcome reappearing is a small cost, and it is the
    // only one: nothing else reads this.
  }
}
