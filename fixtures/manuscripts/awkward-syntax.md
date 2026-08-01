Setext Heading One
==================

This file is the round-trip adversary. Every construct below is here because it
is easy to destroy: an editor that parses to a tree and writes the tree back out
will silently normalise most of it.

The rule under test is invariant 2 — saving must not gratuitously rewrite the
author's Markdown, and unknown syntax must survive unchanged.

Setext Heading Two
------------------

## Emphasis markers must not be normalised

_Underscore emphasis_ and *asterisk emphasis* mean the same thing and are not
the same bytes. __Double underscore__ and **double asterisk** likewise.

Intra*word*emphasis and snake_case_identifiers must not be mangled.

## Reference links must stay references

A [reference link][ref] and a [collapsed reference][] and a [shortcut ref].
An ![image reference][img] too.

[ref]: https://example.com/one "With a title"
[collapsed reference]: https://example.com/two
[shortcut ref]: https://example.com/three
[img]: https://example.com/image.png

An <https://example.com/autolink> and a raw URL: https://example.com/bare

## Hard breaks are load-bearing

This line ends with two spaces  
and continues here, which is a hard break.

This line ends with a backslash\
and continues here, which is also a hard break.

## Lists with awkward markers

* Asterisk bullet
* Second

- Dash bullet
- Second

+ Plus bullet
+ Second

1. Ordered
1. All ones on purpose
1. Renumbering this would be a rewrite

7. Starting at seven
8. Continuing

- [ ] Unchecked task
- [x] Checked task
- [X] Capital X checked

## Nested and lazy structures

> A block quote
> > containing a nested block quote
>
> - with a list inside
> - second item

1. An ordered item

   with a loose paragraph inside it

   ```js
   // and a fenced block inside a list item
   const indented = true
   ```

2. Second item

## Code fences of several kinds

```
Unlabelled fence
```

~~~python
# Tilde fence
def survive(): pass
~~~

````markdown
```
A fence inside a fence, four backticks outside
```
````

    An indented code block.
    Four spaces, not a fence.

Inline `code`, ``code with a ` backtick``, and ```triple ` inside```.

## HTML must pass through untouched

<div class="callout" data-note="unknown to the editor">
  <strong>Raw HTML block.</strong> Nothing here is Markdown.
</div>

Inline <abbr title="HyperText Markup Language">HTML</abbr> too, and a
self-closing <br/> tag.

<!-- An HTML comment that must not be eaten. -->

## Tables that are not tidy

| Ragged | Table |
|---|---|
| a | b |
| a longer cell than the header | c |

| Left | Centre | Right |
| :--- | :----: | ----: |
| 1 | 2 | 3 |

## Footnotes and their ordering

A reference to the second footnote[^second] before the first[^first].

[^first]: The first footnote body, defined second.
[^second]: The second footnote body, defined first.

## Escapes and entities

Literal asterisks \*not emphasis\* and a literal underscore \_here\_.
A backslash at the end of a word\\ and an ampersand &amp; entity.
Characters that matter to a typesetter: # $ % & ~ ^ _ { } \ < >

## Syntax the editor does not know

:::note
A fenced custom block. The editor has no extension for this and must not
destroy it.
:::

{{< shortcode param="value" >}}

$$
E = mc^2
$$

Inline math $a^2 + b^2 = c^2$ and a currency amount $50 that is not math.

<Callout type="warning">
  Tolerated MDX-style syntax.
</Callout>

## Highlights

Essay's own ==come back to this== marks, which serialize to Obsidian-compatible
double equals, and a lone == that is not a highlight.

## Trailing conditions

A final line with trailing whitespace   
and a file that deliberately ends without a trailing newline.
