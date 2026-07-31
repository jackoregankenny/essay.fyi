//! The `essay` CLI — the native, machine-readable protocol for agents.
//!
//! `outline` works today as a proof of the pipeline; the remaining verbs
//! arrive with Milestones 3–4. Agents that cannot use this protocol can
//! always fall back to editing the Markdown file directly.

use std::process::ExitCode;

const USAGE: &str = "\
essay — inspect and edit Essay documents

Usage:
  essay outline <document.md>            Print the heading outline
  essay inspect <document.md>            (planned) Document metadata and stats
  essay read <document.md> --section <s> (planned) Read one section
  essay search <document.md> <query>     (planned) Search the document
  essay propose <document.md> --patch <changes.json>
                                         (planned) Submit a structured patch set
  essay render <document.md> [--format pdf|svg|png] [-o <output>]
                                         Typeset via the embedded Typst compiler
  essay status <document.md>             (planned) Pending changes and revisions
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("outline") => match args.get(1) {
            Some(path) => outline(path),
            None => {
                eprintln!("essay outline: missing <document.md>");
                ExitCode::FAILURE
            }
        },
        Some("render") => render(&args[1..]),
        Some(verb @ ("inspect" | "read" | "search" | "propose" | "status")) => {
            eprintln!("essay {verb}: not implemented yet (see docs/agent-protocol.md)");
            ExitCode::FAILURE
        }
        _ => {
            eprint!("{USAGE}");
            ExitCode::FAILURE
        }
    }
}

fn render(args: &[String]) -> ExitCode {
  let Some(path) = args.first().filter(|a| !a.starts_with('-')) else {
    eprintln!("essay render: missing <document.md>");
    return ExitCode::FAILURE;
  };
  let format = flag_value(args, "--format").unwrap_or("pdf");
  let default_out = format!(
    "{}.{format}",
    path.trim_end_matches(".md").trim_end_matches(".markdown")
  );
  let out = flag_value(args, "-o")
    .or(flag_value(args, "--output"))
    .unwrap_or(&default_out);

  let source = match std::fs::read_to_string(path) {
    Ok(source) => source,
    Err(err) => {
      eprintln!("essay render: cannot read {path}: {err}");
      return ExitCode::FAILURE;
    }
  };
  let root = std::path::Path::new(path)
    .parent()
    .map(std::path::Path::to_path_buf);

  let result = match format {
    "pdf" => essay_render::render_pdf(&source, root).map(|bytes| vec![(out.to_string(), bytes)]),
    "png" => essay_render::render_png_page(&source, root, 0, 2.0)
      .map(|bytes| vec![(out.to_string(), bytes)]),
    "svg" => essay_render::render_svg_pages(&source, root).map(|pages| {
      pages
        .svgs
        .into_iter()
        .enumerate()
        .map(|(i, svg)| {
          let name = if i == 0 {
            out.to_string()
          } else {
            out.replace(".svg", &format!("-{}.svg", i + 1))
          };
          (name, svg.into_bytes())
        })
        .collect()
    }),
    other => {
      eprintln!("essay render: unknown format {other} (pdf, svg, png)");
      return ExitCode::FAILURE;
    }
  };

  match result {
    Ok(files) => {
      for (name, bytes) in files {
        if let Err(err) = std::fs::write(&name, bytes) {
          eprintln!("essay render: cannot write {name}: {err}");
          return ExitCode::FAILURE;
        }
        println!("{name}");
      }
      ExitCode::SUCCESS
    }
    Err(err) => {
      eprintln!("essay render: {err}");
      ExitCode::FAILURE
    }
  }
}

fn flag_value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
  args
    .iter()
    .position(|a| a == flag)
    .and_then(|i| args.get(i + 1))
    .map(String::as_str)
}

fn outline(path: &str) -> ExitCode {
    let source = match std::fs::read_to_string(path) {
        Ok(source) => source,
        Err(err) => {
            eprintln!("essay outline: cannot read {path}: {err}");
            return ExitCode::FAILURE;
        }
    };
    for heading in essay_markdown::index(&source).headings {
        let line = source[..heading.range.start].matches('\n').count() + 1;
        let indent = "  ".repeat(usize::from(heading.depth.saturating_sub(1)));
        println!("{line:>5}  {indent}{}", heading.text);
    }
    ExitCode::SUCCESS
}
