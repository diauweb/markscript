import {expect, test} from 'bun:test'
import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {ReadonlyRoot} from '@markscript/runtime'
import JSZip from 'jszip'
import {DocxWriterError, writeDocx} from '../src/writer.ts'

test('writes ordinary MDAST, GFM structures, options, and references without mutation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markscript-docx-writer-'))
  const output = join(directory, 'ordinary.docx')
  try {
    const root = {
      type: 'root',
      children: [
        {
          type: 'heading',
          depth: 1,
          children: [{type: 'text', value: 'A heading'}],
          data: {
            docx: {
              paragraph: {keepNext: true},
              bookmark: 'docx-heading-one',
            },
          },
        },
        {
          type: 'paragraph',
          children: [
            {type: 'text', value: 'Plain '},
            {
              type: 'strong',
              data: {docx: {run: {bold: false}}},
              children: [{type: 'text', value: 'explicitly not bold'}],
            },
            {type: 'text', value: ' and '},
            {
              type: 'emphasis',
              data: {docx: {run: {italics: false}}},
              children: [{type: 'text', value: 'explicitly not italic'}],
            },
            {type: 'text', value: '. '},
            {
              type: 'link',
              url: 'https://example.test/path',
              children: [{type: 'text', value: 'external link'}],
            },
            {type: 'text', value: ' note'},
            {type: 'footnoteReference', identifier: 'note'},
          ],
        },
        {
          type: 'paragraph',
          data: {
            docx: {
              caption: {
                id: 'figure',
                kind: 'figure',
                label: 'Figure',
                number: 1,
                bookmark: 'docx-caption-figure',
              },
            },
          },
          children: [{type: 'text', value: 'Figure 1 — Caption'}],
        },
        {
          type: 'list',
          ordered: true,
          start: 3,
          spread: false,
          children: [
            {
              type: 'listItem',
              spread: false,
              checked: null,
              children: [
                {
                  type: 'paragraph',
                  children: [{type: 'text', value: 'First item'}],
                },
              ],
            },
            {type: 'listItem', spread: false, checked: null, children: []},
            {
              type: 'listItem',
              spread: false,
              checked: true,
              children: [
                {
                  type: 'paragraph',
                  children: [{type: 'text', value: 'Third item'}],
                },
              ],
            },
          ],
        },
        {
          type: 'table',
          align: ['center', 'right'],
          data: {docx: {table: {style: 'TableGrid'}}},
          children: [
            {
              type: 'tableRow',
              data: {docx: {row: {cantSplit: true}}},
              children: [
                {
                  type: 'tableCell',
                  data: {docx: {cell: {shading: {fill: 'EEEEEE'}}}},
                  children: [{type: 'text', value: 'Head A'}],
                },
                {
                  type: 'tableCell',
                  children: [{type: 'text', value: 'Head B'}],
                },
              ],
            },
            {
              type: 'tableRow',
              children: [
                {
                  type: 'tableCell',
                  children: [{type: 'text', value: 'Cell A'}],
                },
                {
                  type: 'tableCell',
                  children: [{type: 'text', value: 'Cell B'}],
                },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          children: [
            {type: 'text', value: 'Citation '},
            {
              type: 'link',
              url: '#docx-bib-main-alpha',
              children: [{type: 'text', value: '[1]'}],
            },
          ],
        },
        {
          type: 'paragraph',
          data: {
            docx: {
              bibliographyEntry: {
                key: 'alpha',
                number: 1,
                bookmark: 'docx-bib-main-alpha',
              },
            },
          },
          children: [{type: 'text', value: '[1] Bibliography entry'}],
        },
        {
          type: 'definition',
          identifier: 'unused',
          label: 'unused',
          url: 'https://unused.test',
          title: null,
        },
        {
          type: 'footnoteDefinition',
          identifier: 'note',
          label: 'note',
          children: [
            {
              type: 'paragraph',
              children: [{type: 'text', value: 'Footnote body'}],
            },
          ],
        },
      ],
    }
    const before = JSON.stringify(root)
    deepFreeze(root)

    await writeDocx(root as unknown as ReadonlyRoot, output)

    expect(JSON.stringify(root)).toBe(before)
    const zip = await loadZip(output)
    const document = normalizeXml(await zipText(zip, 'word/document.xml'))
    const numbering = normalizeXml(await zipText(zip, 'word/numbering.xml'))
    const footnotes = normalizeXml(await zipText(zip, 'word/footnotes.xml'))
    const relationships = normalizeXml(
      await zipText(zip, 'word/_rels/document.xml.rels'),
    )

    expect(document).toContain('<w:pStyle w:val="Heading1"/>')
    expect(runContaining(document, 'explicitly not bold')).toContain(
      '<w:b w:val="false"/>',
    )
    expect(runContaining(document, 'explicitly not italic')).toContain(
      '<w:i w:val="false"/>',
    )
    expect(document).toContain('<w:footnoteReference w:id="1"/>')
    expect(document).toContain('<w:tblStyle w:val="TableGrid"/>')
    expect(document).toContain('<w:tblHeader/>')
    expect(document).toContain('<w:jc w:val="center"/>')
    expect(document).toContain(
      '<w:hyperlink w:history="1" w:anchor="docx-bib-main-alpha">',
    )
    expect(document).toContain('<w:bookmarkStart w:name="docx-bib-main-alpha"')
    const bookmarkStarts = bookmarkAttributes(document, 'bookmarkStart')
    const bookmarkEnds = bookmarkAttributes(document, 'bookmarkEnd')
    expect(bookmarkStarts.map(({name}) => name)).toEqual([
      'docx-heading-one',
      'docx-caption-figure',
      'docx-bib-main-alpha',
    ])
    expect(new Set(bookmarkStarts.map(({id}) => id)).size).toBe(3)
    expect(bookmarkEnds.map(({id}) => id).sort()).toEqual(
      bookmarkStarts.map(({id}) => id).sort(),
    )
    expect(
      document.slice(0, document.indexOf('First item')).match(/<w:numPr>/gu),
    ).toHaveLength(1)
    expect(numbering).toContain('<w:start w:val="3"/>')
    expect(footnotes).toContain('Footnote body')
    expect(relationships).toContain('Target="https://example.test/path"')
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('preserves character indentation, line spacing, and custom styles with external styles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markscript-docx-writer-'))
  const output = join(directory, 'patched-formatting.docx')
  try {
    await writeDocx(
      {
        type: 'root',
        data: {
          docx: {
            document: {
              externalStyles:
                '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="table" w:styleId="ExternalTable"><w:name w:val="External table"/></w:style></w:styles>',
              styles: {
                paragraphStyles: [
                  {id: 'CustomParagraph', name: 'Custom paragraph'},
                ],
                characterStyles: [{id: 'CustomRun', name: 'Custom run'}],
              },
            },
          },
        },
        children: [
          {
            type: 'paragraph',
            data: {
              docx: {
                paragraph: {
                  style: 'CustomParagraph',
                  indent: {leftChars: 100, rightChars: 200, hangingChars: 50},
                  spacing: {beforeLines: 100, afterLines: 200},
                },
              },
            },
            children: [
              {
                type: 'text',
                value: 'Formatting',
                data: {docx: {run: {style: 'CustomRun'}}},
              },
            ],
          },
        ],
      },
      output,
    )
    const zip = await loadZip(output)
    const document = await zipText(zip, 'word/document.xml')
    for (const attribute of [
      'w:leftChars="100"',
      'w:rightChars="200"',
      'w:hangingChars="50"',
      'w:beforeLines="100"',
      'w:afterLines="200"',
    ]) {
      expect(document).toContain(attribute)
    }
    const styles = await zipText(zip, 'word/styles.xml')
    for (const id of ['ExternalTable', 'CustomParagraph', 'CustomRun']) {
      expect(styles).toContain(`w:styleId="${id}"`)
    }
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('keeps mixed nested list numbering kinds and starts independent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markscript-docx-writer-'))
  const output = join(directory, 'mixed-nested-lists.docx')
  try {
    const root = {
      type: 'root',
      children: [
        {
          type: 'list',
          ordered: false,
          start: null,
          spread: false,
          children: [
            {
              type: 'listItem',
              spread: false,
              checked: null,
              children: [
                paragraphWithText('First parent'),
                {
                  type: 'list',
                  ordered: true,
                  start: 3,
                  spread: false,
                  children: [listItemWithText('Ordered child')],
                },
              ],
            },
            {
              type: 'listItem',
              spread: false,
              checked: null,
              children: [
                paragraphWithText('Second parent'),
                {
                  type: 'list',
                  ordered: false,
                  start: null,
                  spread: false,
                  children: [listItemWithText('Bullet child')],
                },
              ],
            },
          ],
        },
      ],
    }

    await writeDocx(deepFreeze(root) as unknown as ReadonlyRoot, output)

    const zip = await loadZip(output)
    const document = normalizeXml(await zipText(zip, 'word/document.xml'))
    const numbering = normalizeXml(await zipText(zip, 'word/numbering.xml'))
    const firstParent = paragraphNumbering(document, 'First parent')
    const secondParent = paragraphNumbering(document, 'Second parent')
    const orderedChild = paragraphNumbering(document, 'Ordered child')
    const bulletChild = paragraphNumbering(document, 'Bullet child')

    expect(firstParent).toEqual(secondParent)
    expect(firstParent.level).toBe(0)
    expect(orderedChild.level).toBe(1)
    expect(bulletChild.level).toBe(1)
    expect(orderedChild.numId).not.toBe(bulletChild.numId)
    expect(numberingLevel(numbering, orderedChild)).toEqual({
      format: 'decimal',
      start: 3,
    })
    expect(numberingLevel(numbering, bulletChild)).toEqual({
      format: 'bullet',
      start: 1,
    })
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('writes fields, TOC, validated OOXML, and section parts from readable markers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markscript-docx-writer-'))
  const output = join(directory, 'features.docx')
  const wordNamespace =
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  try {
    const root = {
      type: 'root',
      data: {
        docx: {
          document: {creator: 'writer test'},
          defaultSection: {
            headers: {
              default: rootWithText('Default header'),
            },
          },
        },
      },
      children: [
        {
          type: 'heading',
          depth: 1,
          data: {docx: {bookmark: 'docx-heading-1'}},
          children: [{type: 'text', value: 'A cached heading'}],
        },
        {
          type: 'paragraph',
          children: [
            {type: 'text', value: 'Page '},
            {
              type: 'textDirective',
              name: 'docx-field',
              attributes: null,
              data: {
                docx: {
                  field: {kind: 'pageNumber', cached: '7'},
                },
              },
              children: [{type: 'text', value: '7'}],
            },
          ],
        },
        {
          type: 'html',
          value: '<w:p>readable block</w:p>',
          data: {
            docx: {
              rawXml: {
                context: 'block',
                xml: `<w:p xmlns:w="${wordNamespace}"><w:r><w:t>RAW BLOCK</w:t></w:r></w:p>`,
              },
            },
          },
        },
        {
          type: 'paragraph',
          children: [
            {type: 'text', value: 'Before '},
            {
              type: 'html',
              value: '<w:r>readable inline</w:r>',
              data: {
                docx: {
                  rawXml: {
                    context: 'inline',
                    xml: `<w:r xmlns:w="${wordNamespace}"><w:t>RAW INLINE</w:t></w:r>`,
                  },
                },
              },
            },
          ],
        },
        {
          type: 'leafDirective',
          name: 'docx-toc',
          attributes: null,
          data: {
            docx: {
              toc: {
                headingStyleRange: '1-2',
                hyperlink: true,
                cachedHeadings: [
                  {
                    depth: 1,
                    text: 'A cached heading',
                    target: 'docx-heading-1',
                  },
                ],
              },
            },
          },
          children: [{type: 'text', value: 'Contents'}],
        },
        {
          type: 'leafDirective',
          name: 'docx-page-break',
          attributes: null,
          data: {docx: {pageBreak: true}},
          children: [{type: 'text', value: 'Page break marker'}],
        },
        {
          type: 'paragraph',
          data: {
            docx: {
              section: {
                breakBefore: 'oddPage',
                headers: {default: rootWithText('Second header')},
              },
            },
          },
          children: [{type: 'text', value: 'Preserved section content'}],
        },
        {
          type: 'containerDirective',
          name: 'docx-section',
          attributes: null,
          data: {
            docx: {
              section: {
                breakBefore: 'nextPage',
                footers: {default: rootWithText('Third footer')},
              },
            },
          },
          children: [
            {
              type: 'paragraph',
              children: [{type: 'text', value: 'Container section content'}],
            },
          ],
        },
      ],
    }

    await writeDocx(deepFreeze(root) as unknown as ReadonlyRoot, output)

    const zip = await loadZip(output)
    const document = normalizeXml(await zipText(zip, 'word/document.xml'))
    const settings = normalizeXml(await zipText(zip, 'word/settings.xml'))
    const core = normalizeXml(await zipText(zip, 'docProps/core.xml'))
    const wordFiles = Object.keys(zip.files)

    expect(document).toContain('w:instr="PAGE"')
    expect(document).toContain('RAW BLOCK')
    expect(document).toContain('RAW INLINE')
    expect(document).toContain('TOC \\h \\o &quot;1-2&quot;')
    expect(document).toContain('<w:pStyle w:val="TOC1"/>')
    expect(document).toContain(
      '<w:hyperlink w:history="1" w:anchor="docx-heading-1">',
    )
    expect(document).not.toContain('<undefined>')
    expect(document).toContain('<w:br w:type="page"/>')
    expect(document).toContain('Preserved section content')
    expect(document).toContain('Container section content')
    expect(document).not.toContain('Page break marker')
    expect(document.match(/<w:sectPr(?: |>|\/)/gu)).toHaveLength(3)
    expect(document).toContain('<w:type w:val="oddPage"/>')
    expect(settings).toContain('<w:updateFields/>')
    expect(core).toContain('writer test')
    expect(wordFiles.some((path) => /^word\/header\d+\.xml$/u.test(path))).toBe(
      true,
    )
    expect(wordFiles.some((path) => /^word\/footer\d+\.xml$/u.test(path))).toBe(
      true,
    )
    const partText = await Promise.all(
      wordFiles
        .filter((path) => /^word\/(?:header|footer)\d+\.xml$/u.test(path))
        .map((path) => zipText(zip, path)),
    )
    expect(partText.join('\n')).toContain('Default header')
    expect(partText.join('\n')).toContain('Second header')
    expect(partText.join('\n')).toContain('Third footer')
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('writes each section break type on the preceding section boundary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markscript-docx-sections-'))
  const output = join(directory, 'sections.docx')
  try {
    const root = {
      type: 'root',
      data: {
        docx: {
          defaultSection: {properties: {page: {margin: {top: 720}}}},
        },
      },
      children: [
        paragraphWithText('First section'),
        sectionMarker('oddPage'),
        paragraphWithText('Second section'),
        sectionMarker('continuous'),
        paragraphWithText('Third section'),
        sectionMarker('evenPage'),
        paragraphWithText('Final section'),
      ],
    }

    await writeDocx(deepFreeze(root) as unknown as ReadonlyRoot, output)

    const zip = await loadZip(output)
    const document = normalizeXml(await zipText(zip, 'word/document.xml'))
    const sectionProperties =
      document.match(/<w:sectPr(?:\s[^>]*)?>[\s\S]*?<\/w:sectPr>/gu) ?? []
    expect(sectionProperties).toHaveLength(4)
    expect(
      sectionProperties.map(
        (section) => /<w:type w:val="([^"]+)"\/>/u.exec(section)?.[1] ?? null,
      ),
    ).toEqual(['oddPage', 'continuous', 'evenPage', null])
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('uses the resource service and replaces output atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markscript-docx-writer-'))
  const output = join(directory, 'image.docx')
  try {
    await writeFile(output, 'previous contents')
    const imageNode = {
      type: 'image',
      url: 'asset:pixel',
      alt: 'A pixel',
      title: null,
      data: {docx: {image: {transformation: {width: 40}}}},
    }
    const inlinePixel = {
      type: 'image',
      url: `data:image/png;base64,${Buffer.from(pngPixel()).toString('base64')}`,
      alt: 'An inline pixel',
      title: null,
    }
    const root = {
      type: 'root',
      children: [{type: 'paragraph', children: [imageNode, inlinePixel]}],
    }
    let receivedNode: unknown
    let resolverCalls = 0

    await writeDocx(deepFreeze(root) as unknown as ReadonlyRoot, output, {
      resolveResource(source, context) {
        resolverCalls += 1
        expect(source).toBe('asset:pixel')
        expect(context.kind).toBe('image')
        receivedNode = context.node
        return {
          data: pngPixel(),
          type: 'png',
          width: 2,
          height: 1,
        }
      },
    })

    expect(receivedNode).toBe(imageNode)
    expect(resolverCalls).toBe(1)
    const successful = await readFile(output)
    const zip = await JSZip.loadAsync(successful)
    const document = normalizeXml(await zipText(zip, 'word/document.xml'))
    expect(document).toContain('<wp:extent cx="381000" cy="190500"/>')
    expect(
      Object.keys(zip.files).some((path) => /^word\/media\//u.test(path)),
    ).toBe(true)

    const brokenRoot = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'image',
              url: 'asset:missing',
              alt: '',
              title: null,
            },
          ],
        },
      ],
    }
    const error = await writeDocx(
      brokenRoot as unknown as ReadonlyRoot,
      output,
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DocxWriterError)
    expect((error as DocxWriterError).code).toBe('DOCX_RESOURCE_SERVICE')
    expect(await readFile(output)).toEqual(successful)
    expect(
      (await readdir(directory)).filter((name) => name.endsWith('.tmp')),
    ).toEqual([])
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('decodes data URL images and embeds a raster fallback for SVG', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markscript-docx-writer-'))
  const output = join(directory, 'svg.docx')
  try {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#336699"/></svg>'
    const fallback = pngPixel()
    const root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'image',
              url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
              alt: 'Blue rectangle',
              title: null,
              data: {
                docx: {
                  image: {
                    fallback: `data:image/png;base64,${Buffer.from(fallback).toString('base64')}`,
                  },
                },
              },
            },
          ],
        },
      ],
    }

    await writeDocx(root as unknown as ReadonlyRoot, output)

    const zip = await loadZip(output)
    const document = normalizeXml(await zipText(zip, 'word/document.xml'))
    const media = Object.keys(zip.files).filter((path) =>
      /^word\/media\//u.test(path),
    )
    expect(document).toContain('<wp:extent cx="190500" cy="95250"/>')
    expect(media.some((path) => path.endsWith('.svg'))).toBe(true)
    const pngPath = media.find((path) => path.endsWith('.png'))
    expect(pngPath).toBeDefined()
    expect(await zip.file(pngPath ?? '')?.async('uint8array')).toEqual(fallback)
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('keeps writer state isolated across concurrent documents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markscript-docx-writer-'))
  const fieldOutput = join(directory, 'field.docx')
  const plainOutput = join(directory, 'plain.docx')
  try {
    const fieldRoot = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'textDirective',
              name: 'docx-field',
              attributes: null,
              data: {docx: {field: {kind: 'pageCount', cached: '2'}}},
              children: [{type: 'text', value: '2'}],
            },
          ],
        },
      ],
    }
    const plainRoot = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{type: 'text', value: 'Independent document'}],
        },
      ],
    }

    await Promise.all([
      writeDocx(fieldRoot as unknown as ReadonlyRoot, fieldOutput),
      writeDocx(plainRoot as unknown as ReadonlyRoot, plainOutput),
    ])

    const [fieldZip, plainZip] = await Promise.all([
      loadZip(fieldOutput),
      loadZip(plainOutput),
    ])
    const [fieldSettings, plainSettings, plainDocument] = await Promise.all([
      zipText(fieldZip, 'word/settings.xml'),
      zipText(plainZip, 'word/settings.xml'),
      zipText(plainZip, 'word/document.xml'),
    ])
    expect(fieldSettings).toContain('<w:updateFields/>')
    expect(plainSettings).not.toContain('<w:updateFields')
    expect(plainDocument).toContain('Independent document')
    expect(plainDocument).not.toContain('NUMPAGES')
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

