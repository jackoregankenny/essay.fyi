// A format for Essay — copy this file and edit it.
//
// This is a working format, not a sketch: it typesets, and Essay's own tests
// compile it on every change so that a copy of it is never a copy of something
// broken. Rename it to whatever your house style is called, change what you
// want, and import it from Settings.
//
// ——— The contract ———
//
// Essay imports your file as `/format.typ` and calls exactly one function
// from it:
//
//   doc(title: none, author: none, date: none, face: none, body)
//
// It must be named `doc` and it must accept those four named arguments, even
// if it ignores them. Essay fills them from the document's own front matter:
//
//   ---
//   title: What I think we need to do
//   author: Jack
//   date: 14 August 2026
//   format: my-house-style     <- the id you import this under
//   font: Georgia              <- becomes `face`
//   ---
//
// `face` is the family the author picked. Pass it through to `typography`
// rather than using it directly: it belongs in *front* of your stack, not
// instead of it, so that a document asking for a font this machine does not
// have still prints rather than failing.
//
// ——— What you can rely on ———
//
// `/base.typ` is always available and is where the shared typography lives.
// You are importing three things from it below; everything it exposes is a
// named parameter with a default, listed in that file.
//
// You cannot import Typst packages. Essay renders offline by design, so there
// is no package registry to reach — everything you need is in this file and in
// `/base.typ`. You also cannot read files outside the document's own folder.
//
// ——— What to change first ———
//
// Page geometry and the title block, below. They are what make a format feel
// like a different document; the typography defaults are already good and are
// worth leaving alone until you have a reason.

#import "/base.typ": typography, title-block, serif-stack, sans-stack

#let doc(
  title: none,
  author: none,
  date: none,
  face: none,
  body,
) = {
  // ——— The page ———
  //
  // `numbering: none` drops page numbers, which suits anything short. A
  // running head goes here too — see `templates/report/report.typ` for one
  // that carries the title and suppresses itself on the first page.
  set page(
    paper: "a4",
    margin: (x: 2.4cm, top: 2.6cm, bottom: 2.8cm),
    numbering: "1",
  )

  // ——— Headings ———
  //
  // Sizes are yours; the spacing around them and the rule that keeps a heading
  // attached to its text come from `typography`. Add `set heading(numbering:
  // "1.1")` above these if sections should be numbered.
  show heading.where(level: 1): set text(size: 15pt, weight: 600)
  show heading.where(level: 2): set text(size: 12.5pt, weight: 600)
  show heading.where(level: 3): set text(size: 11pt, weight: 600)

  // ——— Everything else ———
  //
  // `show:` rather than wrapping `body`, so the title block below is inside
  // this typography too. Written the other way round, your title renders in
  // Typst's default face while the body renders in yours.
  //
  // Swap `serif-stack` for `sans-stack` to change the document's character in
  // one word. The commented parameters are the ones worth reaching for next;
  // the full list is in `/base.typ`.
  show: typography.with(
    face: face,
    stack: serif-stack,
    size: 11pt,
    // leading: 0.68em,
    // justify: true,
    // link-fill: rgb("#3a4db8"),
    // code-fill: luma(96%),
    // table-size: 0.87em,
  )

  // ——— The title block ———
  //
  // `title-block` is the conventional one. Replace this call with your own
  // markup when you outgrow it — a letterhead, a logo, a status table — and
  // guard it with `if title != none` so an untitled draft does not print an
  // empty header.
  title-block(title: title, author: author, date: date)

  body
}
