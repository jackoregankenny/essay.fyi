# Setext Heading One

This file is the round-trip adversary. Every construct below is here because it
is easy to destroy: an editor that parses to a tree and writes the tree back out
will silently normalise most of it.

The rule under test is invariant 2 — saving must not gratuitously rewrite the
author's Markdown, and unknown syntax must survive unchanged.

## Setext Heading Two

## Emphasis markers must not be normalised

*Underscore emphasis* and *asterisk emphasis* mean the same thing and are not
the same bytes. **Double underscore** and **double asterisk** likewise.

Intra*word*emphasis and snake_case_identifiers must not be mangled.

## Reference links must stay references

A [reference link](https://example.com/one "With a title") and a [collapsed reference](https://example.com/two) and a [shortcut ref](https://example.com/three).
An ![image reference](https://example.com/image.png) too.

An [https://example.com/autolink](https://example.com/autolink) and a raw URL: [https://example.com/bare](https://example.com/bare)

## Hard breaks are load-bearing

This line ends with two spaces  
and continues here, which is a hard break.

This line ends with a backslash  
and continues here, which is also a hard break.

## Lists with awkward markers

* Asterisk bullet
* Second

- Dash bullet
- Second

+ Plus bullet
+ Second

1. Ordered
2. All ones on purpose
3. Renumbering this would be a rewrite
4. Starting at seven
5. Continuing

- [ ] Unchecked task
- [x] Checked task
- [x] Capital X checked

## Nested and lazy structures

> A block quote
>
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

Inline `code`, `code with a ` backtick`, and `triple ` inside`.

## HTML must pass through untouched

**Raw HTML block.** Nothing here is Markdown.

Inline HTML too, and a
self-closing   
 tag.



## Tables that are not tidy

| Ragged | Table |
| --- | --- |
| a | b |
| a longer cell than the header | c |

| Left | Centre | Right |
| :--- | :---: | ---: |
| 1 | 2 | 3 |

## Footnotes and their ordering

A reference to the second footnote[^second] before the first[^first].

[^first]: The first footnote body, defined second.
[^second]: The second footnote body, defined first.

## Escapes and entities

Literal asterisks \*not emphasis\* and a literal underscore \_here\_.
A backslash at the end of a word\ and an ampersand & entity.
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

&lt;Callout type="warning"&gt;
  Tolerated MDX-style syntax.
&lt;/Callout&gt;

## Highlights

Essay's own ==come back to this== marks, which serialize to Obsidian-compatible
double equals, and a lone == that is not a highlight.

## Trailing conditions

A final line with trailing whitespace  
and a file that deliberately ends without a trailing newline.