async function loadZip(path: string): Promise<JSZip> {
  return JSZip.loadAsync(await readFile(path))
}

async function zipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (file === null) throw new Error(`DOCX part ${path} is missing`)
  return file.async('string')
}

function normalizeXml(value: string): string {
  return value.replace(/>\s+</gu, '><').trim()
}

function runContaining(document: string, text: string): string {
  const textIndex = document.indexOf(text)
  const start = document.lastIndexOf('<w:r>', textIndex)
  const end = document.indexOf('</w:r>', textIndex)
  if (textIndex < 0 || start < 0 || end < 0) {
    throw new Error(`Could not find a run containing ${JSON.stringify(text)}`)
  }
  return document.slice(start, end + '</w:r>'.length)
}

function bookmarkAttributes(
  document: string,
  element: 'bookmarkStart' | 'bookmarkEnd',
): {id: string; name?: string}[] {
  const pattern = new RegExp(`<w:${element}\\b([^>]*)\\/>`, 'gu')
  return [...document.matchAll(pattern)].map((match) => {
    const attributes = match[1] ?? ''
    const id = /\bw:id="([^"]+)"/u.exec(attributes)?.[1]
    const name = /\bw:name="([^"]+)"/u.exec(attributes)?.[1]
    if (id === undefined) throw new Error(`${element} has no w:id`)
    return {id, ...(name === undefined ? {} : {name})}
  })
}

