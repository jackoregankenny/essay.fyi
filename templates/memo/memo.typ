// Memo — something short, internal, and meant to be acted on.
//
// Sans rather than serif, ragged right rather than justified, and no page
// numbering: a memo that runs long enough to need numbers is a report. The
// header is a ruled block rather than a title, because the first question a
// reader has is who it is from and when — not what it is called.

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
    margin: (x: 2.6cm, top: 2.4cm, bottom: 2.4cm),
  )

  show heading.where(level: 1): set text(size: 13pt, weight: 600)
  show heading.where(level: 2): set text(size: 11.5pt, weight: 600)
  show heading.where(level: 3): set text(size: 10.5pt, weight: 600)

  // See essay.typ: `show:` first, so the header block is set in the
  // document's own face rather than Typst's default.
  show: typography.with(
    face: face,
    stack: sans-stack,
    size: 10.5pt,
    leading: 0.72em,
    justify: false,
  )

  if title != none or author != none or date != none {
    block(below: 1.8em, width: 100%)[
      #if title != none [
        #text(size: 16pt, weight: 650)[#title]
        #v(0.5em)
      ]
      #line(length: 100%, stroke: 0.5pt + luma(70%))
      #v(0.45em)
      #text(size: 9.5pt, fill: luma(35%))[
        #if author != none [#author]
        #if author != none and date != none [ #h(1fr) ]
        #if date != none [#date]
      ]
    ]
  }

  body
}
