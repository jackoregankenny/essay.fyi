//! Markdown → Typst markup conversion.
//!
//! Walks the mdast tree (same parser as essay-markdown) and emits Typst
//! markup. The manuscript stays canonical — this output is derived,
//! regenerated on every render, never written back.

use markdown::mdast::{AlignKind, Node};
use markdown::ParseOptions;

/// Front matter fields lifted from a leading YAML block, if any.
#[derive(Debug, Default, Clone)]
pub struct FrontMatter {
  pub title: Option<String>,
  pub author: Option<String>,
  pub date: Option<String>,
}

pub struct Converted {
  pub body: String,
  pub front_matter: FrontMatter,
}

pub fn markdown_to_typst(source: &str) -> Converted {
  let mut options = ParseOptions::gfm();
  options.constructs.frontmatter = true;
  let root = markdown::to_mdast(source, &options).unwrap_or(Node::Root(
    markdown::mdast::Root { children: Vec::new(), position: None },
  ));

  let mut out = String::new();
  let mut front_matter = FrontMatter::default();
  if let Some(children) = root.children() {
    for child in children {
      if let Node::Yaml(yaml) = child {
        front_matter = parse_front_matter(&yaml.value);
        continue;
      }
      emit_block(child, &mut out);
    }
  }
  Converted { body: out, front_matter }
}

fn parse_front_matter(yaml: &str) -> FrontMatter {
  // Deliberately minimal: `key: value` lines only. A real YAML parser can
  // come later if templates need richer metadata.
  let mut fm = FrontMatter::default();
  for line in yaml.lines() {
    let Some((key, value)) = line.split_once(':') else { continue };
    let value = value.trim().trim_matches('"').trim_matches('\'').to_string();
    if value.is_empty() {
      continue;
    }
    match key.trim().to_lowercase().as_str() {
      "title" => fm.title = Some(value),
      "author" => fm.author = Some(value),
      "date" => fm.date = Some(value),
      _ => {}
    }
  }
  fm
}

fn emit_block(node: &Node, out: &mut String) {
  match node {
    Node::Heading(h) => {
      out.push('\n');
      out.push_str(&"=".repeat(h.depth as usize));
      out.push(' ');
      emit_inline_children(node, out);
      out.push_str("\n\n");
    }
    Node::Paragraph(_) => {
      emit_inline_children(node, out);
      out.push_str("\n\n");
    }
    Node::Blockquote(q) => {
      out.push_str("#quote(block: true)[\n");
      for child in &q.children {
        emit_block(child, out);
      }
      out.push_str("]\n\n");
    }
    Node::Code(code) => {
      let lang = code.lang.as_deref().unwrap_or("");
      out.push_str("#raw(block: true, lang: \"");
      out.push_str(&escape_string(lang));
      out.push_str("\", \"");
      out.push_str(&escape_string(&code.value));
      out.push_str("\")\n\n");
    }
    Node::List(list) => {
      emit_list(node, list.ordered, 0, out);
      out.push('\n');
    }
    Node::Table(table) => emit_table(&table.children, &table.align, out),
    Node::ThematicBreak(_) => {
      out.push_str(
        "#v(0.4em)\n#align(center)[#text(size: 1.4em, fill: luma(45%))[⁂]]\n#v(0.4em)\n\n",
      );
    }
    Node::Html(html) => {
      // Raw HTML has no Typst meaning; preserve it visibly as code so the
      // author can see it survived rather than silently vanishing.
      out.push_str("#raw(block: true, \"");
      out.push_str(&escape_string(&html.value));
      out.push_str("\")\n\n");
    }
    Node::Math(math) => {
      // Markdown math is TeX-flavoured; Typst math syntax differs. Until a
      // real translation exists, show it as code rather than mistranslate.
      out.push_str("#raw(block: true, lang: \"math\", \"");
      out.push_str(&escape_string(&math.value));
      out.push_str("\")\n\n");
    }
    _ => {
      // Unknown blocks: render their inline content if any, else skip.
      if node.children().is_some() {
        emit_inline_children(node, out);
        out.push_str("\n\n");
      }
    }
  }
}

fn emit_list(node: &Node, ordered: bool, depth: usize, out: &mut String) {
  let Some(children) = node.children() else { return };
  let indent = "  ".repeat(depth);
  for item in children {
    let Node::ListItem(li) = item else { continue };
    out.push_str(&indent);
    out.push_str(if ordered { "+ " } else { "- " });
    if let Some(checked) = li.checked {
      out.push_str(if checked { "☑ " } else { "☐ " });
    }
    let mut first = true;
    for child in &li.children {
      match child {
        Node::Paragraph(_) => {
          if !first {
            out.push_str(&format!("\n{indent}  "));
          }
          emit_inline_children(child, out);
          first = false;
        }
        Node::List(nested) => {
          out.push('\n');
          emit_list(child, nested.ordered, depth + 1, out);
          first = false;
        }
        other => {
          emit_inline_children(other, out);
          first = false;
        }
      }
    }
    out.push('\n');
  }
}

