# The Shape of an Argument

This fixture stands in for a substantial manuscript. Fixtures here feed the
parser, diff and anchor tests — grow this corpus with real-world documents,
awkward syntax, and files that once broke something.

## Background

Serious documents are developed through repeated structural revision.
Arguments move. Sections expand and collapse. Evidence is added.

### Evidence handling

Footnotes[^1], `inline code`, **bold claims** and [links](https://example.com)
must all survive indexing unchanged.

[^1]: Like this one.

## Argument

```markdown
# Headings inside code fences are not headings
```

| Tables | must |
| ------ | ---- |
| also   | survive |

## Conclusion

Unsupported syntax is not destroyed. The source is canonical.
