import {
  Caption,
  Cite as DocxCite,
  type DocxParagraphData,
  docxTable,
  Span,
} from '@markscript/docx'
import type {MarkValue} from '@markscript/markscript'
import type {Table, TableCell} from 'mdast'

export function spacedText(value: string): MarkValue {
  const characters = [...value]
  return characters.length === 2
    ? `${characters[0] ?? ''}    ${characters[1] ?? ''}`
    : value
}

export function SpacedText({children}: {children?: unknown}): MarkValue {
  return spacedText(textValue(children))
}

export function Underlined({children}: {children?: unknown}): MarkValue {
  return Span({
    run: {underline: {type: 'single'}},
    children,
  })
}

export function Cite({
  keys,
  source,
}: {
  keys: string | readonly string[]
  source?: string
}): MarkValue {
  return Span({
    run: {superScript: true},
    children: DocxCite({keys, ...(source === undefined ? {} : {source})}),
  })
}

export function FigureCaption({
  id,
  children,
}: {
  id: string
  children?: unknown
}): MarkValue {
  return Caption({
    id,
    kind: 'figure',
    label: '图',
    resetAtHeading: 1,
    paragraph: {style: 'figure-caption'},
    children,
  })
}

export function TableCaption({
  id,
  children,
}: {
  id: string
  children?: unknown
}): MarkValue {
  return Caption({
    id,
    kind: 'table',
    label: '表',
    resetAtHeading: 1,
    paragraph: {style: 'table-caption'},
    children,
  })
}

export function CoverField({
  label,
  value,
}: {
  label: string
  value: string
}): Table {
  const table = docxTable({
    table: {
      width: {size: 5600, type: 'dxa'},
      indent: {size: 2266, type: 'dxa'},
      layout: 'fixed',
      columnWidths: [1800, 3800],
      borders: {
        top: {style: 'nil', size: 0, color: 'auto'},
        bottom: {style: 'nil', size: 0, color: 'auto'},
        left: {style: 'nil', size: 0, color: 'auto'},
        right: {style: 'nil', size: 0, color: 'auto'},
        insideHorizontal: {style: 'nil', size: 0, color: 'auto'},
        insideVertical: {style: 'nil', size: 0, color: 'auto'},
      },
    },
    rows: [
      {
        row: {tableHeader: false},
        cells: [
          {
            content: Span({
              run: {bold: false},
              children: spacedText(label),
            }),
            cell: {
              width: {size: 1800, type: 'dxa'},
              verticalAlign: 'bottom',
              noWrap: true,
            },
          },
          {
            content: Span({run: {bold: false}, children: value}),
            cell: {
              width: {size: 3800, type: 'dxa'},
              verticalAlign: 'bottom',
              noWrap: true,
            },
          },
        ],
      },
    ],
  })

  const row = table.children[0]
  const left = row?.children[0]
  const right = row?.children[1]
  if (left !== undefined) {
    setCellParagraph(left, {style: 'cover-info'})
  }
  if (right !== undefined) {
    setCellParagraph(right, {
      style: 'cover-info',
      alignment: 'center',
      border: {
        bottom: {style: 'single', size: 8, color: '000000'},
      },
    })
  }
  return table
}

function setCellParagraph(cell: TableCell, paragraph: DocxParagraphData): void {
  cell.data = {
    ...cell.data,
    docx: {...cell.data?.docx, paragraph},
  }
}

function textValue(value: unknown): string {
  if (value === undefined || value === null || value === false) return ''
  if (Array.isArray(value)) return value.map((item) => textValue(item)).join('')
  return String(value)
}
