// Essay — typography shared by every format.
//
// A format decides page geometry, the title block, and how loud its headings
// are. Everything below is what a well-set document does regardless: how a
// quote is indented, how code sits on the page, how a table breathes. Formats
// import this so those decisions are made once and improve everywhere.
//
// Served to Typst as `/base.typ` (see world.rs).

// The serif stack. A stack rather than a family because Essay embeds no fonts
// and typesets with the machine's: naming one family would leave the fallback
// to chance. Order is the intended face, then the best serif each platform
// actually ships — macOS, Windows, then the common Linux packages.
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

// The same reasoning for the sans formats reach for in memos and reports.
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
// — which is the only honest behaviour for an app that uses the machine's
// fonts. `face` is a single family name or none.
#let with-face(face, stack) = {
  if face == none or face == "" { stack } else { (face,) + stack }
}

// Everything that is true of a well-set document whatever its format.
#let typography(
  face: none,
  stack: serif-stack,
  size: 11pt,
  leading: 0.68em,
  justify: true,
  body,
) = {
  set text(size: size, font: with-face(face, stack))
  set par(justify: justify, leading: leading)

  show raw: set text(font: mono-stack)

  set heading(numbering: none)
  show heading: set block(above: 1.6em, below: 0.9em)
  // A heading stranded at the foot of a page is a heading for nothing.
  show heading: it => block(breakable: false, it)

  show quote.where(block: true): it => pad(
    left: 1.2em,
    block(
      stroke: (left: 0.5pt + luma(60%)),
      inset: (left: 1em, y: 0.3em),
      text(style: "italic", fill: luma(25%), it.body),
    ),
  )

  show raw.where(block: true): it => block(
    width: 100%,
    fill: luma(96%),
    stroke: 0.5pt + luma(88%),
    radius: 3pt,
    inset: 0.8em,
    text(size: 0.82em, it),
  )
  show raw.where(block: false): set text(size: 0.92em)

  show link: set text(fill: rgb("#3a4db8"))

  // Book-style tables: no vertical rules, a rule under the header, and room
  // for the text to sit in. The manuscript surface already sets tables this
  // way, so the page matches what was being edited.
  show table: set text(size: 0.87em)
  set table(
    inset: (x: 0.8em, y: 0.55em),
    stroke: (x, y) => (
      top: if y == 1 { 0.5pt + luma(40%) } else { none },
      bottom: none,
      left: none,
      right: none,
    ),
  )

  show highlight: set highlight(fill: rgb("#fff2a8"))

  // Figures caption below, small and quiet.
  show figure.caption: set text(size: 0.85em, fill: luma(35%))

  body
}

// The title block most formats want: title, then a quiet attribution line.
#let title-block(title: none, author: none, date: none, size: 19pt, below: 2em) = {
  if title != none {
    block(below: below)[
      #text(size: size, weight: 650)[#title]
      #if author != none or date != none [
        #v(0.4em)
        #text(size: 10.5pt, fill: luma(35%))[
          #if author != none [#author]
          #if author != none and date != none [ · ]
          #if date != none [#date]
        ]
      ]
    ]
  }
}
