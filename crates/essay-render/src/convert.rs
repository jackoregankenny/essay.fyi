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
  /// Whether the document cited anything. Decides whether a bibliography is
  /// worth looking for at all — a manuscript with no citations should not
  /// grow a References heading because a stray `.bib` sits in its folder.
  pub has_citations: bool,
}

/// What the emitter needs to know beyond the node in front of it.
#[derive(Clone, Copy)]
struct Ctx {
  /// Whether `[@key]` may become a real citation.
  ///
  /// False when the document has no bibliography to resolve against, and it
  /// is not a nicety: `#cite` without `#bibliography` is a **compile error**
  /// in Typst, not a missing reference. Emitting one anyway would blank the
  /// preview of any unsaved draft the moment its author typed a citation —
  /// so with nowhere to resolve, `[@key]` stays exactly as it was written.
  citations: bool,
}

/// Convert a manuscript to Typst markup.
///
/// `citations` says whether a bibliography will be available to resolve
/// against; the caller knows, because it is the one that looked for the file.
pub fn markdown_to_typst(source: &str, citations: bool) -> Converted {
  let ctx = Ctx { citations };
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
      emit_block(child, &mut out, ctx);
    }
  }
  let has_citations = out.contains(CITE_OPEN);
  Converted { body: out, front_matter, has_citations }
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

fn emit_block(node: &Node, out: &mut String, ctx: Ctx) {
  match node {
    Node::Heading(h) => {
      out.push('\n');
      out.push_str(&"=".repeat(h.depth as usize));
      out.push(' ');
      emit_inline_children(node, out, ctx);
      out.push_str("\n\n");
    }
    Node::Paragraph(_) => {
      emit_inline_children(node, out, ctx);
      out.push_str("\n\n");
    }
    Node::Blockquote(q) => {
      out.push_str("#quote(block: true)[\n");
      for child in &q.children {
        emit_block(child, out, ctx);
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
      emit_list(node, list.ordered, 0, out, ctx);
      out.push('\n');
    }
    Node::Table(table) => emit_table(&table.children, &table.align, out, ctx),
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
        emit_inline_children(node, out, ctx);
        out.push_str("\n\n");
      }
    }
  }
}

fn emit_list(node: &Node, ordered: bool, depth: usize, out: &mut String, ctx: Ctx) {
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
          emit_inline_children(child, out, ctx);
          first = false;
        }
        Node::List(nested) => {
          out.push('\n');
          emit_list(child, nested.ordered, depth + 1, out, ctx);
          first = false;
        }
        other => {
          emit_inline_children(other, out, ctx);
          first = false;
        }
      }
    }
    out.push('\n');
  }
}

fn emit_table(rows: &[Node], align: &[AlignKind], out: &mut String, ctx: Ctx) {
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
        emit_inline_children(cell, out, ctx);
        out.push_str("*], ");
      }
      out.push_str("),\n  table.hline(stroke: 0.05em),\n");
    } else {
      out.push_str("  ");
      for cell in cells {
        out.push('[');
        emit_inline_children(cell, out, ctx);
        out.push_str("], ");
      }
      out.push('\n');
    }
  }
  out.push_str("  table.hline(stroke: 0.08em),\n)\n\n");
}

fn emit_inline_children(node: &Node, out: &mut String, ctx: Ctx) {
  if let Some(children) = node.children() {
    for child in children {
      emit_inline(child, out, ctx);
    }
  }
}

fn emit_inline(node: &Node, out: &mut String, ctx: Ctx) {
  match node {
    Node::Text(t) => emit_text(&t.value, out, ctx),
    Node::Strong(_) => {
      out.push('*');
      emit_inline_children(node, out, ctx);
      out.push('*');
    }
    Node::Emphasis(_) => {
      out.push('_');
      emit_inline_children(node, out, ctx);
      out.push('_');
    }
    Node::Delete(_) => {
      out.push_str("#strike[");
      emit_inline_children(node, out, ctx);
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
      emit_inline_children(node, out, ctx);
      out.push(']');
    }
    Node::Image(image) => {
      out.push_str("#image(\"");
      out.push_str(&escape_string(&image.url));
      out.push_str("\")");
    }
    Node::Break(_) => out.push_str(" \\\n"),
    Node::Html(html) => emit_text(&html.value, out, ctx),
    _ => emit_inline_children(node, out, ctx),
  }
}

