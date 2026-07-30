//! Project workspace: files, autosave, watching, the `.essay` sidecar.
//!
//! The Markdown and assets are portable; the `.essay` directory holds
//! application state (history.sqlite, metadata, caches, change sets) that
//! can be regenerated or discarded without corrupting the document.
//! File watching (`notify`) and autosave land in Milestone 1; external edit
//! capture — the universal agent fallback — in Milestone 3.
