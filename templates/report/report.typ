// Report — long, sectioned, and read by people who will not read all of it.
//
// The two things that separates a report from an essay are both navigational:
// headings are numbered so a section can be referred to out loud, and the
// running head carries the document's title so a page photocopied out of the
// middle still says what it came from. A title page, because a report is a
// thing that gets handed over.

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
    margin: (x: 2.5cm, top: 2.8cm, bottom: 2.6cm),
    numbering: "1",
    header: context {
      // Suppressed on the title page: a running head above the title is noise.
      if title != none and counter(page).get().first() > 1 {
        set text(size: 8.5pt, fill: luma(45%))
        title
        line(length: 100%, stroke: 0.4pt + luma(85%))
      }
    },
  )

  set heading(numbering: "1.1")
  show heading.where(level: 1): set text(size: 14pt, weight: 600)
  show heading.where(level: 1): set block(above: 2em, below: 1em)
  show heading.where(level: 2): set text(size: 12pt, weight: 600)
  show heading.where(level: 3): set text(size: 10.5pt, weight: 600)

  // See essay.typ: `show:` first, so the title page is set in the document's
  // own face rather than Typst's default.
  show: typography.with(face: face, stack: serif-stack, size: 10.5pt)

  if title != none {
    // A title page rather than a title block. `pagebreak(weak: true)` so a
    // report with no body does not emit a blank second page.
    v(6em)
    title-block(title: title, author: author, date: date, size: 24pt, below: 0em)
    pagebreak(weak: true)
  }

  body
}