function paragraphNumbering(
  document: string,
  text: string,
): {numId: string; level: number} {
  const paragraph = [...document.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gu)]
    .map((match) => match[0])
    .find((value) => value.includes(text))
  if (paragraph === undefined) {
    throw new Error(
      `Could not find a paragraph containing ${JSON.stringify(text)}`,
    )
  }
  const numId = /<w:numId w:val="([^"]+)"\/>/u.exec(paragraph)?.[1]
  const level = /<w:ilvl w:val="(\d+)"\/>/u.exec(paragraph)?.[1]
  if (numId === undefined || level === undefined) {
    throw new Error(`Paragraph ${JSON.stringify(text)} has no numbering`)
  }
  return {numId, level: Number(level)}
}

function numberingLevel(
  numbering: string,
  paragraph: {numId: string; level: number},
): {format: string; start: number} {
  const concrete = new RegExp(
    `<w:num w:numId="${paragraph.numId}"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/w:num>`,
    'u',
  ).exec(numbering)?.[1]
  const abstractId =
    concrete === undefined
      ? undefined
      : /<w:abstractNumId w:val="([^"]+)"\/>/u.exec(concrete)?.[1]
  const abstract =
    abstractId === undefined
      ? undefined
      : new RegExp(
          `<w:abstractNum w:abstractNumId="${abstractId}"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/w:abstractNum>`,
          'u',
        ).exec(numbering)?.[1]
  const level =
    abstract === undefined
      ? undefined
      : new RegExp(
          `<w:lvl w:ilvl="${paragraph.level}"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/w:lvl>`,
          'u',
        ).exec(abstract)?.[1]
  const format =
    level === undefined
      ? undefined
      : /<w:numFmt w:val="([^"]+)"\/>/u.exec(level)?.[1]
  const start =
    level === undefined
      ? undefined
      : /<w:start w:val="(\d+)"\/>/u.exec(level)?.[1]
  if (format === undefined || start === undefined) {
    throw new Error(
      `Could not resolve numbering ${paragraph.numId} level ${paragraph.level}`,
    )
  }
  return {format, start: Number(start)}
}

function paragraphWithText(value: string): object {
  return {type: 'paragraph', children: [{type: 'text', value}]}
}

function sectionMarker(
  breakBefore: 'continuous' | 'evenPage' | 'oddPage',
): object {
  return {
    type: 'leafDirective',
    name: 'docx-section',
    attributes: null,
    data: {docx: {section: {breakBefore}}},
    children: [{type: 'text', value: `${breakBefore} section`}],
  }
}

function listItemWithText(value: string): object {
  return {
    type: 'listItem',
    spread: false,
    checked: null,
    children: [paragraphWithText(value)],
  }
}

function rootWithText(value: string): object {
  return {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{type: 'text', value}],
      },
    ],
  }
}

function pngPixel(): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  )
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}
