//! Source-preserving Markdown parsing and document indexing.
//!
//! The parser produces an index *over* the original source. The index points
//! into the source; it is never used to regenerate the file after an edit.
//! Unsupported or unknown syntax must survive unchanged.

use essay_core::{BlockId, Fingerprint, TextRange};
use markdown::mdast::Node;
use markdown::ParseOptions;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DocumentIndex {
    pub blocks: Vec<Block>,
    pub headings: Vec<Heading>,
    pub links: Vec<Link>,
    pub references: Vec<Reference>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    pub id: BlockId,
    pub range: TextRange,
    pub kind: BlockKind,
    pub fingerprint: Fingerprint,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BlockKind {
    Paragraph,
    Heading,
    List,
    Table,
    CodeFence,
    BlockQuote,
    Figure,
    Frontmatter,
    Math,
    Custom,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Heading {
    /// 1–6.
    pub depth: u8,
    pub text: String,
    pub range: TextRange,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    pub url: String,
    pub range: TextRange,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reference {
    pub key: String,
    pub range: TextRange,
}

/// Build a document index from Markdown source.
///
/// Currently indexes headings; blocks, links and references follow as the
/// structural diff and anchor work needs them (Milestones 3 and 5).
pub fn index(source: &str) -> DocumentIndex {
    let mut headings = Vec::new();
    if let Ok(root) = markdown::to_mdast(source, &ParseOptions::gfm()) {
        collect_headings(&root, &mut headings);
    }
    DocumentIndex {
        headings,
        ..DocumentIndex::default()
    }
}

fn collect_headings(node: &Node, out: &mut Vec<Heading>) {
    if let Node::Heading(heading) = node {
        let range = heading
            .position
            .as_ref()
            .map(|p| TextRange {
                start: p.start.offset,
                end: p.end.offset,
            })
            .unwrap_or(TextRange { start: 0, end: 0 });
        out.push(Heading {
            depth: heading.depth,
            text: inline_text(node),
            range,
        });
    }
    if let Some(children) = node.children() {
        for child in children {
            collect_headings(child, out);
        }
    }
}

fn inline_text(node: &Node) -> String {
    let mut text = String::new();
    collect_text(node, &mut text);
    text
}

fn collect_text(node: &Node, out: &mut String) {
    match node {
        Node::Text(t) => out.push_str(&t.value),
        Node::InlineCode(c) => out.push_str(&c.value),
        _ => {
            if let Some(children) = node.children() {
                for child in children {
                    collect_text(child, out);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexes_headings_with_depth_and_text() {
        let source = "# Introduction\n\nBody text.\n\n## The *moving* argument\n";
        let index = index(source);
        assert_eq!(index.headings.len(), 2);
        assert_eq!(index.headings[0].depth, 1);
        assert_eq!(index.headings[0].text, "Introduction");
        assert_eq!(index.headings[1].depth, 2);
        assert_eq!(index.headings[1].text, "The moving argument");
    }

    #[test]
    fn heading_ranges_point_into_source() {
        let source = "# Title\n";
        let index = index(source);
        let range = index.headings[0].range;
        assert_eq!(&source[range.start..range.end], "# Title");
    }

    #[test]
    fn ignores_hashes_inside_code_fences() {
        let source = "```\n# not a heading\n```\n\n# Real heading\n";
        let index = index(source);
        assert_eq!(index.headings.len(), 1);
        assert_eq!(index.headings[0].text, "Real heading");
    }
}