fn emit_table(rows: &[Node], align: &[AlignKind], out: &mut String) {
  let columns = rows
    .first()
    .and_then(|r| r.children().map(|c| c.len()))
    .unwrap_or(0);
  if columns == 0 {
    return;
  }
  let aligns: Vec<&str> = (0..columns)
    .map(|i| match align.get(i) {
      Some(AlignKind::Center) => "center",
      Some(AlignKind::Right) => "right",
      _ => "left",
    })
    .collect();
  out.push_str(&format!(
    "#table(\n  columns: {columns},\n  align: ({},),\n  stroke: none,\n  table.hline(stroke: 0.08em),\n",
    aligns.join(", ")
  ));
  for (index, row) in rows.iter().enumerate() {
    let Some(cells) = row.children() else { continue };
    if index == 0 {
      out.push_str("  table.header(");
      for cell in cells {
        out.push_str("[*");
        emit_inline_children(cell, out);
        out.push_str("*], ");
      }
      out.push_str("),\n  table.hline(stroke: 0.05em),\n");
    } else {
      out.push_str("  ");
      for cell in cells {
        out.push('[');
        emit_inline_children(cell, out);
        out.push_str("], ");
      }
      out.push('\n');
    }
  }
  out.push_str("  table.hline(stroke: 0.08em),\n)\n\n");
}

fn emit_inline_children(node: &Node, out: &mut String) {
  if let Some(children) = node.children() {
    for child in children {
      emit_inline(child, out);
    }
  }
}

fn emit_inline(node: &Node, out: &mut String) {
  match node {
    Node::Text(t) => emit_text(&t.value, out),
    Node::Strong(_) => {
      out.push('*');
      emit_inline_children(node, out);
      out.push('*');
    }
    Node::Emphasis(_) => {
      out.push('_');
      emit_inline_children(node, out);
      out.push('_');
    }
    Node::Delete(_) => {
      out.push_str("#strike[");
      emit_inline_children(node, out);
      out.push(']');
    }
    Node::InlineCode(code) => {
      out.push_str("#raw(\"");
      out.push_str(&escape_string(&code.value));
      out.push_str("\")");
    }
    Node::InlineMath(math) => {
      out.push_str("#raw(\"");
      out.push_str(&escape_string(&math.value));
      out.push_str("\")");
    }
    Node::Link(link) => {
      out.push_str("#link(\"");
      out.push_str(&escape_string(&link.url));
      out.push_str("\")[");
      emit_inline_children(node, out);
      out.push(']');
    }
    Node::Image(image) => {
      out.push_str("#image(\"");
      out.push_str(&escape_string(&image.url));
      out.push_str("\")");
    }
    Node::Break(_) => out.push_str(" \\\n"),
    Node::Html(html) => emit_text(&html.value, out),
    _ => emit_inline_children(node, out),
  }
}

/// Emit a text run, converting `==highlight==` spans (the "come back to
/// this" mark) into Typst highlights and escaping everything else.
fn emit_text(text: &str, out: &mut String) {
  let mut rest = text;
  while let Some(start) = rest.find("==") {
    if let Some(len) = rest[start + 2..].find("==") {
      if len > 0 {
        escape_markup(&rest[..start], out);
        out.push_str("#highlight[");
        escape_markup(&rest[start + 2..start + 2 + len], out);
        out.push(']');
        rest = &rest[start + 2 + len + 2..];
        continue;
      }
    }
    escape_markup(&rest[..start + 2], out);
    rest = &rest[start + 2..];
  }
  escape_markup(rest, out);
}

/// Escape Typst markup-significant characters in prose text.
fn escape_markup(text: &str, out: &mut String) {
  for ch in text.chars() {
    match ch {
      '\\' | '#' | '*' | '_' | '`' | '$' | '@' | '<' | '>' | '[' | ']' | '='
      | '+' | '-' | '/' | '~' | '\'' | '"' => {
        out.push('\\');
        out.push(ch);
      }
      _ => out.push(ch),
    }
  }
}

/// Escape for Typst string literals (inside `"..."`).
fn escape_string(text: &str) -> String {
  text
    .replace('\\', "\\\\")
    .replace('"', "\\\"")
    .replace('\n', "\\n")
    .replace('\r', "")
    .replace('\t', "\\t")
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn converts_headings_and_emphasis() {
    let converted = markdown_to_typst("# Title\n\nSome **bold** and *italic* text.\n");
    assert!(converted.body.contains("= Title"));
    assert!(converted.body.contains("*bold*"));
    assert!(converted.body.contains("_italic_"));
  }

  #[test]
  fn escapes_typst_markup_in_text() {
    let converted = markdown_to_typst("Costs $5 #now [really]\n");
    assert!(converted.body.contains("\\$5"));
    assert!(converted.body.contains("\\#now"));
    assert!(converted.body.contains("\\[really\\]"));
  }

  #[test]
  fn converts_tables_with_header() {
    let converted = markdown_to_typst("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    assert!(converted.body.contains("#table("));
    assert!(converted.body.contains("table.header("));
  }

  #[test]
  fn converts_highlight_marks() {
    let converted = markdown_to_typst("Keep ==this bit== for later.\n");
    assert!(converted.body.contains("#highlight[this bit]"));
  }

  #[test]
  fn lifts_front_matter() {
    let converted = markdown_to_typst("---\ntitle: My Essay\nauthor: Jack\n---\n\nBody.\n");
    assert_eq!(converted.front_matter.title.as_deref(), Some("My Essay"));
    assert_eq!(converted.front_matter.author.as_deref(), Some("Jack"));
    assert!(!converted.body.contains("My Essay"));
  }

  #[test]
  fn code_fences_become_raw_blocks() {
    let converted = markdown_to_typst("```rust\nfn x() {}\n```\n");
    assert!(converted.body.contains("#raw(block: true, lang: \"rust\""));
    assert!(converted.body.contains("fn x() {}"));
  }
}
