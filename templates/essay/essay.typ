// Essay — default document template.
// Embedded into essay-render at compile time; authors will be able to
// override it per project without changing their manuscript.

#let essay(
  title: none,
  author: none,
  date: none,
  body,
) = {
  set page(
    paper: "a4",
    margin: (x: 2.4cm, top: 2.6cm, bottom: 2.8cm),
    numbering: "1",
  )
  set text(size: 11pt)
  set par(justify: true, leading: 0.68em)

  set heading(numbering: none)
  show heading.where(level: 1): set text(size: 15pt, weight: 600)
  show heading.where(level: 2): set text(size: 12.5pt, weight: 600)
  show heading.where(level: 3): set text(size: 11pt, weight: 600)
  show heading: set block(above: 1.6em, below: 0.9em)
  // Keep headings attached to the text that follows them.
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
    text(size: 9pt, it),
  )
  show raw.where(block: false): set text(size: 0.92em)

  show link: set text(fill: rgb("#3a4db8"))
  show table: set text(size: 9.5pt)
  set table(inset: (x: 0.8em, y: 0.55em))

  show highlight: set highlight(fill: rgb("#fff2a8"))

  if title != none {
    block(below: 2em)[
      #text(size: 19pt, weight: 650)[#title]
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

  body
}
