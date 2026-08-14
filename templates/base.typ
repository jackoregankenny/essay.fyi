// Essay — typography shared by every format.
//
// A format decides page geometry, the title block, and how loud its headings
// are. Everything below is what a well-set document does regardless: how a
// quote is indented, how code sits on the page, how a table breathes. Formats
// import this so those decisions are made once and improve everywhere.
//
// Every value here is a parameter with a default rather than a constant. That
// is the difference between a format being four files we happen to ship and a
// format being something an author can write: a starting point that has to be
// edited by finding and replacing numbers inside show rules is not a starting
// point. See `templates/format-template.typ`, which is that starting point and
// names every parameter below.
//
// Served to Typst as `/base.typ` (see world.rs).

// ——— Face stacks ———
//
// Stacks rather than families, because Essay embeds no fonts and typesets with
// the machine's: naming one family would leave the fallback to chance. Each
// order is the intended face, then the best each platform actually ships —
// macOS, Windows, then the common Linux packages.

#let serif-stack = (
  "Libertinus Serif",
  "Charter",
  "Palatino Linotype",
  "Palatino",
  "Cambria",
  "Georgia",
  "Liberation Serif",
  "DejaVu Serif",
  "Times New Roman",
)

#let sans-stack = (
  "Inter",
  "Segoe UI Variable Text",
  "Segoe UI",
  "SF Pro Text",
  "Helvetica Neue",
  "Liberation Sans",
  "DejaVu Sans",
  "Arial",
)

#let mono-stack = (
  "DejaVu Sans Mono",
  "Cascadia Mono",
  "Consolas",
  "SF Mono",
  "Menlo",
  "Liberation Mono",
  "Courier New",
)

// The author's chosen face goes in front of the format's stack rather than
// replacing it. A family that is not installed on this machine then falls
// through to the same page everyone else was getting, instead of to an error
// — the only honest behaviour for an app that uses the machine's fonts.
// `face` is a single family name or none.
#let with-face(face, stack) = {
  if face == none or face == "" { stack } else { (face,) + stack }
}

// ——— The document's typography ———
//
// Applied with `show:` rather than by wrapping the body, so that a format's
// title block is inside it too. Called the other way round, a title renders in
// Typst's default face — a sans title over a serif body, on every document
// that has one. That was a real bug, and it is the reason this note exists.
#let typography(
  // The author's family, from front matter. Goes in front of `stack`.
  face: none,
  // The format's own preference, and the fallback chain behind `face`.
  stack: serif-stack,
  // What `raw` is set in. Code is the one place a document must not fall back
  // to a proportional face, so this is its own stack rather than a variant.
  mono: mono-stack,
  size: 11pt,
  leading: 0.68em,
  // Justified suits a serif at a book measure and looks poor in sans at a
  // narrow one, which is why the memo and proposal formats turn it off.
  justify: true,
  // Space above and below a heading, as a multiple of the heading's own size.
  heading-above: 1.6em,
  heading-below: 0.9em,
  // Ink for the small number of things that are not body text. Kept together
  // because a format that changes one usually wants to change its neighbours,
  // and hunting them through show rules is how they drift apart.
  link-fill: rgb("#3a4db8"),
  quote-fill: luma(25%),
  rule-fill: luma(60%),
  caption-fill: luma(35%),
  highlight-fill: rgb("#fff2a8"),
  // Code blocks: a quiet plate rather than a coloured one.
  code-fill: luma(96%),
  code-stroke: luma(88%),
  code-size: 0.82em,
  // Tables set a step down from the body, as books do.
  table-size: 0.87em,
  body,
) = {
  set text(size: size, font: with-face(face, stack))
  set par(justify: justify, leading: leading)

  show raw: set text(font: mono)

  set heading(numbering: none)
  show heading: set block(above: heading-above, below: heading-below)
  // A heading stranded at the foot of a page is a heading for nothing.
  show heading: it => block(breakable: false, it)

  show quote.where(block: true): it => pad(
    left: 1.2em,
    block(
      stroke: (left: 0.5pt + rule-fill),
      inset: (left: 1em, y: 0.3em),
      text(style: "italic", fill: quote-fill, it.body),
    ),
  )

  show raw.where(block: true): it => block(
    width: 100%,
    fill: code-fill,
    stroke: 0.5pt + code-stroke,
    radius: 3pt,
    inset: 0.8em,
    text(size: code-size, it),
  )
  show raw.where(block: false): set text(size: 0.92em)

  show link: set text(fill: link-fill)

  // Book-style tables: no vertical rules, a rule under the header, and room
  // for the text to sit in. The manuscript surface already sets tables this
  // way, so the page matches what was being edited.
  show table: set text(size: table-size)
  set table(
    inset: (x: 0.8em, y: 0.55em),
    stroke: (x, y) => (
      top: if y == 1 { 0.5pt + luma(40%) } else { none },
      bottom: none,
      left: none,
      right: none,
    ),
  )

  show highlight: set highlight(fill: highlight-fill)

  show figure.caption: set text(size: 0.85em, fill: caption-fill)

  body
}

// The title block most formats want: title, then a quiet attribution line.
// A format that wants something else builds it inline — `memo` and `rfc` both
// do, and that is the expected thing to outgrow first.
#let title-block(
  title: none,
  author: none,
  date: none,
  size: 19pt,
  weight: 650,
  below: 2em,
  fill: luma(35%),
) = {
  if title != none {
    block(below: below)[
      #text(size: size, weight: weight)[#title]
      #if author != none or date != none [
        #v(0.4em)
        #text(size: 10.5pt, fill: fill)[
          #if author != none [#author]
          #if author != none and date != none [ · ]
          #if date != none [#date]
        ]
      ]
    ]
  }
}
