# `@markscript/docx`

`@markscript/docx` converts a full MarkScript MDAST document to a `.docx` file.
Its transform stage resolves Word semantics into standard readable MDAST and plain `data.docx` objects.
`writeDocx` then uses the finalized tree. It performs output only, after MarkScript rendering and transforms.

The published package bundles its patched `docx` engine.
It keeps character indentation, line-based paragraph spacing, and custom paragraph and character styles with external styles.
The `docx` dependency gives public option types.

## full document setup

During document rendering, call `hookDocx` directly. The hook registers one `onTransform` callback for the full document.
Call `writeDocx` from `onReady`. At this point, the document is completed, validated, and frozen.

```tsx
import {onReady} from '@markscript/markscript'
import {
  Bibliography,
  Cite,
  hookDocx,
  PageBreak,
  writeDocx,
} from '@markscript/docx'

export const sources = {
  main: [
    {id: 'kay-2025', author: 'A. Kay', title: 'A useful paper', issued: 2025},
  ],
}

{hookDocx({
  document: {
    creator: 'MarkScript',
    title: 'Quarterly report',
    styles: {
      paragraphStyles: [
        {
          id: 'FigureCaption',
          name: 'Figure caption',
          basedOn: 'Normal',
          paragraph: {spacing: {before: 120, after: 240}},
          run: {italics: true, color: '444444'},
        },
      ],
      characterStyles: [
        {id: 'Term', name: 'Term', run: {bold: true, color: '175CD3'}},
      ],
    },
    features: {updateFields: true},
  },
  bibliography: {sources, defaultSource: 'main'},
})}

# Quarterly report

The source is linked in Word {<Cite keys="kay-2025" source="main" />}.

{<PageBreak />}

{<Bibliography source="main" title="References" includeUncited />}

{onReady(({root}) => writeDocx(root, './quarterly-report.docx'))}
```

The hook calls direct transforms in this order:

1. `transformSatori(root, options.satori)`
2. `transformEcharts(root, options.echarts)`
3. `transformOoxml(root, options.ooxml)`
4. `transformCodeHighlight(root, options.code)`
5. `resolveDocx(root, options)`

To use selected behavior, register the exported transforms with the runtime API. Each transform takes the root first:

```tsx
import {onTransform} from '@markscript/markscript'
import {resolveDocx, transformCodeHighlight} from '@markscript/docx'

{onTransform(async ({root}) => {
  await transformCodeHighlight(root, {theme: 'github-light'})
  await resolveDocx(root, {document: {creator: 'MarkScript'}})
})}
```

## Word construct mapping

This table maps Word concepts to MarkScript and the finalized MDAST contract.

| Word construct | MarkScript form | Final MDAST data |
|---|---|---|
| Document metadata, styles, numbering, settings | `hookDocx({document: {...}})` | `root.data.docx.document` |
| Paragraph formatting | `{attach('docx', {paragraph: {...}})}` before a standard paragraph, or `withDocx(node, {...})` | `node.data.docx.paragraph` |
| Empty paragraph | an explicit `<p />` | standard paragraph with no children |
| Run formatting | `<Span run={{...}}>…</Span>` or `withDocx(node, {run: {...}})` | `node.data.docx.run` |
| Page break | `<PageBreak />` or `::docx-page-break` before its target block | standard empty paragraph or target node with `data.docx.pageBreak: true` |
| Section boundary | `<Section section="landscape" />` or `::docx-section{section=landscape}` before its target block | standard empty paragraph or target node with resolved `data.docx.section` |
| Page, count, date, sequence, reference, or custom field | `<Field kind="pageNumber">1</Field>` or `:docx-field{kind=pageNumber cached=1}` before phrasing content | standard text or target node with `data.docx.field` |
| Table of contents | `<Toc headingStyleRange="1-3" />` or `::docx-toc{headingStyleRange="1-3" hyperlink}` before its target block | standard paragraph or target node with `data.docx.toc` and cached headings |
| Tab | `<Tab />` or `:docx-tab` before phrasing content | zero-width text or target node with `data.docx.tab: true` |
| Standard or nonbreaking space | `<Space count={2} />`, `<Space nonBreaking />` | standard text containing spaces or `U+00A0` |
| Caption | `<Caption id="plot">Latency</Caption>` | standard paragraph with visible resolved number and `data.docx.caption` |
| Cross-reference | `<Ref target="plot" />` | standard link with resolved field fallback in `data.docx.reference` |
| Citation | `:cite{keys=alpha}` before citation text, or `<Cite keys={['alpha', 'beta']} source="main" />` | readable citation content containing standard internal links |
| Bibliography | `<Bibliography source="main" title="References" includeUncited />` | standard heading and bookmarked paragraphs |
| Table, row, and cell options | `docxTable(...)` or `withDocx` on standard GFM table nodes | `data.docx.table`, `.row`, and `.cell` |
| Image options | `<DocxImage ... image={{...}} />` or `withDocx(image, {image: {...}})` | standard MDAST image with `data.docx.image` |
| Highlighted fenced code | standard fenced code with a supported language | unchanged code node plus plain `data.docx.code.lines` tokens |
| Satori visual | a `satori` fenced code block | standard SVG or requested PNG image node |
| ECharts visual | an `echarts` fenced code block | standard SVG image node |
| Unsafe OOXML escape hatch | an `ooxml` fenced code block | HTML node with validated `data.docx.rawXml` |

