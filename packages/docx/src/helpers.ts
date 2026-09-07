import {
  isMarkElement,
  isMdastCandidate,
  jsx,
  lowerToRoot,
  type MarkValue,
} from '@markscript/runtime'
import type {
  Image,
  Link,
  Nodes,
  Paragraph,
  PhrasingContent,
  Root,
  Table,
  TableCell,
  TableRow,
  Text,
} from 'mdast'
import {clonePlain, docxData} from './tree.ts'
import type {
  DocxCaptionData,
  DocxCellData,
  DocxCitationData,
  DocxData,
  DocxDocumentConfig,
  DocxFieldData,
  DocxImageData,
  DocxParagraphData,
  DocxReferenceData,
  DocxRowData,
  DocxRunData,
  DocxSectionData,
  DocxTableData,
  DocxTocData,
} from './types.ts'

export function defineDocx(config: DocxDocumentConfig): DocxDocumentConfig {
  return config
}

export function docxPart(value: MarkValue): Root {
  return lowerToRoot(value)
}

export function withDocx<Node extends Nodes>(node: Node, data: DocxData): Node {
  const copy = {...node, data: {...node.data, docx: clonePlain(data)}} as Node
  return copy
}

export function Span({
  run,
  children,
}: {
  run: DocxRunData
  children?: unknown
}): PhrasingContent[] {
  const nodes = phrasing(children)
  const apply = (node: PhrasingContent): void => {
    docxData(node).run = {
      ...(docxData(node).run ?? {}),
      ...clonePlain(run),
    }
    if ('children' in node) for (const child of node.children) apply(child)
  }
  for (const node of nodes) apply(node)
  return nodes
}

export function PageBreak(): Paragraph {
  return specialParagraph('', {pageBreak: true})
}

export function SectionBreak({
  section,
  breakBefore = 'nextPage',
}: {
  section: string | DocxSectionData
  breakBefore?: NonNullable<DocxSectionData['breakBefore']>
}): Paragraph {
  const resolved =
    typeof section === 'string'
      ? {name: section, breakBefore}
      : {...clonePlain(section), breakBefore}
  return Section({section: resolved})
}

export function Section({
  section,
}: {
  section: string | DocxSectionData
}): Paragraph {
  return specialParagraph('', {section: clonePlain(section)})
}

export function Tab(): Text {
  return {
    type: 'text',
    value: '',
    data: {docx: {tab: true}},
  }
}

export function Space({
  count = 1,
  nonBreaking = false,
}: {
  count?: number
  nonBreaking?: boolean
} = {}): Text {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('Space count must be a positive integer')
  }
  return {type: 'text', value: (nonBreaking ? '\u00a0' : ' ').repeat(count)}
}

export function Field({
  children,
  cached,
  ...field
}: Omit<DocxFieldData, 'cached'> & {
  cached?: string
  children?: unknown
}): Text {
  const fallback = cached ?? (textFrom(children) || '?')
  return {
    type: 'text',
    value: fallback,
    data: {docx: {field: {...clonePlain(field), cached: fallback}}},
  }
}

export function Toc({
  title = 'Contents',
  ...toc
}: DocxTocData & {title?: string} = {}): Paragraph {
  return specialParagraph(title, {toc: clonePlain(toc)})
}

export function Caption({
  id,
  kind = 'figure',
  label = titleCase(kind),
  resetAtHeading,
  paragraph,
  children,
}: {
  id: string
  kind?: string
  label?: string
  resetAtHeading?: number
  paragraph?: DocxParagraphData
  children?: unknown
}): Paragraph {
  const caption: DocxCaptionData = {id, kind, label}
  if (resetAtHeading !== undefined) caption.resetAtHeading = resetAtHeading
  const node: Paragraph = {
    type: 'paragraph',
    children: [{type: 'text', value: `${label} ? — `}, ...phrasing(children)],
    data: {docx: {caption}},
  }
  if (paragraph !== undefined) docxData(node).paragraph = clonePlain(paragraph)
  return node
}

export function Ref({
  target,
  children,
}: {
  target: string
  children?: unknown
}): Link {
  const fallback = phrasing(children)
  const reference: DocxReferenceData = {target}
  return {
    type: 'link',
    url: `#${target}`,
    children:
      fallback.length > 0 ? fallback : [{type: 'text', value: 'Reference ?'}],
    data: {docx: {reference}},
  }
}

