/**
 * @essay/typst-preview — the print view (Milestone 2).
 *
 * Will display pages compiled by essay-render (Typst embedded in Rust),
 * initially as PDF via PDF.js, later as page SVGs for tighter source
 * mapping. Pages are cached by document revision and template hash.
 * Section-level editor↔page navigation comes first; span-level mapping can
 * follow, but the architecture allows for it from the beginning.
 */
export {}
