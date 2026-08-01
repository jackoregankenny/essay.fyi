//! Emit a `DocumentDiff` as the JSON the WebView receives, for driving the
//! review surface with real data during frontend work.
//!
//!     cargo run -p essay-diff --example emit -- before.md after.md

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (Some(before), Some(after)) = (args.first(), args.get(1)) else {
        eprintln!("usage: emit <before.md> <after.md>");
        std::process::exit(1);
    };
    let old = std::fs::read_to_string(before).expect("before");
    let new = std::fs::read_to_string(after).expect("after");
    let diff = essay_diff::diff_documents(&old, &new);
    println!("{}", serde_json::to_string(&diff).expect("serialize"));
}