export function Cite({
  keys,
  source,
}: {
  keys: string | readonly string[]
  source?: string
}): Text {
  const normalized = typeof keys === 'string' ? [keys] : [...keys]
  if (normalized.length === 0)
    throw new RangeError('Cite requires at least one key')
  const citation: DocxCitationData = {keys: normalized}
  if (source !== undefined) citation.source = source
  return {
    type: 'text',
    value: normalized.map((key) => `@${key}`).join('; '),
    data: {docx: {citation}},
  }
}

export function Bibliography({
  source,
  title = 'References',
  includeUncited = false,
  headingDepth = 1,
}: {
  source?: string
  title?: string
  includeUncited?: boolean
  headingDepth?: 1 | 2 | 3 | 4 | 5 | 6
} = {}): Paragraph {
  return specialParagraph(title, {
    bibliography: {
      ...(source === undefined ? {} : {source}),
      title,
      includeUncited,
      headingDepth,
    },
  })
}

export function DocxImage({
  src,
  alt,
  title,
  image,
}: {
  src: string
  alt: string
  title?: string
  image?: DocxImageData
}): Image {
  return {
    type: 'image',
    url: src,
    alt,
    ...(title === undefined ? {} : {title}),
    ...(image === undefined ? {} : {data: {docx: {image: clonePlain(image)}}}),
  }
}

export interface DocxTableCellInput {
  content?: unknown
  cell?: DocxCellData
}

export interface DocxTableRowInput {
  cells: readonly (DocxTableCellInput | unknown)[]
  row?: DocxRowData
}

export function docxTable({
  rows,
  table,
  align,
}: {
  rows: readonly DocxTableRowInput[]
  table?: DocxTableData
  align?: Table['align']
}): Table {
  const tableRows: TableRow[] = rows.map((input) => {
    const row: TableRow = {
      type: 'tableRow',
      children: input.cells.map((rawCell) => {
        const inputCell = isCellInput(rawCell) ? rawCell : {content: rawCell}
        const cell: TableCell = {
          type: 'tableCell',
          children: phrasing(inputCell.content),
        }
        if (inputCell.cell !== undefined)
          docxData(cell).cell = clonePlain(inputCell.cell)
        return cell
      }),
    }
    if (input.row !== undefined) docxData(row).row = clonePlain(input.row)
    return row
  })
  const node: Table = {type: 'table', align: align ?? null, children: tableRows}
  if (table !== undefined) docxData(node).table = clonePlain(table)
  return node
}

export const mm = (value: number): `${number}mm` => `${value}mm`
export const cm = (value: number): `${number}cm` => `${value}cm`
export const inch = (value: number): `${number}in` => `${value}in`
export const pt = (value: number): `${number}pt` => `${value}pt`
export const percent = (value: number): `${number}%` => `${value}%`

function phrasing(value: unknown): PhrasingContent[] {
  if (value === undefined || value === null || value === false) return []
  const root = lowerPhrasingValue(value)
  if (root.children.length === 0) return []
  if (root.children.length === 1 && root.children[0]?.type === 'paragraph') {
    return root.children[0].children
  }
  throw new TypeError('DOCX phrasing content must lower to one paragraph')
}

function lowerPhrasingValue(value: unknown): Root {
  if (
    (isMarkElement(value) && value.name === 'p') ||
    (isMdastCandidate(value) &&
      (value.type === 'paragraph' || value.type === 'root'))
  ) {
    return lowerToRoot(value as MarkValue)
  }
  return lowerToRoot(jsx('p', {children: value}))
}

function specialParagraph(value: string, data: DocxData): Paragraph {
  return {
    type: 'paragraph',
    children: [{type: 'text', value}],
    data: {docx: data},
  }
}

function textFrom(value: unknown): string {
  return phrasing(value)
    .map((node) => textNode(node))
    .join('')
}

function textNode(node: PhrasingContent): string {
  if ('value' in node && typeof node.value === 'string') return node.value
  return 'children' in node
    ? node.children.map((child) => textNode(child)).join('')
    : ''
}

function titleCase(value: string): string {
  return value.length === 0
    ? 'Caption'
    : value[0]?.toUpperCase() + value.slice(1)
}

function isCellInput(value: unknown): value is DocxTableCellInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('content' in value || 'cell' in value)
  )
}
