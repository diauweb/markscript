import type {ReadonlyRoot} from '@markscript/runtime'
import type {
  IColumnsAttributes,
  IImageOptions,
  IIndentAttributesProperties,
  IParagraphOptions,
  IParagraphRunPropertiesOptions,
  IParagraphStyleOptions,
  IPropertiesOptions,
  IRunOptions,
  ISectionPropertiesOptions,
  ISpacingProperties,
  IStylesOptions,
  ITableCellOptions,
  ITableOfContentsOptions,
  ITableOptions,
  ITableRowOptions,
} from 'docx'
import type {Image, ImageReference, Root} from 'mdast'

export type DocxScalar = string | number | boolean | null
export type DocxValue =
  | DocxScalar
  | readonly DocxValue[]
  | {readonly [key: string]: DocxValue | undefined}

export type DocxIndentData = IIndentAttributesProperties & {
  readonly leftChars?: number
  readonly rightChars?: number
  readonly hangingChars?: number
}
export type DocxSpacingData = ISpacingProperties & {
  readonly beforeLines?: number
  readonly afterLines?: number
}
export type DocxParagraphStyleData = Omit<
  IParagraphStyleOptions,
  'paragraph'
> & {
  readonly paragraph?: Omit<
    NonNullable<IParagraphStyleOptions['paragraph']>,
    'indent' | 'spacing'
  > & {
    readonly indent?: DocxIndentData
    readonly spacing?: DocxSpacingData
    readonly pageBreakBefore?: boolean
  }
}
export type DocxStylesData = Omit<
  IStylesOptions,
  'initialStyles' | 'importedStyles' | 'paragraphStyles'
> & {readonly paragraphStyles?: readonly DocxParagraphStyleData[]}
export type DocxDocumentData = Omit<
  IPropertiesOptions,
  'sections' | 'footnotes' | 'endnotes' | 'comments' | 'fonts' | 'styles'
> & {styles?: DocxStylesData}
export type DocxParagraphData = Omit<
  IParagraphOptions,
  'children' | 'text' | 'run' | 'indent' | 'spacing'
> & {
  indent?: DocxIndentData
  spacing?: DocxSpacingData
  run?: IParagraphRunPropertiesOptions
}
export type DocxRunData = Omit<IRunOptions, 'children' | 'text'>
export type DocxTableData = Omit<ITableOptions, 'rows'>
export type DocxRowData = Omit<ITableRowOptions, 'children'>
export type DocxCellData = Omit<ITableCellOptions, 'children'>
export type DocxImageData = Partial<
  Omit<IImageOptions, 'data' | 'fallback'>
> & {
  /** PNG/JPEG data URL or resource source used when a client cannot display SVG. */
  fallback?: string
}
export type DocxSectionPropertiesData = Omit<
  ISectionPropertiesOptions,
  'headerWrapperGroup' | 'footerWrapperGroup' | 'column' | 'revision'
> & {
  column?: Omit<IColumnsAttributes, 'children'>
}

export interface DocxPartSet {
  default?: Root
  first?: Root
  even?: Root
}

export interface DocxSectionData {
  name?: string
  breakBefore?: 'continuous' | 'nextPage' | 'evenPage' | 'oddPage'
  properties?: DocxSectionPropertiesData
  headers?: DocxPartSet
  footers?: DocxPartSet
}

export interface DocxFieldData {
  kind:
    | 'pageNumber'
    | 'pageCount'
    | 'date'
    | 'sequence'
    | 'reference'
    | 'custom'
  instruction?: string
  target?: string
  sequence?: string
  cached: string
}

export interface DocxTocData extends ITableOfContentsOptions {
  cachedHeadings?: readonly {depth: number; text: string; target?: string}[]
}

export interface DocxRawXmlData {
  context: 'block' | 'inline'
  xml: string
}

export interface DocxCaptionData {
  id: string
  kind: string
  label: string
  number?: number
  bookmark?: string
  resetAtHeading?: number
}

export interface DocxReferenceData {
  target: string
  cached?: string
  bookmark?: string
}

export interface DocxCitationData {
  keys: readonly string[]
  source?: string
  numbers?: readonly number[]
  bookmarks?: readonly string[]
  cached?: string
}

export interface DocxBibliographyEntryData {
  key: string
  number: number
  bookmark: string
}

export interface DocxCodeToken {
  content: string
  color?: string
  fontStyle?: number
}

export interface DocxCodeData {
  language?: string
  theme?: string
  lines: readonly (readonly DocxCodeToken[])[]
}

/** The single open DOCX namespace attached to roots and ordinary MDAST nodes. */
export interface DocxData {
  document?: DocxDocumentData
  defaultSection?: DocxSectionData
  paragraph?: DocxParagraphData
  run?: DocxRunData
  table?: DocxTableData
  row?: DocxRowData
  cell?: DocxCellData
  image?: DocxImageData
  section?: DocxSectionData | string
  pageBreak?: true
  tab?: true
  field?: DocxFieldData
  toc?: DocxTocData
  rawXml?: DocxRawXmlData
  caption?: DocxCaptionData
  reference?: DocxReferenceData
  citation?: DocxCitationData
  bibliographyEntry?: DocxBibliographyEntryData
  bibliography?: {
    source?: string
    title?: string
    includeUncited?: boolean
    headingDepth?: 1 | 2 | 3 | 4 | 5 | 6
  }
  code?: DocxCodeData
  /** Word bookmark emitted around this ordinary node's rendered content. */
  bookmark?: string
}

declare module 'unist' {
  interface Data {
    docx?: DocxData
  }
}

export interface DocxBibliographyRecord {
  id: string
  author?: string
  title: string
  containerTitle?: string
  issued?: string | number
  publisher?: string
  url?: string
  [key: string]: DocxValue | undefined
}

export type DocxBibliographySource =
  | readonly DocxBibliographyRecord[]
  | Readonly<Record<string, Omit<DocxBibliographyRecord, 'id'>>>

export interface DocxBibliographySources {
  sources: Readonly<Record<string, DocxBibliographySource>>
  defaultSource?: string
}

export interface DocxDocumentConfig {
  document?: DocxDocumentData
  sections?: Record<string, DocxSectionData>
  defaultSection?: string | DocxSectionData
  bibliography?:
    | DocxBibliographySource
    | Readonly<Record<string, DocxBibliographySource>>
    | DocxBibliographySources
  /** Formats one-key citations; multi-key citations retain the built-in linked form. */
  formatCitation?: (
    records: readonly DocxBibliographyRecord[],
    numbers: readonly number[],
  ) => string | Promise<string>
  formatBibliographyEntry?: (
    record: DocxBibliographyRecord,
    number: number,
  ) => string | Promise<string>
}

export interface DocxResolvedImage {
  data: Uint8Array
  type: 'png' | 'jpg' | 'gif' | 'bmp' | 'svg'
  width: number
  height: number
  fallback?: {
    data: Uint8Array
    type: 'png' | 'jpg'
  }
}

export interface DocxResourceContext {
  kind: 'image'
  node: Readonly<Image | ImageReference>
}

export interface DocxWriteOptions {
  resolveResource?: (
    source: string,
    context: DocxResourceContext,
  ) => DocxResolvedImage | Promise<DocxResolvedImage>
}

export type DocxRoot = Root
export type ReadonlyDocxRoot = ReadonlyRoot