/// The exact opening `emit_citation` writes.
///
/// Author prose can never produce it: `escape_markup` escapes `#`, `(` is not
/// special but `<` is, and all three would have to survive unescaped and
/// adjacent. So a match in the emitted body is always one this file put
/// there, which is what lets the caller ask "did this document cite
/// anything?" without threading a flag through every emitter.
pub(crate) const CITE_OPEN: &str = "#cite(<";

/// Emit a text run, converting the two inline constructs that live inside
/// plain text — `==highlight==` marks and `[@key]` citations — and escaping
/// everything else.
///
/// Both are found in `Text` nodes rather than as mdast constructs, because
/// neither is Markdown: `==…==` is Obsidian's, and `[@key]` is Pandoc's. The
/// parser hands them over as literal text and this is where they become
/// typesetting.
fn emit_text(text: &str, out: &mut String, ctx: Ctx) {
  let mut rest = text;
  loop {
    // Whichever construct opens first owns the prose up to it.
    let Some(start) = [rest.find("=="), rest.find("[@")]
      .into_iter()
      .flatten()
      .min()
    else {
      break;
    };

    let taken = if rest[start..].starts_with("[@") {
      ctx.citations.then(|| emit_citation(&rest[start..])).flatten()
    } else {
      emit_highlight(&rest[start..])
    };

    match taken {
      Some((typst, len)) => {
        escape_markup(&rest[..start], out);
        out.push_str(&typst);
        rest = &rest[start + len..];
      }
      // The opener never closed, or held something that was not a citation.
      // It is ordinary punctuation: emit it escaped and step past, so the
      // scan cannot stall on the same position.
      None => {
        escape_markup(&rest[..start + 2], out);
        rest = &rest[start + 2..];
      }
    }
  }
  escape_markup(rest, out);
}

/// `==come back to this==` → a Typst highlight, and the bytes it consumed.
fn emit_highlight(text: &str) -> Option<(String, usize)> {
  let len = text[2..].find("==")?;
  if len == 0 {
    return None;
  }
  let mut out = String::from("#highlight[");
  escape_markup(&text[2..2 + len], &mut out);
  out.push(']');
  Some((out, 2 + len + 2))
}

/// Pandoc's `[@key]`, or `[@one; @two]`, → Typst `#cite` calls.
///
/// Only the bracketed form is recognised, and every entry inside the
/// brackets has to be a bare key. Pandoc also allows a naked `@key` mid
/// sentence, and Essay deliberately does not: `@` is far too common in prose
/// — addresses, handles, "10 @ £4" — for an unbracketed match to be anything
/// but a trap, and a citation that silently swallows an email address is
/// worse than one an author has to bracket.
///
/// Anything inside the brackets that is not a key returns `None` and the text
/// stays as the author wrote it. `[see @smith, p. 33]` is therefore not a
/// citation yet; the prefix and locator forms are a later job.
fn emit_citation(text: &str) -> Option<(String, usize)> {
  let end = text.find(']')?;
  let mut out = String::new();
  for entry in text[1..end].split(';') {
    let key = entry.trim().strip_prefix('@')?;
    if key.is_empty() || !key.chars().all(is_key_char) {
      return None;
    }
    out.push_str(CITE_OPEN);
    out.push_str(key);
    out.push_str(">)");
  }
  // `[]` and `[;]` hold no keys and are not citations.
  if out.is_empty() {
    return None;
  }
  Some((out, end + 1))
}

