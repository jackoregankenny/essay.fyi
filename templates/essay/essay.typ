// Essay — the default format.
//
// A single column of justified serif on A4, page numbers at the foot, and a
// quiet title block. The shape of an argument you intend someone to read
// straight through.

#import "/base.typ": typography, title-block, serif-stack

#let doc(
  title: none,
  author: none,
  date: none,
  face: none,
  body,
) = {
  set page(
    paper: "a4",
    margin: (x: 2.4cm, top: 2.6cm, bottom: 2.8cm),
    numbering: "1",
  )

  show heading.where(level: 1): set text(size: 15pt, weight: 600)
  show heading.where(level: 2): set text(size: 12.5pt, weight: 600)
  show heading.where(level: 3): set text(size: 11pt, weight: 600)

  // `show:` rather than wrapping the body, so the title block is inside the
  // document's typography too. Called the other way round, the title rendered
  // in Typst's default face — a sans title over a serif body, on every
  // document that had one.
  show: typography.with(face: face, stack: serif-stack, size: 11pt)

  title-block(title: title, author: author, date: date)
  body
}
