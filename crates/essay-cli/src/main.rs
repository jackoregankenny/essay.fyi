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
  essay render <document.md>             (planned) Typeset to PDF
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
        Some(verb @ ("inspect" | "read" | "search" | "propose" | "render" | "status")) => {
            eprintln!("essay {verb}: not implemented yet (see docs/agent-protocol.md)");
            ExitCode::FAILURE
        }
        _ => {
            eprint!("{USAGE}");
            ExitCode::FAILURE
        }
    }
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
