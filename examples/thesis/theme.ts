import {
  type DocxDocumentData,
  type DocxParagraphData,
  type DocxSectionData,
  docxPart,
  Field,
  Tab,
  withDocx,
} from '@markscript/docx'
import type {Nodes, Parent, PhrasingContent, Root, RootContent} from 'mdast'

const song = {
  ascii: 'Times New Roman',
  eastAsia: '宋体',
  hAnsi: 'Times New Roman',
  cs: 'Times New Roman',
} as const
const hei = {
  ascii: '黑体',
  eastAsia: '黑体',
  hAnsi: '黑体',
  cs: '黑体',
} as const
const fangSong = {
  ascii: '仿宋',
  eastAsia: '仿宋',
  hAnsi: '仿宋',
  cs: '仿宋',
} as const
const times = {
  ascii: 'Times New Roman',
  eastAsia: 'Times New Roman',
  hAnsi: 'Times New Roman',
  cs: 'Times New Roman',
} as const
const codeFont = {
  ascii: 'Times New Roman',
  eastAsia: 'Times New Roman',
  hAnsi: 'Times New Roman',
} as const
const autoLine = 'auto' as const

const tocBase = {
  basedOn: 'body-base',
  next: 'body-base',
  uiPriority: 39,
  quickFormat: true,
} as const

const externalStyles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="table" w:customStyle="1" w:styleId="TableNormal">
    <w:name w:val="Table Normal"/><w:semiHidden/><w:unhideWhenUsed/><w:qFormat/>
    <w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>
  </w:style>
  <w:style w:type="table" w:customStyle="1" w:styleId="ThreeLineTable">
    <w:name w:val="Three Line Table"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="59"/><w:unhideWhenUsed/><w:qFormat/>
    <w:tblPr>
      <w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>
      <w:tblBorders><w:top w:val="single" w:sz="12" w:space="0" w:color="000000"/><w:left w:val="nil"/><w:bottom w:val="single" w:sz="12" w:space="0" w:color="000000"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>
    </w:tblPr>
    <w:tblStylePr w:type="firstRow"><w:tcPr><w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="000000"/></w:tcBorders></w:tcPr></w:tblStylePr>
  </w:style>