Option values under `data.docx` use the corresponding `docx` package option structure directly.
`docx.js` and Word resolve style inheritance with their own model.

Use standard Markdown directly, without a Word wrapper. The writer maps standard nodes with these rules:

| Standard MDAST | Word output |
|---|---|
| Heading depths 1 through 6 | Word Heading 1 through Heading 6 paragraphs |
| Paragraph and text | Word paragraph and text runs |
| Strong, emphasis, deletion, inline code | bold, italic, strike, and monospace runs |
| Links and link references | external or internal Word hyperlinks |
| Ordered, unordered, nested, and task lists | Word numbering definitions and list paragraphs |
| GFM table, row, and cell | Word table, row, and cell |
| Image and image reference | Word image run, resolved at write time |
| Footnote definition and reference | Word footnote part and reference run |
| Blockquote | indented Word paragraphs |
| Thematic break and hard break | paragraph rule and line break |

## DOCX directive data

`attach('docx', ...)` attaches Word options to the exact next compatible MDAST node.
Named DOCX directives process their corresponding source forms with string values.

```mdx
{attach('docx', {paragraph: {style: 'ReportBody', keepNext: true}})}

This paragraph receives `data.docx.paragraph`.

<p>
  Inline {attach('docx', {run: {bold: true, color: '175CD3'}})}<strong>terms</strong>
  receive `data.docx.run` on that exact `strong` node.
</p>

{attach('docx', {image: {transformation: {width: 640, height: 360}}})}
<img src="./request-flow.png" alt="Request flow" />
```

At root or block scope, put `attach('docx', ...)` immediately before the Markdown block.
Inside a paragraph, put it immediately before the target phrasing node, link, or image.
Consecutive attachments use a shallow merge in the same namespace.
Object-valued options use `docx.js` structures. The library reads `node.data.docx` directly.

## Formatting standard MDAST

Use standard Markdown for paragraphs. Attach Word format options directly to the next paragraph.
For an explicit blank paragraph, use `<p />`.

```tsx
import {
  DocxImage,
  Span,
  docxTable,
  mm,
} from '@markscript/docx'

{attach('docx', {paragraph: {style: 'FigureCaption', keepNext: true}})}

<Span run={{bold: true, color: '175CD3'}}>Important</Span> text

{attach('docx', {paragraph: {style: 'Spacer'}})}

<p />

{docxTable({
  table: {style: 'TableGrid', width: {size: 100, type: 'pct'}},
  rows: [
    {
      row: {cantSplit: true, tableHeader: true},
      cells: [
        {content: 'Name', cell: {width: {size: mm(40), type: 'dxa'}}},
        {content: 'Value'},
      ],
    },
  ],
})}

{<DocxImage
  src="./diagram.png"
  alt="Request flow"
  image={{transformation: {width: 640, height: 360}}}
/>}
```

`Span` applies one `IRunOptions` object to all phrasing descendants.
`docxTable` and `DocxImage` attach table, row, cell, and image options and keep standard MDAST content.
Programmatic MDAST can use `withDocx(node, {paragraph: {...}})`.
The `mm`, `cm`, `inch`, `pt`, and `percent` helpers create measure strings that `docx.js` accepts.

The public document type excludes SDK object fields: embedded font buffers, comment children, imported style components, and section wrapper classes.
Final `data.docx` is plain data that supports JSON round-trip conversion.
The writer resolves external image bytes only during output.

## Sections, headers, and footers

Name reusable sections in the hook. Put a readable section directive at each boundary.
A section object uses `docx.js` section property structures. Headers and footers are standard MDAST roots.

```tsx
import {docxPart, hookDocx, Section, SectionBreak} from '@markscript/docx'

{hookDocx({
  sections: {
    portrait: {
      properties: {page: {margin: {top: '20mm', bottom: '20mm'}}},
      headers: {default: docxPart(<>Confidential report</>)},
      footers: {default: docxPart(<>Internal use</>)},
    },
    landscape: {
      properties: {page: {size: {orientation: 'landscape'}}},
    },
  },
  defaultSection: 'portrait',
})}

{<Section section="landscape" />}

## Wide table

{<SectionBreak section="portrait" breakBefore="nextPage" />}
```

`Section` starts the selected section. `SectionBreak` also sets `breakBefore`, with `nextPage` as the default.
The literal directive accepts `continuous`, `nextPage`, `evenPage`, or `oddPage`.

## Fields, captions, references, and bibliography

JSX helpers emit standard MDAST directly. Corresponding source directives are zero-width attachers.
Their data becomes part of standard readable MDAST content.

```markdown
:docx-field{kind=pageNumber cached=1}**1** of :docx-field{kind=pageCount cached=10}**10**
:docx-tab`⇥`

::docx-toc{headingStyleRange="1-3" hyperlink}
Contents

::docx-caption{id=latency kind=figure label=Figure}
Latency by region

:docx-ref{target=latency}**Reference ?**

:docx-citation{keys="@alpha; @beta" source=main}**citation**
:cite{keys=alpha source=main}**citation**

::docx-bibliography{source=main includeUncited headingDepth=2}
## References
```