/// What may appear in a citation key. Matches the intersection of what BibTeX
/// keys use in practice and what Typst accepts in a `<label>`, because the
/// key is emitted straight into one.
fn is_key_char(ch: char) -> bool {
  ch.is_alphanumeric() || matches!(ch, '_' | '-' | '.' | ':')
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
  /// Conversion with a bibliography available, which is the interesting
  /// case for every construct below: it is the mode in which `[@key]` is
  /// allowed to fire, so a test asserting that something is *not* a
  /// citation is making the stronger claim here than it would with
  /// citations switched off.
  fn convert(source: &str) -> Converted {
    markdown_to_typst(source, true)
  }


  #[test]
  fn converts_headings_and_emphasis() {
    let converted = convert("# Title\n\nSome **bold** and *italic* text.\n");
    assert!(converted.body.contains("= Title"));
    assert!(converted.body.contains("*bold*"));
    assert!(converted.body.contains("_italic_"));
  }

  #[test]
  fn escapes_typst_markup_in_text() {
    let converted = convert("Costs $5 #now [really]\n");
    assert!(converted.body.contains("\\$5"));
    assert!(converted.body.contains("\\#now"));
    assert!(converted.body.contains("\\[really\\]"));
  }

  #[test]
  fn converts_tables_with_header() {
    let converted = convert("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    assert!(converted.body.contains("#table("));
    assert!(converted.body.contains("table.header("));
  }

  #[test]
  fn converts_highlight_marks() {
    let converted = convert("Keep ==this bit== for later.\n");
    assert!(converted.body.contains("#highlight[this bit]"));
  }

  #[test]
  fn lifts_front_matter() {
    let converted = convert("---\ntitle: My Essay\nauthor: Jack\n---\n\nBody.\n");
    assert_eq!(converted.front_matter.title.as_deref(), Some("My Essay"));
    assert_eq!(converted.front_matter.author.as_deref(), Some("Jack"));
    assert!(!converted.body.contains("My Essay"));
  }

  #[test]
  fn code_fences_become_raw_blocks() {
    let converted = convert("```rust\nfn x() {}\n```\n");
    assert!(converted.body.contains("#raw(block: true, lang: \"rust\""));
    assert!(converted.body.contains("fn x() {}"));
  }

  #[test]
  fn converts_bracketed_citations() {
    let converted = convert("Brevity is old advice [@strunk1918].\n");
    assert!(converted.body.contains("#cite(<strunk1918>)"));
    assert!(converted.has_citations);
  }

  #[test]
  fn several_keys_in_one_bracket_each_cite() {
    let converted = convert("Both agree [@a2020; @b1999].\n");
    assert!(converted.body.contains("#cite(<a2020>)#cite(<b1999>)"));
  }

  /// The whole reason the bracketed form is required. Each of these would be
  /// swallowed by a naive `@word` match, and the failure would be silent —
  /// the author's address would vanish into a citation that resolves to
  /// nothing.
  #[test]
  fn things_that_look_like_citations_and_are_not() {
    for source in [
      "Write to jack@example.com about it.\n",
      "Ten @ £4 each.\n",
      "A bracketed aside [see @strunk1918, p. 12] stays put.\n",
      "An empty bracket [] and a reference [note].\n",
      "A bare [@] with no key.\n",
    ] {
      let converted = convert(source);
      assert!(
        !converted.has_citations,
        "should not have cited anything in {source:?}, got {:?}",
        converted.body
      );
    }
  }

  #[test]
  fn a_citation_beside_a_highlight_leaves_both_intact() {
    let converted = convert("Keep ==this bit== and cite [@knuth1984] too.\n");
    assert!(converted.body.contains("#highlight[this bit]"));
    assert!(converted.body.contains("#cite(<knuth1984>)"));
  }

  /// An unclosed marker must not stall the scan or eat the rest of the run.
  #[test]
  fn unclosed_markers_stay_literal() {
    let converted = convert("An open [@key and an open ==mark here.\n");
    assert!(!converted.has_citations);
    assert!(!converted.body.contains("#highlight["));
    assert!(converted.body.contains("key and an open"));
    assert!(converted.body.contains("mark here"));
  }

  #[test]
  fn a_document_that_cites_nothing_says_so() {
    let converted = convert("# Plain\n\nNo sources here.\n");
    assert!(!converted.has_citations);
  }

  /// With no bibliography to resolve against, a citation must stay the text
  /// the author typed. Emitting `#cite` here is not a missing reference in
  /// Typst — it is a compile error, so this is the difference between an
  /// unsaved draft that previews and one that shows nothing at all.
  #[test]
  fn without_a_bibliography_a_citation_stays_literal() {
    let converted = markdown_to_typst("Old advice [@strunk1918].\n", false);
    assert!(!converted.has_citations);
    assert!(!converted.body.contains(CITE_OPEN));
    assert!(
      converted.body.contains("strunk1918"),
      "the author's text went missing: {:?}",
      converted.body
    );
  }
}