</w:styles>`

export const thesisDocument = {
  externalStyles,
  features: {updateFields: true},
  styles: {
    paragraphStyles: [
      {
        id: 'body-base',
        name: 'Body Base',
        paragraph: {
          spacing: {before: 0, after: 0, line: 324, lineRule: autoLine},
          indent: {firstLine: 0},
          alignment: 'both',
        },
        run: {font: song, size: 24},
      },
      {
        id: 'body-paragraph',
        name: 'Body Paragraph',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {indent: {firstLine: 480}},
      },
      {
        id: 'chapter-heading',
        name: 'Chapter Heading',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {
          keepNext: true,
          keepLines: true,
          pageBreakBefore: true,
          spacing: {
            beforeLines: 150,
            afterLines: 150,
            line: 360,
            lineRule: autoLine,
          },
          indent: {firstLine: 0},
          alignment: 'center',
          outlineLevel: 0,
        },
        run: {font: hei, size: 32},
      },
      {
        id: 'front-heading',
        name: 'Front Matter Heading',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {
          keepNext: true,
          keepLines: true,
          spacing: {
            beforeLines: 150,
            afterLines: 150,
            line: 360,
            lineRule: autoLine,
          },
          indent: {firstLine: 0},
          alignment: 'center',
        },
        run: {font: hei, size: 32},
      },
      {
        id: 'section-heading',
        name: 'Section Heading',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {
          keepNext: true,
          keepLines: true,
          spacing: {
            beforeLines: 100,
            afterLines: 100,
            line: 360,
            lineRule: autoLine,
          },
          indent: {firstLine: 0},
          alignment: 'left',
          outlineLevel: 1,
        },
        run: {font: hei, size: 28},
      },
      {
        id: 'subsection-heading',
        name: 'Subsection Heading',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {
          keepNext: true,
          keepLines: true,
          spacing: {
            beforeLines: 50,
            afterLines: 50,
            line: 360,
            lineRule: autoLine,
          },
          indent: {firstLine: 0},
          alignment: 'left',
          outlineLevel: 2,
        },
        run: {font: hei, size: 24},
      },
      {
        id: 'abstract-body-zh',
        name: 'Abstract Body ZH',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {
          spacing: {before: 0, after: 0, line: 360, lineRule: autoLine},
          indent: {firstLine: 480},
          alignment: 'both',
        },
        run: {font: song, size: 24},
      },
      {
        id: 'abstract-body-en',
        name: 'Abstract Body EN',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {
          spacing: {before: 0, after: 0, line: 360, lineRule: autoLine},
          indent: {firstLine: 480},
          alignment: 'both',
        },
        run: {font: times, size: 24},
      },
      {
        id: 'keyword-paragraph',
        name: 'Keyword Paragraph',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {
          spacing: {before: 240, after: 0, line: 360, lineRule: autoLine},
          indent: {firstLine: 0},
          alignment: 'left',
        },
        run: {font: song, size: 24},
      },
      {
        id: 'code-block',
        name: 'Code Block',
        basedOn: 'body-base',
        paragraph: {alignment: 'left'},
        run: {font: codeFont, size: 24},
      },
      {
        id: 'figure-caption',
        name: 'Figure Caption',
        basedOn: 'body-base',
        paragraph: {
          spacing: {before: 0, after: 0, line: 360, lineRule: autoLine},
          indent: {firstLine: 0},
          alignment: 'center',
        },
        run: {font: song, size: 21},
      },
      {
        id: 'table-caption',
        name: 'Table Caption',
        basedOn: 'figure-caption',
        paragraph: {
          spacing: {before: 0, after: 0, line: 360, lineRule: autoLine},
          indent: {firstLine: 0},
          alignment: 'center',
        },
        run: {font: song, size: 21},
      },
      {
        id: 'table-cell',
        name: 'Table Cell',
        basedOn: 'body-base',
        paragraph: {
          spacing: {before: 0, after: 0, line: 240, lineRule: autoLine},
          indent: {firstLine: 0},
          alignment: 'center',
        },
        run: {font: song, size: 21},
      },
      {
        id: 'TOC1',
        name: 'toc 1',
        ...tocBase,
        paragraph: {
          spacing: {before: 120, after: 120, line: 360, lineRule: autoLine},
          indent: {leftChars: 0, firstLineChars: 0},
          alignment: 'left',
        },
        run: {
          font: hei,
          boldComplexScript: true,
          kern: 2,
          size: 24,
          sizeComplexScript: 20,
        },
      },
      {
        id: 'TOC2',
        name: 'toc 2',
        ...tocBase,
        paragraph: {
          spacing: {line: 360, lineRule: autoLine},
          indent: {leftChars: 200, firstLineChars: 0},
          alignment: 'left',
        },
        run: {font: song, kern: 2, size: 24, sizeComplexScript: 20},
      },
      {
        id: 'TOC3',
        name: 'toc 3',
        ...tocBase,
        paragraph: {
          spacing: {line: 360, lineRule: autoLine},
          indent: {leftChars: 400, firstLineChars: 0},
          alignment: 'left',
        },
        run: {
          font: song,
          italicsComplexScript: true,
          kern: 2,
          size: 24,
          sizeComplexScript: 20,
        },
      },
      {
        id: 'bibliography-entry',
        name: 'Bibliography Entry',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {
          spacing: {before: 0, after: 0, line: 324, lineRule: autoLine},
          indent: {firstLine: 0},
          alignment: 'left',
        },
        run: {font: song, color: '000000', size: 21},
      },
      {
        id: 'page-header',
        name: 'Page Header',
        basedOn: 'body-base',
        paragraph: {
          spacing: {before: 0, after: 0, line: 240, lineRule: autoLine},
          border: {
            bottom: {color: '000000', space: 1, style: 'single', size: 6},
          },
          indent: {firstLine: 0},
          alignment: 'center',
        },
        run: {font: song, size: 21},
      },
      {
        id: 'page-number',
        name: 'Page Number',
        basedOn: 'body-base',
        paragraph: {
          alignment: 'center',
          border: {
            top: {color: 'auto', size: 0, space: 0, style: 'nil'},
            bottom: {color: 'auto', size: 0, space: 0, style: 'nil'},
          },
          indent: {firstLine: 0},
        },
        run: {font: song, size: 21},
      },
      {
        id: 'cover-title',
        name: 'Cover Title',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {
          alignment: 'center',
          spacing: {after: 240, line: 240},
          indent: {firstLine: 0},
        },
        run: {font: hei, kern: 2, size: 72},
      },
      {
        id: 'cover-thesis',
        name: 'Cover Thesis',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {
          alignment: 'left',
          spacing: {line: 240},
          indent: {firstLine: 522},
        },
        run: {bold: true, font: hei, kern: 2, size: 52},
      },
      {
        id: 'cover-info',
        name: 'Cover Info',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {
          spacing: {before: 240, after: 0, line: 240, lineRule: autoLine},
        },
        run: {font: fangSong, kern: 2, size: 32},
      },
      {
        id: 'cover-date',
        name: 'Cover Date',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {
          alignment: 'center',
          spacing: {line: 240},
          indent: {firstLine: 0},
        },
        run: {font: song, kern: 2, size: 32},
      },
      {
        id: 'declaration-heading',
        name: 'Declaration Heading',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {
          keepNext: true,
          keepLines: true,
          spacing: {
            beforeLines: 150,
            afterLines: 150,
            line: 360,
            lineRule: autoLine,
          },
          indent: {firstLine: 0},
          alignment: 'center',
        },
        run: {font: hei, size: 30},
      },
      {
        id: 'declaration-body',
        name: 'Declaration Body',
        basedOn: 'body-base',
        next: 'declaration-body',
        paragraph: {
          spacing: {before: 0, after: 0, line: 360, lineRule: autoLine},
        },
      },
      {
        id: 'abstract-heading-zh',
        name: 'Abstract Heading ZH',
        basedOn: 'front-heading',
        next: 'body-base',
      },
      {
        id: 'abstract-heading-en',
        name: 'Abstract Heading EN',
        basedOn: 'body-base',
        next: 'body-base',
        paragraph: {
          alignment: 'center',
          spacing: {
            beforeLines: 150,
            afterLines: 150,
            line: 360,
            lineRule: autoLine,
          },
          indent: {firstLine: 0},
        },
        run: {
          font: {
            ascii: 'Arial',
            eastAsia: 'Arial',
            hAnsi: 'Arial',
            cs: 'Arial',
          },
          size: 30,
        },
      },
    ],
    characterStyles: [
      {
        id: 'cover-thesis-run',
        name: 'Cover Thesis Run',
        run: {
          bold: true,
          font: hei,
          kern: 2,
          size: 52,
          underline: {type: 'single'},
        },
      },
      {
        id: 'cover-info-fill',
        name: 'Cover Info Fill',
        run: {
          font: fangSong,
          kern: 2,
          size: 32,
          underline: {type: 'single'},
        },
      },
      {
        id: 'keyword-label-zh',
        name: 'Keyword Label ZH',
        run: {bold: false, font: hei, size: 24},
      },
      {
        id: 'keyword-label-en',
        name: 'Keyword Label EN',
        run: {bold: true, font: times, size: 24},
      },
    ],
  },
} satisfies DocxDocumentData

const page = {
  size: {width: '210mm', height: '297mm', orientation: 'portrait'},
  margin: {
    top: '30mm',
    right: '20mm',
    bottom: '25mm',
    left: '25mm',
    gutter: '5mm',
    header: '15mm',
    footer: '17.5mm',
  },
} as const

const header = docxPart(
  withDocx(
    {
      type: 'paragraph',
      children: [{type: 'text', value: '喵喵大学毕业设计（论文）'}],
    },
    {paragraph: {style: 'page-header'}},
  ),
)
const footer = docxPart(
  withDocx(
    {
      type: 'paragraph',
      children: [Field({kind: 'pageNumber', cached: '1'})],
    },
    {paragraph: {style: 'page-number'}},
  ),
)

export const thesisDefaultSection = {
  properties: {page},
} satisfies DocxSectionData

export const thesisSections = {
  declaration: {
    breakBefore: 'nextPage',
    properties: {page},
  },
  abstract: {
    breakBefore: 'nextPage',
    properties: {
      page: {...page, pageNumbers: {formatType: 'upperRoman', start: 1}},
    },
    footers: {default: footer},
  },
  body: {
    breakBefore: 'oddPage',
    properties: {
      page: {...page, pageNumbers: {formatType: 'decimal', start: 1}},
    },
    headers: {default: header},
    footers: {default: footer},
  },
  backmatter: {
    breakBefore: 'nextPage',
    properties: {
      page: {...page, pageNumbers: {formatType: 'decimal'}},
    },
    headers: {default: header},
    footers: {default: footer},
  },
} satisfies Record<string, DocxSectionData>

export function prepareThesisFormatting(root: Root): void {
  styleChildren(root)
}

export function finishThesisFormatting(root: Root): void {
  let chapter = 0
  visitFinished(
    root,
    () => chapter,
    (value) => {
      chapter = value
    },
  )
}

function styleChildren(parent: Parent): void {
  for (let index = 0; index < parent.children.length; index += 1) {
    const node = parent.children[index]
    if (node === undefined) continue
    styleNode(node)
    if ('children' in node && Array.isArray(node.children)) {
      styleChildren(node)
    }
    if (
      node.type === 'table' &&
      node.data?.docx?.table?.style === 'ThreeLineTable'
    ) {
      parent.children.splice(index + 1, 0, {
        type: 'paragraph',
        children: [],
      } as RootContent)
      index += 1
    }
  }
}

function styleNode(node: Nodes): void {
  if (node.type === 'heading') {
    setParagraph(node, {
      style:
        node.depth === 1
          ? 'chapter-heading'
          : node.depth === 2
            ? 'section-heading'
            : 'subsection-heading',
    })
  }

  if (node.type === 'paragraph') {
    const isImage =
      node.children.length === 1 && node.children[0]?.type === 'image'
    if (isImage) setParagraph(node, {alignment: 'center'})
    else if (node.data?.docx?.paragraph?.style === undefined) {
      setParagraph(node, {style: 'body-paragraph'})
    }
  }

  if (node.type === 'code') {
    const data = docx(node)
    data.code = {
      ...(node.lang === null || node.lang === undefined
        ? {}
        : {language: node.lang}),
      theme: 'plain',
      lines: node.value.split('\n').map((line) => [{content: line}]),
    }
    setParagraph(node, {style: 'code-block'})
  }

  if (node.type === 'inlineCode') {
    const data = docx(node)
    data.run = {...data.run, style: 'code-block'}
  }

  if (node.type === 'table') {
    const configured = node.data?.docx?.table
    const isCoverField =
      configured?.layout === 'fixed' && configured.width?.size === 5600
    if (!isCoverField) {
      node.align = null
      Object.assign(docx(node), {
        table: {
          ...configured,
          style: 'ThreeLineTable',
          width: {size: 100, type: 'pct'},
          layout: 'autofit',
          borders: {
            top: {style: 'single', size: 8, color: '000000'},
            left: {style: 'nil', size: 0, color: 'auto'},
            bottom: {style: 'single', size: 8, color: '000000'},
            right: {style: 'nil', size: 0, color: 'auto'},
            insideHorizontal: {style: 'nil', size: 0, color: 'auto'},
            insideVertical: {style: 'nil', size: 0, color: 'auto'},
          },
          tableLook: {firstRow: true, noHBand: true, noVBand: true},
        },
      })
      for (const row of node.children) {
        for (const cell of row.children) {
          setParagraph(cell, {style: 'table-cell'})
        }
      }
      const firstRow = node.children[0]
      if (firstRow !== undefined) {
        const rowData = docx(firstRow)
        rowData.row = {...rowData.row, tableHeader: false}
      }
      for (const cell of firstRow?.children ?? []) {
        Object.assign(docx(cell), {
          cell: {
            ...cell.data?.docx?.cell,
            borders: {
              ...cell.data?.docx?.cell?.borders,
              bottom: {style: 'single', size: 4, color: '000000'},
            },
          },
        })
        forceRunNotBold(cell)
      }
    }
  }

  if (
    node.type === 'tableCell' &&
    node.data?.docx?.paragraph?.style === undefined
  ) {
    setParagraph(node, {style: 'table-cell'})
  }
}

function forceRunNotBold(parent: Parent): void {
  for (const child of parent.children) {
    const data = docx(child)
    data.run = {...data.run, bold: false}
    if ('children' in child && Array.isArray(child.children)) {
      forceRunNotBold(child)
    }
  }
}

function visitFinished(
  parent: Parent,
  chapter: () => number,
  setChapter: (value: number) => void,
): void {
  for (const [index, node] of parent.children.entries()) {
    if (node.type === 'heading') {
      const match = /^\s*第(\d+)章/u.exec(plainText(node))
      if (node.depth === 1 && match?.[1] !== undefined) {
        setChapter(Number(match[1]))
      }
      if (node.data?.docx?.paragraph?.style === undefined) {
        setParagraph(node, {
          style:
            node.depth === 1
              ? 'chapter-heading'
              : node.depth === 2
                ? 'section-heading'
                : 'subsection-heading',
        })
      }
    }

    const isStandaloneImage =
      node.type === 'paragraph' &&
      node.children.length === 1 &&
      node.children[0]?.type === 'image'
    if (isStandaloneImage) {
      setParagraph(node, {alignment: 'center'})
    }

    const isPostTableSpacer =
      node.type === 'paragraph' &&
      node.children.length === 0 &&
      parent.children[index - 1]?.type === 'table'

    if (
      node.type === 'table' &&
      node.data?.docx?.table?.style === 'ThreeLineTable'
    ) {
      node.align = null
      for (const row of node.children) {
        for (const cell of row.children) {
          setParagraph(cell, {style: 'table-cell'})
        }
      }
    }

    const bibliography = node.data?.docx?.bibliographyEntry
    if (bibliography !== undefined && node.type === 'paragraph') {
      materializeBibliographyTab(node.children)
      setParagraph(node, {
        style: 'bibliography-entry',
        indent: {
          leftChars: 150,
          hangingChars: bibliography.number < 10 ? 150 : 200,
        },
        tabStops: [{type: 'left', position: 315}],
      })
    } else if (
      node.type === 'paragraph' &&
      node.data?.docx?.paragraph?.style === undefined &&
      !isStandaloneImage &&
      !isPostTableSpacer
    ) {
      setParagraph(node, {style: 'body-paragraph'})
    }

    const caption = node.data?.docx?.caption
    if (
      caption !== undefined &&
      caption.number !== undefined &&
      (caption.label === '图' || caption.label === '表') &&
      'children' in node
    ) {
      const first = node.children[0]
      if (first?.type === 'text') {
        first.value = first.value.replace(
          new RegExp(`^${caption.label} \\d+ — `, 'u'),
          `${caption.label}${chapter()}-${caption.number}  `,
        )
      }
    }

    const citation = node.data?.docx?.citation
    if (citation !== undefined) {
      let separators = Math.max(0, citation.keys.length - 1)
      for (
        let citationIndex = index;
        citationIndex < parent.children.length && separators > 0;
        citationIndex += 1
      ) {
        const child = parent.children[citationIndex]
        if (child?.type === 'text' && child.value === ', ') {
          child.value = ','
          separators -= 1
        }
      }
    }

    if ('children' in node && Array.isArray(node.children)) {
      visitFinished(node, chapter, setChapter)
    }
  }
}

function materializeBibliographyTab(children: PhrasingContent[]): void {
  const first = children[0]
  if (first?.type !== 'text') return
  const match = /^(\[\d+\])(.*)$/u.exec(first.value)
  if (match?.[1] === undefined || match[2] === undefined) return
  children.splice(0, 1, {type: 'text', value: match[1]}, Tab(), {
    type: 'text',
    value: match[2],
  })
}

function setParagraph(node: Nodes, patch: DocxParagraphData): void {
  const data = docx(node)
  data.paragraph = {...data.paragraph, ...patch}
}

function docx(node: Nodes): NonNullable<NonNullable<Nodes['data']>['docx']> {
  node.data = {...node.data, docx: {...node.data?.docx}}
  return node.data.docx as NonNullable<NonNullable<Nodes['data']>['docx']>
}

function plainText(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') return node.value
  return 'children' in node
    ? node.children.map((child) => plainText(child)).join('')
    : ''
}
