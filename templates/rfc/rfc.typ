// RFC — a proposal written to be argued with.
//
// The distinguishing need is reference: a reviewer says "section 3.2 is wrong"
// and everyone has to find the same paragraph. So headings are numbered, the
// measure is narrow enough to read closely, and the status line sits at the
// top where a reader checks whether this is still live before reading a word.
//
// Monospace is deliberately not used for the body. An RFC is prose about code,
// not code.

#import "/base.typ": typography, sans-stack

#let doc(
  title: none,
  author: none,
  date: none,
  face: none,
  body,
) = {
  set page(
    paper: "a4",
    margin: (x: 3.2cm, top: 2.6cm, bottom: 2.6cm),
    numbering: "1",
  )

  set heading(numbering: "1.1")
  show heading.where(level: 1): set text(size: 13pt, weight: 600)
  show heading.where(level: 2): set text(size: 11pt, weight: 600)
  show heading.where(level: 3): set text(size: 10pt, weight: 600)

  // See essay.typ: `show:` first, so the status block is set in the
  // document's own face rather than Typst's default.
  show: typography.with(
    face: face,
    stack: sans-stack,
    size: 10pt,
    leading: 0.75em,
    justify: false,
  )

  if title != none or author != none or date != none {
    block(below: 2em, width: 100%)[
      #if title != none [
        #text(size: 17pt, weight: 650)[#title]
        #v(0.6em)
      ]
      #block(
        width: 100%,
        fill: luma(97%),
        stroke: 0.5pt + luma(88%),
        radius: 3pt,
        inset: (x: 0.9em, y: 0.7em),
        text(size: 9pt, fill: luma(30%))[
          #if author != none [*Author* #h(0.4em) #author]
          #if author != none and date != none [ #h(1.4em) ]
          #if date != none [*Date* #h(0.4em) #date]
        ],
      )
    ]
  }

  body
}
