//! Agent integration (Milestone 4).
//!
//! Two paths: a universal fallback (the agent edits the file; Essay watches,
//! captures before/after, presents the change for review) and a native patch
//! protocol (structured patch sets via the `essay` CLI). AI proposes; the
//! author decides. Every proposal records who or what proposed it, the
//! instruction, the affected sections, the exact patch, when it happened and
//! whether it was accepted. No model silently rewrites the canonical
//! document.
