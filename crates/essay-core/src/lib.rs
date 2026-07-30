//! Core document types shared across the Essay workspace.
//!
//! The canonical document is an ordinary Markdown file. Everything in this
//! crate describes positions and identities *within* that source; nothing
//! here is ever used to regenerate the file.

use serde::{Deserialize, Serialize};

/// Byte range into the canonical Markdown source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextRange {
    pub start: usize,
    pub end: usize,
}

impl TextRange {
    pub fn len(&self) -> usize {
        self.end.saturating_sub(self.start)
    }

    pub fn is_empty(&self) -> bool {
        self.end <= self.start
    }
}

/// Stable identity for a block, inferred across revisions.
///
/// Paragraphs have no inherent IDs; continuity is inferred without polluting
/// the manuscript with hidden identifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct BlockId(pub u64);

/// Content fingerprint used to match blocks across revisions and to anchor
/// comments and agent findings.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Fingerprint(pub String);