`resolveDocx` numbers captions and bibliography records in document order.
It creates deterministic valid Word bookmark names, updates visible fallback text, resolves references, and expands bibliography markers.
Citations become standard internal MDAST links to bibliography entries.

A custom `formatCitation(records, numbers)` or `formatBibliographyEntry(record, number)` can return a string or promise.
Only the returned text enters the final tree.
A one-key citation accepts custom `formatCitation` because its full text has one unambiguous bibliography link.
Multiple-key citations use the built-in linked form, such as `[1, 2]`, and omit the formatter call.
For custom styles on multiple keys, use adjacent one-key citations.

`:cite{keys=key}` is the short source form. Separate multiple keys with commas or semicolons.
It applies the numeric Word citation superscript run style to the next phrasing node.
Use `:docx-citation` or `<Cite>` for custom presentation without superscript.

Give bibliography sources directly, as named sources, or with an explicit default:

```tsx
{hookDocx({
  bibliography: {
    sources: {
      main: [{id: 'alpha', title: 'Alpha'}],
      appendix: {beta: {title: 'Beta'}},
    },
    defaultSource: 'main',
  },
})}
```

## Satori, ECharts, and OOXML fences

Each consumer selects a standard code-fence node by `lang`.
A preceding attachment gives computed options through `data.satori`, `data.echarts`, or `data.ooxml`.
Otherwise, directive attributes give string-valued options.

```tsx
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {attach} from '@markscript/markscript'

export const interFontPath = fileURLToPath(
  new URL('./Inter-Regular.ttf', import.meta.url),
)

{hookDocx({
  echarts: {fontFiles: [interFontPath]},
  satori: {
    fonts: [
      {
        name: 'Inter',
        data: readFileSync(interFontPath),
        weight: 400,
        style: 'normal',
      },
    ],
  },
})}

{attach('satori', {width: 1200, height: 630, alt: 'Release summary'})}
```satori
  <div style={{display: 'flex', padding: 64, background: '#ffffff'}}>
    Release summary
  </div>
```

{attach('satori', {
  width: 1200,
  height: 630,
  alt: 'Raster release summary',
  format: 'png',
  pixelRatio: 3,
})}
```satori
  <div style={{display: 'flex'}}>Rasterized at 3×, placed at 1200×630</div>
```

{attach('echarts', {
  width: 960,
  height: 540,
  alt: 'Monthly volume',
  option: {
    xAxis: {type: 'category', data: months},
    yAxis: {type: 'value'},
    series: [{type: 'bar', data: volume}],
  },
})}
```echarts
{}
```
```

For `satori`, give explicit positive `width` and `height`, non-empty `alt`, and at least one configured font.
The compiler processes the fence body as a self-contained TSX fragment with Satori's JSX factory.

Satori output uses SVG by default. `format="png"` converts the generated SVG to PNG.
`pixelRatio` controls pixel density. Word placement keeps the declared width and height.
Use PNG when the target Word version cannot display SVG reliably.

For `echarts`, give the same dimensions and alt text, plus an object-valued `option`.
It uses ECharts server-side SVG rendering.
`echarts.fontFiles` gives explicit fonts for a deterministic PNG fallback, including each text glyph for Word clients without SVG support.

Both transforms replace the fence with a standard MDAST image.
Its source is an SVG data URL. Its `data.docx.image` contains direct image options.
The generated fallback is a plain PNG data URL in `data.docx.image.fallback`.

The `ooxml` language gives explicit unsafe XML access:

````md
```ooxml
  <w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:r><w:t>Native Word content</w:t></w:r>
  </w:p>
```
````

The body must contain well-formed XML with exactly one root element.
The transform rejects declarations, DTDs, entity declarations, multiple roots, and non-whitespace text outside the root.
Standard XML escapes such as `&amp;` are valid.
OOXML fences are block content.
The transform accepts any qualified names and namespaces. It rejects a `w:r` run as a block root.

## Resource resolution and writing

`writeDocx(root, output, options)` accepts a filesystem path or file URL and writes atomically.
It directly processes PNG, JPEG, GIF, BMP, and SVG image data URLs.
Resolve other image sources during output to keep bytes outside frozen MDAST:

```tsx
{onReady(({root}) => writeDocx(root, './report.docx', {
  async resolveResource(source, {kind, node}) {
    if (kind !== 'image') throw new Error(`Unsupported resource: ${source}`)
    const response = await fetch(new URL(source, import.meta.url))
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      type: 'png',
      width: node.data?.docx?.image?.transformation?.width ?? 640,
      height: node.data?.docx?.image?.transformation?.height ?? 360,
    }
  },
}))}
```

An SVG image can set `data.docx.image.fallback` to a PNG/JPEG data URL or resource source.
A resource resolver can instead return binary `fallback` output.
Otherwise, the writer uses Resvg without system fonts to create a fallback.
The resolver is an output-time service. It is separate from `root.data`.