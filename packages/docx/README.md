# `@markscript/docx`

`@markscript/docx` turns a complete MarkScript MDAST document into a `.docx`
file. Its transform stage resolves Word semantics into ordinary, readable MDAST
and plain `data.docx` objects. `writeDocx` then consumes that finalized tree; it
does not render MarkScript or run transforms.

The published package bundles its patched `docx` engine, preserving character
indentation, line-based paragraph spacing, and custom paragraph/character
styles alongside external styles. The `docx` dependency supplies the public
option types.

## Complete document setup

Call `hookDocx` directly while the document renders. The hook registers one
whole-document `onTransform` callback. Call `writeDocx` from `onReady`, where
the document is complete, validated, and frozen.

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

The hook always invokes the direct transforms in this order:

1. `transformSatori(root, options.satori)`
2. `transformEcharts(root, options.echarts)`
3. `transformOoxml(root, options.ooxml)`
4. `transformCodeHighlight(root, options.code)`
5. `resolveDocx(root, options)`

There is no format switch, renderer registration, or backend selection in this
package. To use only selected behavior, register the exported root-first
transforms with the existing runtime API:

```tsx
import {onTransform} from '@markscript/markscript'
import {resolveDocx, transformCodeHighlight} from '@markscript/docx'

{onTransform(async ({root}) => {
  await transformCodeHighlight(root, {theme: 'github-light'})
  await resolveDocx(root, {document: {creator: 'MarkScript'}})
})}
```

## Word construct mapping

The following table is the direct mapping from Word concepts to MarkScript and
the finalized MDAST contract.

| Word construct | MarkScript form | Final MDAST data |
|---|---|---|
| Document metadata, styles, numbering, settings | `hookDocx({document: {...}})` | `root.data.docx.document` |
| Paragraph formatting | `{attach('docx', {paragraph: {...}})}` before an ordinary paragraph, or `withDocx(node, {...})` | `node.data.docx.paragraph` |
| Empty paragraph | an explicit `<p />` | ordinary paragraph with no children |
| Run formatting | `<Span run={{...}}>…</Span>` or `withDocx(node, {run: {...}})` | `node.data.docx.run` |
| Page break | `<PageBreak />` or `::docx-page-break` before its target block | ordinary empty paragraph or target node with `data.docx.pageBreak: true` |
| Section boundary | `<Section section="landscape" />` or `::docx-section{section=landscape}` before its target block | ordinary empty paragraph or target node with resolved `data.docx.section` |
| Page, count, date, sequence, reference, or custom field | `<Field kind="pageNumber">1</Field>` or `:docx-field{kind=pageNumber cached=1}` before phrasing content | ordinary text or target node with `data.docx.field` |
| Table of contents | `<Toc headingStyleRange="1-3" />` or `::docx-toc{headingStyleRange="1-3" hyperlink}` before its target block | ordinary paragraph or target node with `data.docx.toc` and cached headings |
| Tab | `<Tab />` or `:docx-tab` before phrasing content | zero-width text or target node with `data.docx.tab: true` |
| Normal or nonbreaking space | `<Space count={2} />`, `<Space nonBreaking />` | ordinary text containing spaces or `U+00A0` |
| Caption | `<Caption id="plot">Latency</Caption>` | ordinary paragraph with visible resolved number and `data.docx.caption` |
| Cross-reference | `<Ref target="plot" />` | ordinary link with resolved field fallback in `data.docx.reference` |
| Citation | `:cite{keys=alpha}` before citation text, or `<Cite keys={['alpha', 'beta']} source="main" />` | readable citation content containing ordinary internal links |
| Bibliography | `<Bibliography source="main" title="References" includeUncited />` | ordinary heading and bookmarked paragraphs |
| Table, row, and cell options | `docxTable(...)` or `withDocx` on normal GFM table nodes | `data.docx.table`, `.row`, and `.cell` |
| Image options | `<DocxImage ... image={{...}} />` or `withDocx(image, {image: {...}})` | normal MDAST image with `data.docx.image` |
| Highlighted fenced code | normal fenced code with a supported language | unchanged code node plus plain `data.docx.code.lines` tokens |
| Satori visual | a `satori` fenced code block | normal SVG or requested PNG image node |
| ECharts visual | an `echarts` fenced code block | normal SVG image node |
| Unsafe OOXML escape hatch | an `ooxml` fenced code block | HTML node with validated `data.docx.rawXml` |

All option values under `data.docx` use the corresponding `docx` package option
shape directly. There is no style registry or second inheritance model.
`docx.js` and Word resolve style inheritance.

Ordinary Markdown needs no Word wrapper. The writer maps standard nodes as
follows:

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

The `attach('docx', ...)` helper attaches Word options to the exact next
compatible MDAST node. Named DOCX directives handle their corresponding
string-valued source forms.

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

