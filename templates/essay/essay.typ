// Essay — default document template.
// Wired into the render pipeline in Milestone 2 (essay-render generates a
// document that calls this template). Authors customise or replace this
// file without changing their manuscript.

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
  set par(justify: true, leading: 0.68em, first-line-indent: 1.2em)

  set heading(numbering: none)
  show heading.where(level: 1): set text(size: 15pt, weight: 600)
  show heading.where(level: 2): set text(size: 12.5pt, weight: 600)
  show heading: set block(above: 1.6em, below: 0.9em)

  // Keep headings attached to the text that follows them.
  show heading: it => block(breakable: false, it)

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
