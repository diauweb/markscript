import {expect, test} from 'bun:test'
import {mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {runFile} from '@markscript/markscript'
import {executeDocument} from '@markscript/runtime'
import JSZip from 'jszip'
import type {Root} from 'mdast'
import {
  Bibliography,
  Caption,
  Cite,
  DocxImage,
  hookDocx,
  Ref,
  resolveDocx,
  Span,
  Tab,
  Toc,
  transformCodeHighlight,
  transformEcharts,
  transformOoxml,
  transformSatori,
  withDocx,
  writeDocx,
} from '../src/index.ts'
import {rasterizedSvgImage} from '../src/media.ts'
import {clonePlain} from '../src/tree.ts'

test('DOCX helpers compose ordinary MDAST in phrasing context', () => {
  const paragraph = withDocx(
    {
      type: 'paragraph',
      data: {},
      children: [
        ...Span({run: {bold: true}, children: 'Logo '}),
        Tab(),
        DocxImage({
          src: 'data:image/png;base64,AA==',
          alt: 'Logo',
          image: {transformation: {width: 32, height: 16}},
        }),
      ],
    },
    {paragraph: {alignment: 'center'}},
  )

  expect(paragraph).toEqual({
    type: 'paragraph',
    children: [
      {type: 'text', value: 'Logo ', data: {docx: {run: {bold: true}}}},
      {type: 'text', value: '', data: {docx: {tab: true}}},
      {
        type: 'image',
        url: 'data:image/png;base64,AA==',
        alt: 'Logo',
        data: {
          docx: {image: {transformation: {width: 32, height: 16}}},
        },
      },
    ],
    data: {docx: {paragraph: {alignment: 'center'}}},
  })
})

test('hookDocx materializes ordinary directives through one catch-all hook', async () => {
  const namespace =
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const root = await executeDocument(() => {
    hookDocx({document: {creator: 'MarkScript test'}})
    return {
      type: 'root',
      children: [
        {
          type: 'leafDirective',
          name: 'docx-page-break',
          attributes: null,
          children: [{type: 'text', value: 'Page break'}],
        },
        {type: 'code', lang: 'ts', value: 'const ready = true'},
        fence('ooxml', `<w:p xmlns:w="${namespace}"/>`, {
          context: 'block',
        }),
      ],
    }
  })

  expect(root.data?.docx?.document?.creator).toBe('MarkScript test')
  expect(root.children[0]?.data?.docx?.pageBreak).toBe(true)
  expect(root.children[0]).toMatchObject({type: 'paragraph', children: []})
  expect(root.children[1]?.data?.docx?.code?.language).toBe('ts')
  expect(root.children[2]?.data?.docx?.rawXml).toMatchObject({
    context: 'block',
  })
})

test('literal Word directives resolve to readable standard MDAST and direct data', async () => {
  const unrelated = {
    type: 'leafDirective' as const,
    name: 'note',
    attributes: {tone: 'quiet'},
    children: [{type: 'text' as const, value: 'Keep me'}],
  }
  const before = structuredClone(unrelated)
  const root = {
    type: 'root',
    children: [
      unrelated,
      directive('docx-page-break', 'Page break'),
      directive('docx-section', 'Landscape section', {
        section: 'landscape',
        breakBefore: 'nextPage',
      }),
      {
        type: 'heading',
        depth: 1,
        children: [{type: 'text', value: 'Introduction'}],
      },
      directive('docx-toc', 'Contents', {
        headingStyleRange: '1-3',
        hyperlink: 'true',
      }),
      {
        type: 'paragraph',
        children: [
          textDirective('docx-field', '1', {kind: 'pageNumber'}),
          {type: 'text', value: ' of '},
          textDirective('docx-field', '10', {kind: 'pageCount'}),
          textDirective('docx-tab', '⇥'),
        ],
      },
    ],
  } as unknown as Root

  await resolveDocx(root, {
    sections: {
      landscape: {
        properties: {
          page: {size: {orientation: 'landscape'}},
          column: {count: 2, equalWidth: true},
        },
      },
    },
  })

  expect(unrelated).toEqual(before)
  expect(root.children[1]?.data?.docx?.pageBreak).toBe(true)
  expect(root.children[2]?.data?.docx?.section).toEqual({
    name: 'landscape',
    breakBefore: 'nextPage',
    properties: {
      page: {size: {orientation: 'landscape'}},
      column: {count: 2, equalWidth: true},
    },
  })
  expect(root.children[4]?.data?.docx?.toc).toMatchObject({
    headingStyleRange: '1-3',
    hyperlink: true,
    cachedHeadings: [
      {depth: 1, text: 'Introduction', target: 'docx-heading-1'},
    ],
  })
  const paragraph = root.children[5]
  expect(paragraph?.type).toBe('paragraph')
  if (paragraph?.type !== 'paragraph') throw new Error('expected paragraph')
  expect(paragraph.children[0]?.data?.docx?.field).toEqual({
    kind: 'pageNumber',
    cached: '1',
  })
  expect(paragraph.children[3]?.data?.docx?.tab).toBe(true)
  expect(JSON.parse(JSON.stringify(root))).toEqual(root)
})

test('captions, references, citations, and bibliography resolve to linked readable data', async () => {
  const caption = Caption({id: 'plot', children: 'Latency'})
  caption.data = {
    ...caption.data,
    docx: {...caption.data?.docx, bookmark: 'custom-plot'},
  }
  const root: Root = {
    type: 'root',
    children: [
      caption,
      {
        type: 'paragraph',
        children: [{type: 'text', value: 'See '}, Ref({target: 'plot'})],
      },
      {
        type: 'paragraph',
        children: [
          {type: 'text', value: 'Sources '},
          Cite({keys: ['alpha', 'beta'], source: 'main'}),
          {type: 'text', value: ' and '},
          textDirective('cite', 'gamma', {source: 'main'}),
        ],
      },
      Bibliography({source: 'main', includeUncited: true, headingDepth: 2}),
    ],
  }

  await resolveDocx(root, {
    bibliography: {
      sources: {
        main: [
          {id: 'alpha', author: 'A. Author', title: 'Alpha'},
          {id: 'beta', author: 'B. Author', title: 'Beta'},
          {id: 'gamma', author: 'G. Author', title: 'Gamma'},
        ],
      },
      defaultSource: 'main',
    },
  })

  expect(caption.data?.docx?.caption).toMatchObject({
    id: 'plot',
    number: 1,
    bookmark: 'custom-plot',
  })
  expect(caption.children[0]).toEqual({type: 'text', value: 'Figure 1 — '})
  const referenceParagraph = root.children[1]
  if (referenceParagraph?.type !== 'paragraph')
    throw new Error('expected paragraph')
  expect(referenceParagraph.children[1]?.data?.docx?.reference).toMatchObject({
    target: 'custom-plot',
    cached: 'Figure 1',
  })

  const citationParagraph = root.children[2]
  if (citationParagraph?.type !== 'paragraph')
    throw new Error('expected paragraph')
  const citation = citationParagraph.children.find(
    (node) => node.data?.docx?.citation?.keys[0] === 'alpha',
  )
  expect(citation?.data?.docx?.citation).toMatchObject({
    numbers: [1, 2],
    bookmarks: ['docx-bib-main-alpha', 'docx-bib-main-beta'],
    cached: '[1, 2]',
  })
  expect(
    citationParagraph.children
      .filter((child) => child.type === 'link')
      .map((child) => child.url)
      .slice(0, 2),
  ).toEqual(['#docx-bib-main-alpha', '#docx-bib-main-beta'])
  const quickCitation = citationParagraph.children.find(
    (node) => node.data?.docx?.citation?.keys[0] === 'gamma',
  )
  expect(quickCitation?.data?.docx).toMatchObject({
    run: {superScript: true},
    citation: {
      keys: ['gamma'],
      numbers: [3],
      bookmarks: ['docx-bib-main-gamma'],
      cached: '[3]',
    },
  })

  expect(root.children.slice(3).map((node) => node.type)).toEqual([
    'heading',
    'paragraph',
    'paragraph',
    'paragraph',
  ])
  expect(root.children[3]).toMatchObject({type: 'heading', depth: 2})
  expect(root.children[6]?.data?.docx?.bibliographyEntry).toMatchObject({
    key: 'gamma',
    number: 3,
  })
  expect(JSON.parse(JSON.stringify(root))).toEqual(root)

  const directory = await mkdtemp(join(tmpdir(), 'markscript-docx-semantic-'))
  const output = join(directory, 'citations.docx')
  try {
    await writeDocx(root, output)
    const zip = await JSZip.loadAsync(await readFile(output))
    const xml = await zip.file('word/document.xml')?.async('string')
    expect(xml).toContain('w:anchor="docx-bib-main-alpha"')
    expect(xml).toContain('w:anchor="docx-bib-main-beta"')
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('literal :cite syntax resolves through hookDocx', async () => {
  const directory = await mkdtemp(join(import.meta.dir, '.docx-cite-'))
  const filename = join(directory, 'citation.ms')
  try {
    await writeFile(
      filename,
      `import {hookDocx} from '@markscript/docx'

{hookDocx({
  bibliography: {
    sources: {
      main: [
        {id: 'alpha', title: 'Alpha'},
        {id: 'beta', title: 'Beta'},
      ],
    },
    defaultSource: 'main',
  },
})}

Sources: :cite{keys="alpha, beta" source=main}**citation**.
`,
    )
    const root = await runFile(filename)
    const paragraph = root.children[0]
    if (paragraph?.type !== 'paragraph') throw new Error('expected paragraph')
    const citation = paragraph.children.find((node) => node.type === 'strong')
    if (citation?.type !== 'strong') throw new Error('expected citation')
    expect(citation?.data?.docx).toMatchObject({
      run: {superScript: true},
      citation: {
        keys: ['alpha', 'beta'],
        numbers: [1, 2],
        bookmarks: ['docx-bib-main-alpha', 'docx-bib-main-beta'],
        cached: '[1, 2]',
      },
    })
    expect(
      citation.children
        .filter((child) => child.type === 'link')
        .map((child) => child.url),
    ).toEqual(['#docx-bib-main-alpha', '#docx-bib-main-beta'])
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('TOC cached headings honor Word ranges and include bibliography headings', async () => {
  const filteredToc = Toc({title: 'Contents', headingStyleRange: '2-9'})
  const fullToc = Toc({title: 'All contents', headingStyleRange: '1-9'})
  const root: Root = {
    type: 'root',
    children: [
      {
        type: 'heading',
        depth: 1,
        children: [{type: 'text', value: 'Report'}],
      },
      filteredToc,
      fullToc,
      Bibliography({source: 'main', includeUncited: true, headingDepth: 2}),
    ],
  }
  await resolveDocx(root, {
    bibliography: [{id: 'alpha', title: 'Alpha'}],
  })

  expect(filteredToc.data?.docx?.toc?.cachedHeadings).toEqual([
    {depth: 2, text: 'References', target: 'docx-heading-2'},
  ])
  expect(fullToc.data?.docx?.toc?.cachedHeadings).toEqual([
    {depth: 1, text: 'Report', target: 'docx-heading-1'},
    {depth: 2, text: 'References', target: 'docx-heading-2'},
  ])
  await expect(
    resolveDocx({
      type: 'root',
      children: [Toc({headingStyleRange: '3-1'})],
    }),
  ).rejects.toThrow('ranges must be ascending')
  await expect(
    resolveDocx({
      type: 'root',
      children: [Toc({headingStyleRange: '0-2'})],
    }),
  ).rejects.toThrow('must contain depths 1 through 9')
})

test('multi-key citations retain per-entry links when a custom formatter exists', async () => {
  const root: Root = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [Cite({keys: ['alpha', 'beta'], source: 'main'})],
      },
    ],
  }
  let calls = 0
  await resolveDocx(root, {
    bibliography: {
      sources: {
        main: [
          {id: 'alpha', title: 'Alpha'},
          {id: 'beta', title: 'Beta'},
        ],
      },
    },
    formatCitation: () => {
      calls += 1
      return 'Alpha and Beta'
    },
  })
  expect(calls).toBe(0)
  const paragraph = root.children[0]
  if (paragraph?.type !== 'paragraph') throw new Error('expected paragraph')
  expect(paragraph.children.map(stripData)).toEqual([
    {type: 'text', value: '['},
    {
      type: 'link',
      url: '#docx-bib-main-alpha',
      children: [{type: 'text', value: '1'}],
    },
    {type: 'text', value: ', '},
    {
      type: 'link',
      url: '#docx-bib-main-beta',
      children: [{type: 'text', value: '2'}],
    },
    {type: 'text', value: ']'},
  ])

  const single: Root = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [Cite({keys: 'alpha', source: 'main'})],
      },
    ],
  }
  await resolveDocx(single, {
    bibliography: [{id: 'alpha', title: 'Alpha'}],
    formatCitation: () => 'Author, Alpha',
  })
  const singleParagraph = single.children[0]
  if (singleParagraph?.type !== 'paragraph') {
    throw new Error('expected paragraph')
  }
  expect(singleParagraph.children.map(stripData)).toEqual([
    {
      type: 'link',
      url: '#docx-bib-main-alpha',
      children: [{type: 'text', value: 'Author, Alpha'}],
    },
  ])
})

function stripData(node: {data?: unknown}): Record<string, unknown> {
  const {data: _data, ...plain} = node
  return plain
}

test('dynamic attachments lower onto the exact paragraph, run, and image nodes', async () => {
  const directory = await mkdtemp(join(import.meta.dir, '.docx-annotation-'))
  const filename = join(directory, 'annotations.ms')
  try {
    await writeFile(
      filename,
      `import {attach} from '@markscript/markscript'

{attach('docx', {paragraph: {style: 'ReportBody', keepNext: true}})}

Annotated paragraph.

<p>Inline {attach('docx', {run: {bold: true, color: '175CD3'}})}<strong>term</strong> and {attach('docx', {image: {transformation: {width: 320, height: 180}}})}<img src="./plot.png" alt="Plot" /></p>
`,
    )
    const root = await runFile(filename)
    expect(root.children[0]?.data?.docx?.paragraph).toEqual({
      style: 'ReportBody',
      keepNext: true,
    })
    const inline = root.children[1]
    if (inline?.type !== 'paragraph') throw new Error('expected paragraph')
    const strong = inline.children.find((child) => child.type === 'strong')
    const image = inline.children.find((child) => child.type === 'image')
    expect(strong?.data?.docx?.run).toEqual({
      bold: true,
      color: '175CD3',
    })
    expect(image?.data?.docx?.image).toEqual({
      transformation: {width: 320, height: 180},
    })
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('::paragraph targets an explicit empty paragraph', async () => {
  const directory = await mkdtemp(join(import.meta.dir, '.docx-paragraph-'))
  const filename = join(directory, 'paragraph.ms')
  try {
    await writeFile(
      filename,
      `import {hookDocx} from '@markscript/docx'
import {attach} from '@markscript/markscript'

{hookDocx()}

{attach('docx', {paragraph: {style: 'Spacer', keepNext: true}})}

::paragraph

<p />
`,
    )
    const root = await runFile(filename)
    expect(root.children).toEqual([
      {
        type: 'paragraph',
        children: [],
        data: {docx: {paragraph: {style: 'Spacer', keepNext: true}}},
      },
    ])
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('explicit heading and code styles replace writer presentation defaults', async () => {
  const root: Root = {
    type: 'root',
    children: [
      {
        type: 'heading',
        depth: 2,
        children: [{type: 'text', value: 'Styled heading'}],
        data: {docx: {paragraph: {style: 'ThesisHeading'}}},
      },
      {
        type: 'heading',
        depth: 2,
        children: [{type: 'text', value: 'Default heading'}],
      },
      {
        type: 'paragraph',
        children: [
          {
            type: 'inlineCode',
            value: 'styledInline',
            data: {docx: {run: {style: 'ThesisCode'}}},
          },
        ],
      },
      {
        type: 'paragraph',
        children: [{type: 'inlineCode', value: 'defaultInline'}],
      },
      {
        type: 'code',
        value: 'styledBlock',
        data: {
          docx: {
            paragraph: {style: 'ThesisCodeBlock'},
            run: {style: 'ThesisCode'},
          },
        },
      },
      {
        type: 'code',
        value: 'paragraphStyledBlock',
        data: {docx: {paragraph: {style: 'ThesisCodeBlock'}}},
      },
      {type: 'code', value: 'defaultBlock'},
    ],
  }
  const directory = await mkdtemp(join(tmpdir(), 'markscript-docx-styles-'))
  const output = join(directory, 'styles.docx')
  try {
    await writeDocx(root, output)
    const zip = await JSZip.loadAsync(await readFile(output))
    const xml = await zip.file('word/document.xml')?.async('string')
    expect(xml).toBeDefined()
    if (xml === undefined) throw new Error('expected document.xml')

    const styledHeading = paragraphXml(xml, 'Styled heading')
    expect(styledHeading).toContain('w:pStyle w:val="ThesisHeading"')
    expect(styledHeading).not.toContain('w:pStyle w:val="Heading2"')
    const defaultHeading = paragraphXml(xml, 'Default heading')
    expect(defaultHeading).toContain('w:pStyle w:val="Heading2"')

    const styledInline = paragraphXml(xml, 'styledInline')
    expect(styledInline).toContain('w:rStyle w:val="ThesisCode"')
    expect(styledInline).not.toContain('Courier New')
    expect(styledInline).not.toContain('F3F4F6')
    const defaultInline = paragraphXml(xml, 'defaultInline')
    expect(defaultInline).toContain('Courier New')
    expect(defaultInline).toContain('F3F4F6')

    const styledBlock = paragraphXml(xml, 'styledBlock')
    expect(styledBlock).toContain('w:pStyle w:val="ThesisCodeBlock"')
    expect(styledBlock).toContain('w:rStyle w:val="ThesisCode"')
    expect(styledBlock).not.toContain('Courier New')
    expect(styledBlock).not.toContain('F3F4F6')
    expect(styledBlock).not.toContain('<w:noProof')
    expect(styledBlock).not.toContain('<w:spacing')
    const paragraphStyledBlock = paragraphXml(xml, 'paragraphStyledBlock')
    expect(paragraphStyledBlock).toContain('w:pStyle w:val="ThesisCodeBlock"')
    expect(paragraphStyledBlock).not.toContain('Courier New')
    expect(paragraphStyledBlock).not.toContain('F3F4F6')
    expect(paragraphStyledBlock).not.toContain('<w:noProof')
    const defaultBlock = paragraphXml(xml, 'defaultBlock')
    expect(defaultBlock).toContain('Courier New')
    expect(defaultBlock).toContain('F3F4F6')
    expect(defaultBlock).toContain('<w:noProof')
    expect(defaultBlock).toContain('<w:spacing w:after="0"')
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('highlighting skips unsupported and unlabeled code without mutation', async () => {
  const root: Root = {
    type: 'root',
    children: [
      {type: 'code', lang: 'not-a-real-language', value: 'opaque()'},
      {type: 'code', lang: null, value: 'plain'},
    ],
  }
  const before = structuredClone(root)
  await transformCodeHighlight(root)
  expect(root).toEqual(before)

  const supported: Root = {
    type: 'root',
    children: [{type: 'code', lang: 'ts', value: 'const answer = 42'}],
  }
  await transformCodeHighlight(supported)
  expect(supported.children[0]?.data?.docx?.code).toMatchObject({
    language: 'ts',
    theme: 'github-light',
  })
  expect(
    supported.children[0]?.data?.docx?.code?.lines[0]?.length,
  ).toBeGreaterThan(1)
})

test('consumer fences produce plain images and source-positioned diagnostics', async () => {
  const echartsRoot: Root = {
    type: 'root',
    children: [
      fence('echarts', '{ }', {
        width: 320,
        height: 180,
        alt: 'One bar',
        option: {
          xAxis: {type: 'category', data: ['A']},
          yAxis: {type: 'value'},
          series: [{type: 'bar', data: [1]}],
        },
      }),
    ],
  }
  await transformEcharts(echartsRoot)
  const chart = echartsRoot.children[0]
  expect(chart?.type).toBe('paragraph')
  if (chart?.type !== 'paragraph') throw new Error('expected chart paragraph')
  expect(chart.children[0]).toMatchObject({
    type: 'image',
    alt: 'One bar',
    data: {
      docx: {
        image: {type: 'svg', transformation: {width: 320, height: 180}},
      },
    },
  })
  const chartImage = chart.children[0]
  if (chartImage?.type !== 'image') throw new Error('expected chart image')
  const chartSvg = Buffer.from(
    chartImage.url.split(',')[1] ?? '',
    'base64',
  ).toString()
  expect(chartSvg).not.toContain('<style')
  expect(chartSvg).not.toContain(' class=')
  expect(chartSvg).not.toContain(' pointer-events=')

  const satoriRoot: Root = {
    type: 'root',
    children: [
      fence('satori', '<div />', {
        width: 100,
        height: 40,
        alt: 'Card',
      }),
    ],
  }
  await expect(transformSatori(satoriRoot)).rejects.toThrow(
    '$.children[0] (source 4:3): satori fence requires at least one explicit font',
  )
  const invalidFormat: Root = {
    type: 'root',
    children: [
      fence('satori', '<div />', {
        width: 100,
        height: 40,
        alt: 'Card',
        format: 'webp',
      }),
    ],
  }
  await expect(transformSatori(invalidFormat)).rejects.toThrow(
    '$.children[0] (source 4:3): satori fence format must be svg or png',
  )
  const invalidPixelRatio: Root = {
    type: 'root',
    children: [
      fence('satori', '<div />', {
        width: 100,
        height: 40,
        alt: 'Card',
        format: 'png',
        pixelRatio: 0,
      }),
    ],
  }
  await expect(transformSatori(invalidPixelRatio)).rejects.toThrow(
    '$.children[0] (source 4:3): satori fence pixelRatio must be a positive finite number',
  )
  const noMatch: Root = {
    type: 'root',
    children: [{type: 'paragraph', children: [{type: 'text', value: 'plain'}]}],
  }
  const noMatchBefore = structuredClone(noMatch)
  await transformSatori(noMatch)
  expect(noMatch).toEqual(noMatchBefore)
})

test('Satori raster output keeps logical size while increasing PNG density', () => {
  const root: Root = {type: 'root', children: []}
  const rendered = rasterizedSvgImage(
    root,
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"><rect width="10" height="5" fill="red"/></svg>',
    {width: 10, height: 5, alt: 'Raster card', pixelRatio: 3},
  )
  expect(rendered).toMatchObject({
    type: 'paragraph',
    children: [
      {
        type: 'image',
        alt: 'Raster card',
        data: {
          docx: {
            image: {type: 'png', transformation: {width: 10, height: 5}},
          },
        },
      },
    ],
  })
  if (rendered.type !== 'paragraph' || rendered.children[0]?.type !== 'image')
    throw new Error('expected raster image paragraph')
  const png = Buffer.from(
    rendered.children[0].url.split(',')[1] ?? '',
    'base64',
  )
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  )
  expect(png.readUInt32BE(16)).toBe(30)
  expect(png.readUInt32BE(20)).toBe(15)
}, 20_000)

test('OOXML enforces placement, one root, outer text, and known Word shape', async () => {
  const namespace =
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const valid: Root = {
    type: 'root',
    children: [
      fence('ooxml', `<w:p xmlns:w="${namespace}"/>`, {
        context: 'block',
      }),
      fence('ooxml', '<wps:wsp xmlns:wps="urn:any-valid-namespace"/>', {
        context: 'block',
      }),
    ],
  }
  await transformOoxml(valid)
  expect(valid.children[0]?.data?.docx?.rawXml).toMatchObject({
    context: 'block',
  })
  expect(valid.children[1]?.data?.docx?.rawXml).toMatchObject({
    context: 'block',
  })

  await expect(
    transformOoxml({
      type: 'root',
      children: [
        fence('ooxml', `<w:p xmlns:w="${namespace}"/>outside`, {
          context: 'block',
        }),
      ],
    }),
  ).rejects.toThrow('exactly one XML root and no outer text')

  await expect(
    transformOoxml({
      type: 'root',
      children: [
        fence('ooxml', `<w:r xmlns:w="${namespace}"/>`, {
          context: 'block',
        }),
      ],
    }),
  ).rejects.toThrow('w:r is inline OOXML')

  await expect(
    transformOoxml({
      type: 'root',
      children: [
        fence('ooxml', `<w:r xmlns:w="${namespace}"/>`, {
          context: 'inline',
        }),
      ],
    }),
  ).rejects.toThrow('ooxml fences are block content')
})

test('plain cloning permits shared values and rejects cycles and accessors', () => {
  const shared = {keepNext: true}
  const cloned = clonePlain({first: shared, second: shared, omitted: undefined})
  expect(cloned.first).toEqual({keepNext: true})
  expect(cloned.second).toEqual({keepNext: true})
  expect('omitted' in cloned).toBe(false)
  expect(cloned.first).not.toBe(cloned.second)

  const cycle: {self?: unknown} = {}
  cycle.self = cycle
  expect(() => clonePlain(cycle)).toThrow('contains a cycle')

  let invoked = false
  const accessor = Object.defineProperty({}, 'value', {
    enumerable: true,
    get() {
      invoked = true
      return 1
    },
  })
  expect(() => clonePlain(accessor)).toThrow('is an accessor property')
  expect(invoked).toBe(false)

  const sparse = Array(2) as Array<unknown>
  sparse[1] = undefined
  expect(clonePlain(sparse)).toEqual([null, null])
  const arrayAccessor: unknown[] = []
  Object.defineProperty(arrayAccessor, '0', {
    enumerable: true,
    get() {
      invoked = true
      return 1
    },
  })
  arrayAccessor.length = 1
  invoked = false
  expect(() => clonePlain(arrayAccessor)).toThrow('is an accessor property')
  expect(invoked).toBe(false)
})

test('natural docx.js option shapes materialize as JSON-safe data', async () => {
  const root: Root = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{type: 'text', value: 'Styled'}],
        data: {
          docx: {
            paragraph: {
              style: 'ReportBody',
              run: {font: 'Aptos', color: '222222'},
            },
          },
        },
      },
    ],
  }
  await resolveDocx(root, {
    document: {
      creator: 'MarkScript',
      features: {updateFields: true},
      styles: {
        paragraphStyles: [
          {
            id: 'ReportBody',
            name: 'Report body',
            basedOn: 'Normal',
            paragraph: {spacing: {after: 120}},
            run: {font: 'Aptos', size: 22},
          },
        ],
        characterStyles: [
          {id: 'Term', name: 'Term', run: {bold: true, color: '175CD3'}},
        ],
      },
      numbering: {
        config: [
          {
            reference: 'steps',
            levels: [{level: 0, text: '%1.', start: 1}],
          },
        ],
      },
    },
  })

  expect(root.data?.docx?.document).toMatchObject({
    creator: 'MarkScript',
    features: {updateFields: true},
    styles: {
      paragraphStyles: [{id: 'ReportBody'}],
      characterStyles: [{id: 'Term'}],
    },
  })
  expect(JSON.parse(JSON.stringify(root))).toEqual(root)
})

function directive(
  name: string,
  label: string,
  attributes: Record<string, string> | null = null,
) {
  return {
    type: 'leafDirective' as const,
    name,
    attributes,
    children: [{type: 'text' as const, value: label}],
  }
}

function textDirective(
  name: string,
  label: string,
  attributes: Record<string, string> | null = null,
) {
  return {
    type: 'textDirective' as const,
    name,
    attributes,
    children: [{type: 'text' as const, value: label}],
  }
}

function fence(
  name: string,
  value: string,
  attributes: Record<string, unknown>,
) {
  return {
    type: 'code' as const,
    lang: name,
    value,
    position: {
      start: {line: 4, column: 3, offset: 0},
      end: {line: 4, column: value.length + 3, offset: value.length},
    },
    data: {[name]: attributes},
  }
}

function paragraphXml(xml: string, text: string): string {
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gu) ?? []
  const paragraph = paragraphs.find((value) => value.includes(`>${text}<`))
  if (paragraph === undefined) {
    throw new Error(
      `Could not find paragraph containing ${JSON.stringify(text)}`,
    )
  }
  return paragraph
}

test.each([
  ['hyperlink', true],
  ['hyperlink={true}', true],
  ['hyperlink={false}', false],
  ['hyperlink="true"', true],
  ['hyperlink="false"', false],
] as const)(
  'resolves native DOCX boolean attribute %s',
  async (attribute, expected) => {
    const directory = await mkdtemp(join(tmpdir(), 'markscript-docx-boolean-'))
    try {
      await symlink(
        join(import.meta.dir, '../../../node_modules'),
        join(directory, 'node_modules'),
        'dir',
      )
      const filename = join(directory, 'boolean.ms')
      await writeFile(
        filename,
        `import {hookDocx} from '${new URL('../src/index.ts', import.meta.url).href}'\n\n{hookDocx()}\n\n::docx-toc{${attribute}}\n\n# Heading\n`,
      )
      const root = await runFile(filename, {check: false})
      expect(root.children[0]?.data?.docx?.toc?.hyperlink).toBe(expected)
      const output = join(directory, 'boolean.docx')
      await writeDocx(root, output)
      const zip = await JSZip.loadAsync(await readFile(output))
      const xml = await zip.file('word/document.xml')?.async('string')
      expect(xml).toContain('TOC')
      expect(xml?.includes('\\h')).toBe(expected)
    } finally {
      await rm(directory, {recursive: true, force: true})
    }
  },
)

test('applies stacked DOCX directives together and preserves explicit data', async () => {
  const root: Root = {
    type: 'root',
    children: [
      {type: 'paragraph', children: [{type: 'text', value: 'First section'}]},
      {
        type: 'paragraph',
        data: {
          'docx-page-break': {},
          'docx-section': {breakBefore: 'nextPage'},
          docx: {paragraph: {style: 'BodyText'}},
          custom: {keep: true},
        },
        children: [{type: 'text', value: 'Second section'}],
      },
      {
        type: 'paragraph',
        data: {
          'docx-section': {breakBefore: 'nextPage'},
          'docx-page-break': {},
          docx: {section: {breakBefore: 'continuous'}},
        },
        children: [{type: 'text', value: 'Third section'}],
      },
    ],
  }
  await resolveDocx(root)
  expect(root.children[1]?.data).toEqual({
    docx: {
      pageBreak: true,
      section: {breakBefore: 'nextPage'},
      paragraph: {style: 'BodyText'},
    },
    custom: {keep: true},
  })
  expect(root.children[2]?.data).toEqual({
    docx: {pageBreak: true, section: {breakBefore: 'continuous'}},
  })
  const directory = await mkdtemp(join(tmpdir(), 'markscript-docx-stacked-'))
  try {
    const output = join(directory, 'stacked.docx')
    await writeDocx(root, output)
    const zip = await JSZip.loadAsync(await readFile(output))
    const xml = await zip.file('word/document.xml')?.async('string')
    expect(xml).toContain('w:type="page"')
    expect(xml).toContain('w:val="nextPage"')
    expect(xml).toContain('w:val="continuous"')
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('processes attached DOCX directives on normalized directive nodes', async () => {
  const root: Root = {
    type: 'root',
    children: [
      {
        type: 'leafDirective',
        name: 'paragraph',
        attributes: {},
        data: {
          'docx-page-break': {},
          'docx-section': {breakBefore: 'nextPage'},
        },
        children: [],
      },
    ],
  }
  await resolveDocx(root)
  expect(root.children).toEqual([
    {
      type: 'paragraph',
      children: [],
      data: {docx: {pageBreak: true, section: {breakBefore: 'nextPage'}}},
    },
  ])
})

test('validates later stacked DOCX directives even when an earlier effect exists', async () => {
  const root: Root = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        data: {
          docx: {pageBreak: true},
          'docx-page-break': {},
          'docx-toc': {hyperlink: 1},
        },
        children: [],
      },
    ],
  }
  await expect(resolveDocx(root)).rejects.toThrow(
    'hyperlink must be true or false',
  )
})