At root or block scope, place `attach('docx', ...)` immediately before the
Markdown block. Within a paragraph, place it immediately before the exact
phrasing node, link, or image it should annotate. Consecutive attachments
shallow-merge in the same namespace. Object-valued options remain natural
`docx.js` shapes; the library reads the resulting `node.data.docx` directly.

## Formatting ordinary MDAST

Use ordinary Markdown for paragraphs and bind Word formatting directly to the
next paragraph. Use `<p />` when the document intentionally needs a blank
paragraph.

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

`Span` applies one natural `IRunOptions`-shaped object to all of its
phrasing descendants. `docxTable` and `DocxImage` attach table, row, cell, and
image options without replacing their normal MDAST content. Programmatic MDAST
can use `withDocx(node, {paragraph: {...}})`. The `mm`, `cm`, `inch`, `pt`, and
`percent` helpers create the measure strings accepted by `docx.js`.

The public document type intentionally excludes SDK object fields such as
embedded font buffers, comment children, imported style components, and
section wrapper classes. Final `data.docx` is plain JSON-roundtrippable data.
External image bytes are likewise resolved only when writing.

## Sections, headers, and footers

Name reusable sections in the hook and place a readable section directive at
each boundary. A section object uses natural `docx.js` section property shapes;
headers and footers are standard MDAST roots.

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

`Section` starts the selected section. `SectionBreak` additionally sets
`breakBefore`, which defaults to `nextPage`. The literal directive accepts
`continuous`, `nextPage`, `evenPage`, or `oddPage`.

## Fields, captions, references, and bibliography

JSX helpers emit ordinary MDAST directly. Their source-directive counterparts
are zero-width attachers whose data is materialized on ordinary readable MDAST
content.

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

`resolveDocx` numbers captions and bibliography records in document order,
creates deterministic valid Word bookmark names, updates visible fallback
text, resolves references, and expands bibliography markers. Citations become
ordinary internal MDAST links to their bibliography entries. A custom
`formatCitation(records, numbers)` or
`formatBibliographyEntry(record, number)` may return a string or promise; only
its returned text enters the final tree. A custom `formatCitation` is accepted
for a one-key citation, where the complete custom text has one unambiguous
bibliography link. Multi-key citations use the built-in linked form such as
`[1, 2]` and do not call the formatter; split custom styling into adjacent
one-key citations.

`:cite{keys=key}` is the concise authored form. Separate multiple keys with
commas or semicolons; it applies the superscript run style used by numeric Word
citations to the following phrasing node. `:docx-citation` and `<Cite>` are the
neutral, non-superscript forms for custom presentation.

Bibliography sources can be supplied directly, as named sources, or with an
explicit default:

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

Each consumer selects an ordinary fenced code node by `lang`. A preceding
attachment supplies computed options through `data.satori`, `data.echarts`, or
`data.ooxml`; otherwise directive attributes supply string-valued options.

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

The `satori` transform requires explicit positive `width` and `height`,
non-empty `alt`, and at least one configured font. The fence body is compiled
as a self-contained TSX fragment with Satori's JSX factory.

Satori output is SVG by default. `format="png"` rasterizes the generated SVG;
`pixelRatio` controls its pixel density while the Word placement retains the
declared width and height. This is useful when a target Word version cannot
display SVG reliably.

The `echarts` transform requires the same dimensions and alt text plus an object-valued
`option`. It uses ECharts server-side SVG rendering. `echarts.fontFiles`
provides explicit fonts for a deterministic PNG fallback, including every text
glyph when a Word client cannot display SVG. Both transforms replace the fence
with a normal MDAST image whose source is an SVG data URL and whose
`data.docx.image` contains direct image options. The generated fallback is a
plain PNG data URL in `data.docx.image.fallback`.

The `ooxml` language is an explicit unsafe escape hatch:

````md
```ooxml
  <w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:r><w:t>Native Word content</w:t></w:r>
  </w:p>
```
````

The body must be well-formed XML with exactly one root element. Declarations,
DTDs, entity declarations, multiple roots, and non-whitespace outer text are
rejected. Normal XML escaping such as `&amp;` remains valid.
OOXML fences are block content. The transform accepts arbitrary qualified names
and namespaces while rejecting a `w:r` run as a block root.

## Resource resolution and writing

`writeDocx(root, output, options)` accepts a filesystem path or file URL and
writes atomically. Data URLs for PNG, JPEG, GIF, BMP, and SVG images are handled
directly. Resolve other image sources at write time so bytes never enter the
frozen MDAST:

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

An SVG image may set `data.docx.image.fallback` to a PNG/JPEG data URL or
resource source. A resource resolver may instead return binary `fallback`
output. Otherwise the writer uses Resvg without ambient system fonts to create
one. The resolver is an output-time service and is never stored in `root.data`.
