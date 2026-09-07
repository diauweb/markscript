import {randomUUID} from 'node:crypto'
import {mkdir, rename, rm, writeFile} from 'node:fs/promises'
import {basename, dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import type {ReadonlyRoot} from '@markscript/runtime'
import {Resvg} from '@resvg/resvg-js'
import {
  AlignmentType,
  BookmarkEnd,
  BookmarkStart,
  Document,
  ExternalHyperlink,
  FileChild,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  type IContext,
  type IImageOptions,
  type ILevelsOptions,
  ImageRun,
  ImportedXmlComponent,
  type INumberingOptions,
  InternalHyperlink,
  type IParagraphOptions,
  type IPropertiesOptions,
  type IRunOptions,
  type ISectionOptions,
  type ISectionPropertiesOptions,
  type ITableCellOptions,
  type ITableOfContentsOptions,
  type ITableOptions,
  type ITableRowOptions,
  type IXmlableObject,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  type ParagraphChild,
  SectionType,
  SimpleField,
  Tab,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  XmlComponent,
} from 'docx'
import type {DocxResolvedImage, DocxWriteOptions} from './types.ts'

interface MdNode {
  readonly type: string
  readonly children?: readonly MdNode[]
  readonly data?: Readonly<Record<string, unknown>>
  readonly position?: {
    readonly start?: {readonly line?: number; readonly column?: number}
  }
  readonly [key: string]: unknown
}

interface RenderedSection {
  readonly data?: Readonly<Record<string, unknown>>
  readonly children: FileChild[]
}

interface InlineStyle extends Readonly<Record<string, unknown>> {}

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const

const BULLETS = ['•', '◦', '▪'] as const
const FIELD_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.:-]*$/u
const BOOKMARK_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.-]{0,39}$/u
const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

/** An error tied to the finalized MDAST path being written. */
export class DocxWriterError extends Error {
  readonly code: string
  readonly path?: string

  constructor(
    code: string,
    message: string,
    options: {path?: string; cause?: unknown} = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : {cause: options.cause},
    )
    this.name = 'DocxWriterError'
    this.code = code
    if (options.path !== undefined) this.path = options.path
  }
}

/**
 * Writes one finalized MDAST root as DOCX. The tree is consumed as immutable
 * data: this function never runs transforms, evaluates code, or mutates nodes.
 */
export async function writeDocx(
  root: ReadonlyRoot,
  output: string | URL,
  options: DocxWriteOptions = {},
): Promise<void> {
  if (root.type !== 'root') {
    throw new DocxWriterError('DOCX_ROOT', 'writeDocx requires an MDAST root')
  }
  const target = outputPath(output)

  const writer = new Writer(options)
  let document: Document
  try {
    document = await writer.render(root)
  } catch (error) {
    throw preserveWriterError(
      error,
      'DOCX_RENDER',
      'Could not map the finalized MDAST tree to DOCX',
    )
  }

  let packed: Buffer
  try {
    packed = await Packer.toBuffer(document)
  } catch (error) {
    throw preserveWriterError(error, 'DOCX_PACK', 'Could not package the DOCX')
  }

  await writeAtomically(target, packed)
}

class Writer {
  private readonly definitions = new Map<string, MdNode>()
  private readonly footnoteDefinitions = new Map<string, MdNode>()
  private readonly footnoteIds = new Map<string, number>()
  private readonly numbering: INumberingOptions['config'][number][] = []
  private readonly numberingReferences = new Set<string>()
  private readonly handledSectionNodes = new WeakSet<object>()
  private nextBookmarkNumericId = 1
  private fieldsNeedUpdate = false

  constructor(private readonly options: DocxWriteOptions) {}

  async render(root: ReadonlyRoot): Promise<Document> {
    const rootNode = root as unknown as MdNode
    this.collectDefinitions(rootNode)

    const rootDocx = docxData(rootNode)
    const supplied =
      rootDocx?.document === undefined
        ? {}
        : {...requireRecord(rootDocx.document, '$.data.docx.document')}
    if ('sections' in supplied) {
      throw new DocxWriterError(
        'DOCX_DOCUMENT_SECTIONS',
        'data.docx.document.sections is not accepted; sections are derived from the MDAST tree',
        {path: '$.data.docx.document.sections'},
      )
    }
    this.collectNumberingReferences(supplied.numbering)

    const sections = await this.renderSections(
      rootNode,
      rootDocx?.defaultSection,
    )
    const footnotes = await this.renderFootnotes()
    const documentOptions = this.documentOptions(supplied, sections, footnotes)
    return new Document(documentOptions)
  }

  private collectDefinitions(root: MdNode): void {
    walk(root, (node) => {
      if (node.type === 'definition') {
        const identifier = stringProperty(node, 'identifier')
        if (identifier !== undefined) {
          this.definitions.set(normalizeIdentifier(identifier), node)
        }
      } else if (node.type === 'footnoteDefinition') {
        const identifier = stringProperty(node, 'identifier')
        if (identifier !== undefined) {
          this.footnoteDefinitions.set(normalizeIdentifier(identifier), node)
        }
      }
    })
  }

  private collectNumberingReferences(value: unknown): void {
    const config = asRecord(value)?.config
    if (!Array.isArray(config)) return
    for (const item of config) {
      const reference = asRecord(item)?.reference
      if (typeof reference === 'string') this.numberingReferences.add(reference)
    }
  }

  private async renderSections(
    root: MdNode,
    defaultSection: unknown,
  ): Promise<ISectionOptions[]> {
    const rendered: RenderedSection[] = []
    let current: {
      data?: Readonly<Record<string, unknown>>
      children: FileChild[]
    } = {
      children: [],
    }
    if (defaultSection !== undefined) {
      current.data = sectionRecord(defaultSection, '$.data.docx.defaultSection')
    }

    const append = async (child: MdNode, path: string): Promise<void> => {
      const section = docxData(child)?.section
      if (section !== undefined) {
        this.handledSectionNodes.add(child)
        const next = sectionRecord(section, `${path}.data.docx.section`)
        if (rendered.length === 0 && current.children.length === 0) {
          current.data = mergeSectionData(current.data, next)
        } else {
          rendered.push(current)
          current = {data: next, children: []}
        }
      }

      if (section !== undefined && isSectionMarker(child)) return
      if (isTransparentFlowContainer(child)) {
        for (const [index, nested] of (child.children ?? []).entries()) {
          await append(nested, `${path}.children[${index}]`)
        }
        return
      }
      current.children.push(...(await this.renderBlock(child, path)))
    }

    for (const [index, child] of (root.children ?? []).entries()) {
      await append(child, `$.children[${index}]`)
    }
    rendered.push(current)

    const result: ISectionOptions[] = []
    for (const [index, section] of rendered.entries()) {
      const nextBreakBefore = rendered[index + 1]?.data?.breakBefore
      result.push({
        ...(await this.sectionOptions(
          section.data,
          `$.sections[${index}]`,
          nextBreakBefore,
          `$.sections[${index + 1}].breakBefore`,
        )),
        children: section.children,
      })
    }
    return result
  }

  private async sectionOptions(
    value: Readonly<Record<string, unknown>> | undefined,
    path: string,
    breakAfter: unknown,
    breakAfterPath: string,
  ): Promise<Omit<ISectionOptions, 'children'>> {
    const properties = copyRecord(value?.properties)
    if (breakAfter !== undefined && breakAfter !== false) {
      properties.type = sectionBreakType(breakAfter, breakAfterPath)
    }

    const headers = await this.renderParts(
      value?.headers,
      'header',
      `${path}.headers`,
    )
    const footers = await this.renderParts(
      value?.footers,
      'footer',
      `${path}.footers`,
    )
    return {
      ...(Object.keys(properties).length === 0
        ? {}
        : {properties: properties as ISectionPropertiesOptions}),
      ...(headers === undefined
        ? {}
        : {headers: headers as NonNullable<ISectionOptions['headers']>}),
      ...(footers === undefined
        ? {}
        : {footers: footers as NonNullable<ISectionOptions['footers']>}),
    }
  }

  private async renderParts(
    value: unknown,
    kind: 'header' | 'footer',
    path: string,
  ): Promise<
    | {
        default?: Header | Footer
        first?: Header | Footer
        even?: Header | Footer
      }
    | undefined
  > {
    if (value === undefined) return undefined
    const parts = requireRecord(value, path)
    const result: Record<string, Header | Footer> = {}
    for (const key of ['default', 'first', 'even'] as const) {
      const part = parts[key]
      if (part === undefined) continue
      const root = requireRecord(part, `${path}.${key}`) as unknown as MdNode
      if (root.type !== 'root' || !Array.isArray(root.children)) {
        throw this.error(
          'DOCX_PART_ROOT',
          `${kind} ${key} must be a standard MDAST root`,
          `${path}.${key}`,
          root,
        )
      }
      const children: (Paragraph | Table)[] = []
      for (const [index, child] of root.children.entries()) {
        if (docxData(child)?.section !== undefined) {
          throw this.error(
            'DOCX_PART_SECTION',
            `A ${kind} cannot contain a section boundary`,
            `${path}.${key}.children[${index}]`,
            child,
          )
        }
        const rendered = await this.renderBlock(
          child,
          `${path}.${key}.children[${index}]`,
        )
        for (const item of rendered) {
          if (!(item instanceof Paragraph) && !(item instanceof Table)) {
            throw this.error(
              'DOCX_PART_CHILD',
              `${kind} content can contain only paragraphs and tables`,
              `${path}.${key}.children[${index}]`,
              child,
            )
          }
          children.push(item)
        }
      }
      result[key] =
        kind === 'header' ? new Header({children}) : new Footer({children})
    }
    return result
  }

  private documentOptions(
    supplied: Record<string, unknown>,
    sections: readonly ISectionOptions[],
    generatedFootnotes: Readonly<
      Record<string, {children: readonly Paragraph[]}>
    >,
  ): IPropertiesOptions {
    const result = {...supplied, sections} as Record<string, unknown>

    if (this.numbering.length > 0) {
      const existing = asRecord(supplied.numbering)
      const config = Array.isArray(existing?.config) ? existing.config : []
      result.numbering = {config: [...config, ...this.numbering]}
    }

    if (Object.keys(generatedFootnotes).length > 0) {
      const existing = asRecord(supplied.footnotes)
      result.footnotes = {...existing, ...generatedFootnotes}
    }

    if (this.fieldsNeedUpdate) {
      result.features = {...asRecord(supplied.features), updateFields: true}
    }
    return result as unknown as IPropertiesOptions
  }

  private async renderFootnotes(): Promise<
    Readonly<Record<string, {children: readonly Paragraph[]}>>
  > {
    const result: Record<string, {children: readonly Paragraph[]}> = {}
    let processed = 0
    while (processed < this.footnoteIds.size) {
      const entry = [...this.footnoteIds.entries()][processed]
      processed += 1
      if (entry === undefined) continue
      const [identifier, id] = entry
      const definition = this.footnoteDefinitions.get(identifier)
      if (definition === undefined) continue
      const children: Paragraph[] = []
      for (const [index, child] of (definition.children ?? []).entries()) {
        const rendered = await this.renderBlock(
          child,
          `$.footnotes[${JSON.stringify(identifier)}].children[${index}]`,
        )
        for (const item of rendered) {
          if (!(item instanceof Paragraph)) {
            throw this.error(
              'DOCX_FOOTNOTE_CHILD',
              'Footnotes can contain only paragraph-shaped content',
              `$.footnotes[${JSON.stringify(identifier)}].children[${index}]`,
              child,
            )
          }
          children.push(item)
        }
      }
      if (children.length === 0) children.push(new Paragraph({children: []}))
      result[String(id)] = {children}
    }
    return result
  }

  private async renderBlock(node: MdNode, path: string): Promise<FileChild[]> {
    const metadata = docxData(node)
    if (
      metadata?.section !== undefined &&
      !this.handledSectionNodes.has(node)
    ) {
      throw this.error(
        'DOCX_SECTION_POSITION',
        'A section boundary must occur in root flow content, not inside a list, table, blockquote, header, footer, or footnote',
        path,
        node,
      )
    }
    if (metadata?.rawXml !== undefined) {
      return [this.rawBlock(metadata.rawXml, path, node)]
    }
    if (metadata?.toc !== undefined) {
      this.fieldsNeedUpdate = true
      const toc = copyRecord(metadata.toc)
      const alias = textContent(node) || 'Contents'
      const cachedEntries = this.tocEntries(
        toc.cachedHeadings,
        `${path}.data.docx.toc.cachedHeadings`,
        node,
      )
      delete toc.cachedHeadings
      return [
        new TableOfContents(alias, {
          ...(toc as ITableOfContentsOptions),
          ...(cachedEntries.length === 0 ? {} : {cachedEntries}),
          beginDirty: true,
        }),
      ]
    }
    if (metadata?.field !== undefined) {
      return [
        new Paragraph({
          ...this.paragraphOptions(node),
          children: this.bookmarkedChildren(
            node,
            [this.renderField(metadata.field, textContent(node), path, node)],
            path,
          ),
        }),
      ]
    }

    const pageBreak =
      metadata?.pageBreak === true
        ? [new Paragraph({children: [new PageBreak()]})]
        : []
    if (pageBreak.length > 0 && isSpecialMarker(node, 'docx-page-break')) {
      return pageBreak
    }

    let body: FileChild[]
    switch (node.type) {
      case 'paragraph':
        body = [await this.renderParagraph(node, path)]
        break
      case 'heading':
        body = [await this.renderHeading(node, path)]
        break
      case 'code':
        body = this.renderCode(node, path)
        break
      case 'blockquote':
        body = await this.renderBlockquote(node, path)
        break
      case 'thematicBreak':
        body = [
          new Paragraph(this.paragraphOptions(node, {thematicBreak: true})),
        ]
        break
      case 'list':
        body = await this.renderList(node, path)
        break
      case 'table':
        body = [await this.renderTable(node, path)]
        break
      case 'containerDirective':
        body = await this.renderFlowChildren(node, path)
        break
      case 'leafDirective':
      case 'textDirective':
        body =
          (node.children?.length ?? 0) === 0
            ? []
            : [await this.renderParagraph(node, path)]
        break
      case 'html':
        body = this.renderBlockHtml(node, path)
        break
      case 'definition':
      case 'footnoteDefinition':
      case 'yaml':
      case 'toml':
        body = []
        break
      default:
        throw this.error(
          'DOCX_BLOCK_NODE',
          `Unsupported block MDAST node ${JSON.stringify(node.type)}`,
          path,
          node,
        )
    }
    return [...pageBreak, ...body]
  }

  private async renderFlowChildren(
    node: MdNode,
    path: string,
  ): Promise<FileChild[]> {
    const result: FileChild[] = []
    for (const [index, child] of (node.children ?? []).entries()) {
      result.push(
        ...(await this.renderBlock(child, `${path}.children[${index}]`)),
      )
    }
    return result
  }

  private async renderParagraph(
    node: MdNode,
    path: string,
    defaults: Readonly<Record<string, unknown>> = {},
    prefix: readonly ParagraphChild[] = [],
    inlineStyle: InlineStyle = {},
  ): Promise<Paragraph> {
    const children = [
      ...prefix,
      ...(await this.renderInlineChildren(node, path, inlineStyle)),
    ]
    return new Paragraph({
      ...this.paragraphOptions(node, defaults),
      children: this.bookmarkedChildren(node, children, path),
    })
  }

  private async renderHeading(node: MdNode, path: string): Promise<Paragraph> {
    const depth = numberProperty(node, 'depth')
    if (depth === undefined || depth < 1 || depth > 6) {
      throw this.error(
        'DOCX_HEADING_DEPTH',
        'Heading depth must be an integer from 1 through 6',
        path,
        node,
      )
    }
    const paragraph = asRecord(docxData(node)?.paragraph)
    return this.renderParagraph(
      node,
      path,
      paragraph?.style === undefined
        ? {heading: HEADING_LEVELS[depth - 1]}
        : {},
    )
  }

  private renderCode(node: MdNode, path: string): FileChild[] {
    const metadata = docxData(node)
    const paragraphData = asRecord(metadata?.paragraph)
    const hasParagraphStyle = typeof paragraphData?.style === 'string'
    const paragraphOptions = this.paragraphOptions(
      node,
      paragraphData === undefined
        ? {shading: {fill: 'F3F4F6'}, spacing: {after: 0}}
        : {},
    )
    const runOptions = this.runOptions(
      node,
      asRecord(metadata?.run) === undefined && !hasParagraphStyle
        ? {font: 'Courier New', noProof: true}
        : {},
    )
    const code = asRecord(metadata?.code)
    const annotatedLines = code?.lines
    if (Array.isArray(annotatedLines)) {
      const rendered = annotatedLines.map((rawLine, lineIndex) => {
        if (!Array.isArray(rawLine)) {
          throw this.error(
            'DOCX_CODE_DATA',
            'data.docx.code.lines must contain arrays of token objects',
            `${path}.data.docx.code.lines[${lineIndex}]`,
            node,
          )
        }
        const children = rawLine.map((rawToken, tokenIndex) => {
          const token = requireRecord(
            rawToken,
            `${path}.data.docx.code.lines[${lineIndex}][${tokenIndex}]`,
          )
          const content = stringFrom(token.content)
          if (content === undefined) {
            throw this.error(
              'DOCX_CODE_TOKEN',
              'A highlighted code token requires string content',
              `${path}.data.docx.code.lines[${lineIndex}][${tokenIndex}]`,
              node,
            )
          }
          const fontStyle =
            typeof token.fontStyle === 'number' ? token.fontStyle : 0
          const color = normalizeColor(token.color)
          return new TextRun({
            ...runOptions,
            ...(color === undefined ? {} : {color}),
            ...(fontStyle & 1 ? {italics: true} : {}),
            ...(fontStyle & 2 ? {bold: true} : {}),
            ...(fontStyle & 4 ? {underline: {type: 'single'}} : {}),
            text: content,
          })
        })
        return new Paragraph({
          ...paragraphOptions,
          children: children.length > 0 ? children : [new TextRun('')],
        })
      })
      return rendered.length > 0
        ? rendered
        : [new Paragraph({...paragraphOptions, children: [new TextRun('')]})]
    }

    const value = stringProperty(node, 'value') ?? ''
    return value.split('\n').map(
      (line) =>
        new Paragraph({
          ...paragraphOptions,
          children: [new TextRun({...runOptions, text: line})],
        }),
    )
  }

  private async renderBlockquote(
    node: MdNode,
    path: string,
  ): Promise<FileChild[]> {
    const children: FileChild[] = []
    for (const [index, child] of (node.children ?? []).entries()) {
      const childPath = `${path}.children[${index}]`
      if (child.type === 'paragraph') {
        const paragraphData = copyRecord(docxData(child)?.paragraph)
        children.push(
          await this.renderParagraph(child, childPath, {
            indent: {left: 720, ...asRecord(paragraphData.indent)},
          }),
        )
      } else {
        children.push(...(await this.renderBlock(child, childPath)))
      }
    }
    return children
  }

  private async renderList(
    node: MdNode,
    path: string,
    depth = 0,
  ): Promise<FileChild[]> {
    const reference = this.createListNumbering(node, depth)
    const result: FileChild[] = []
    for (const [itemIndex, item] of (node.children ?? []).entries()) {
      if (item.type !== 'listItem') {
        throw this.error(
          'DOCX_LIST_ITEM',
          'A list can contain only listItem nodes',
          `${path}.children[${itemIndex}]`,
          item,
        )
      }
      const itemPath = `${path}.children[${itemIndex}]`
      const itemChildren: FileChild[] = []
      let numbered = false
      for (const [childIndex, child] of (item.children ?? []).entries()) {
        const childPath = `${itemPath}.children[${childIndex}]`
        if (child.type === 'list') {
          itemChildren.push(
            ...(await this.renderList(
              child,
              childPath,
              Math.min(depth + 1, 8),
            )),
          )
          continue
        }
        if (!numbered && child.type === 'paragraph') {
          const checked = item.checked
          const prefix =
            typeof checked === 'boolean'
              ? [new TextRun(checked ? '☒ ' : '☐ ')]
              : []
          itemChildren.push(
            await this.renderParagraph(
              child,
              childPath,
              {numbering: {reference, level: depth}},
              prefix,
            ),
          )
          numbered = true
          continue
        }
        if (numbered && child.type === 'paragraph') {
          itemChildren.push(
            await this.renderParagraph(child, childPath, {
              indent: {left: 720 * (depth + 1)},
            }),
          )
          continue
        }
        itemChildren.push(...(await this.renderBlock(child, childPath)))
      }
      if (!numbered) {
        itemChildren.unshift(
          new Paragraph({
            numbering: {reference, level: depth},
            children: [],
          }),
        )
      }
      result.push(...itemChildren)
    }
    return result
  }

  private createListNumbering(node: MdNode, activeDepth: number): string {
    let suffix = this.numbering.length + 1
    let reference = `markscript-list-${suffix}`
    while (this.numberingReferences.has(reference)) {
      suffix += 1
      reference = `markscript-list-${suffix}`
    }
    this.numberingReferences.add(reference)

    const ordered = node.ordered === true
    const start = ordered && typeof node.start === 'number' ? node.start : 1
    const levelOptions: ILevelsOptions[] = []
    for (let level = 0; level < 9; level += 1) {
      const current = level === activeDepth
      levelOptions.push({
        level,
        format: current && ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
        text:
          current && ordered
            ? `%${level + 1}.`
            : (BULLETS[level % BULLETS.length] ?? '•'),
        start: current ? start : 1,
        alignment: AlignmentType.START,
        style: {
          paragraph: {
            indent: {left: 720 * (level + 1), hanging: 360},
          },
        },
      })
    }
    this.numbering.push({reference, levels: levelOptions})
    return reference
  }

  private async renderTable(node: MdNode, path: string): Promise<Table> {
    const alignments = Array.isArray(node.align) ? node.align : []
    const rows: TableRow[] = []
    for (const [rowIndex, row] of (node.children ?? []).entries()) {
      if (row.type !== 'tableRow') {
        throw this.error(
          'DOCX_TABLE_ROW',
          'A table can contain only tableRow nodes',
          `${path}.children[${rowIndex}]`,
          row,
        )
      }
      const cells: TableCell[] = []
      for (const [cellIndex, cell] of (row.children ?? []).entries()) {
        if (cell.type !== 'tableCell') {
          throw this.error(
            'DOCX_TABLE_CELL',
            'A table row can contain only tableCell nodes',
            `${path}.children[${rowIndex}].children[${cellIndex}]`,
            cell,
          )
        }
        const alignment = tableAlignment(alignments[cellIndex])
        const paragraphDefaults: Record<string, unknown> = {}
        if (alignment !== undefined) paragraphDefaults.alignment = alignment
        const paragraph = await this.renderParagraph(
          cell,
          `${path}.children[${rowIndex}].children[${cellIndex}]`,
          paragraphDefaults,
          [],
          rowIndex === 0 ? {bold: true} : {},
        )
        cells.push(
          new TableCell({
            ...(this.cellOptions(cell) as Omit<ITableCellOptions, 'children'>),
            children: [paragraph],
          }),
        )
      }
      rows.push(
        new TableRow({
          tableHeader: rowIndex === 0,
          ...(this.rowOptions(row) as Omit<ITableRowOptions, 'children'>),
          children: cells,
        }),
      )
    }
    return new Table({
      ...(this.tableOptions(node) as Omit<ITableOptions, 'rows'>),
      rows,
    })
  }

  private async renderInlineChildren(
    node: MdNode,
    path: string,
    style: InlineStyle,
  ): Promise<ParagraphChild[]> {
    const result: ParagraphChild[] = []
    for (const [index, child] of (node.children ?? []).entries()) {
      result.push(
        ...(await this.renderInline(
          child,
          `${path}.children[${index}]`,
          style,
        )),
      )
    }
    return result
  }

  private async renderInline(
    node: MdNode,
    path: string,
    inherited: InlineStyle,
  ): Promise<ParagraphChild[]> {
    const metadata = docxData(node)
    const style = {...inherited, ...this.runOptions(node)}

    if (metadata?.rawXml !== undefined) {
      return [this.rawInline(metadata.rawXml, path, node)]
    }
    if (metadata?.field !== undefined) {
      return this.bookmarkedChildren(
        node,
        [this.renderField(metadata.field, textContent(node), path, node)],
        path,
      )
    }
    if (metadata?.reference !== undefined) {
      const reference = requireRecord(
        metadata.reference,
        `${path}.data.docx.reference`,
      )
      const target = stringFrom(reference.target)
      if (target === undefined) {
        throw this.error(
          'DOCX_REFERENCE_TARGET',
          'data.docx.reference.target must be a string',
          `${path}.data.docx.reference.target`,
          node,
        )
      }
      return [
        this.renderField(
          {
            kind: 'reference',
            target,
            cached: stringFrom(reference.cached) ?? textContent(node),
          },
          textContent(node),
          path,
          node,
        ),
      ]
    }

    const tab =
      metadata?.tab === true
        ? [new TextRun({...style, children: [new Tab()]})]
        : []
    const pageBreak = metadata?.pageBreak === true ? [new PageBreak()] : []

    let body: ParagraphChild[]
    switch (node.type) {
      case 'text':
        body = [
          new TextRun({...style, text: stringProperty(node, 'value') ?? ''}),
        ]
        break
      case 'emphasis':
        body = await this.renderInlineChildren(node, path, {
          ...inherited,
          italics: true,
          ...this.runOptions(node),
        })
        break
      case 'strong':
        body = await this.renderInlineChildren(node, path, {
          ...inherited,
          bold: true,
          ...this.runOptions(node),
        })
        break
      case 'delete':
        body = await this.renderInlineChildren(node, path, {
          ...inherited,
          strike: true,
          ...this.runOptions(node),
        })
        break
      case 'inlineCode':
        body = [
          new TextRun({
            ...(asRecord(metadata?.run) === undefined
              ? {font: 'Courier New', shading: {fill: 'F3F4F6'}}
              : {}),
            ...style,
            text: stringProperty(node, 'value') ?? '',
          }),
        ]
        break
      case 'break':
        body = [new TextRun({break: 1, ...style})]
        break
      case 'link':
        body = [await this.renderLink(node, path, style)]
        break
      case 'linkReference':
        body = [await this.renderLinkReference(node, path, style)]
        break
      case 'image':
        body = [await this.renderImage(node, path)]
        break
      case 'imageReference':
        body = [await this.renderImageReference(node, path)]
        break
      case 'footnoteReference':
        body = [this.renderFootnoteReference(node, path)]
        break
      case 'textDirective':
      case 'leafDirective':
        body = await this.renderInlineChildren(node, path, style)
        break
      case 'html':
        body = this.renderInlineHtml(node, path, style)
        break
      default:
        throw this.error(
          'DOCX_INLINE_NODE',
          `Unsupported inline MDAST node ${JSON.stringify(node.type)}`,
          path,
          node,
        )
    }
    if (
      tab.length > 0 &&
      node.type === 'textDirective' &&
      node.name === 'docx-tab'
    ) {
      return tab
    }
    return this.bookmarkedChildren(node, [...pageBreak, ...tab, ...body], path)
  }

  private async renderLink(
    node: MdNode,
    path: string,
    style: InlineStyle,
  ): Promise<InternalHyperlink | ExternalHyperlink> {
    const url = stringProperty(node, 'url')
    if (url === undefined) {
      throw this.error('DOCX_LINK_URL', 'A link requires a URL', path, node)
    }
    const children = await this.renderInlineChildren(node, path, style)
    if (url.startsWith('#')) {
      const anchor = decodeAnchor(url.slice(1), path, node)
      validateBookmark(anchor, path, node)
      return new InternalHyperlink({anchor, children})
    }
    return new ExternalHyperlink({link: url, children})
  }

  private async renderLinkReference(
    node: MdNode,
    path: string,
    style: InlineStyle,
  ): Promise<InternalHyperlink | ExternalHyperlink> {
    const definition = this.resolveDefinition(node, path)
    const url = stringProperty(definition, 'url')
    if (url === undefined) {
      throw this.error(
        'DOCX_LINK_DEFINITION',
        'A referenced link definition requires a URL',
        path,
        node,
      )
    }
    const children = await this.renderInlineChildren(node, path, style)
    if (url.startsWith('#')) {
      const anchor = decodeAnchor(url.slice(1), path, node)
      validateBookmark(anchor, path, node)
      return new InternalHyperlink({anchor, children})
    }
    return new ExternalHyperlink({link: url, children})
  }

  private async renderImage(node: MdNode, path: string): Promise<ImageRun> {
    const source = stringProperty(node, 'url')
    if (source === undefined) {
      throw this.error('DOCX_IMAGE_URL', 'An image requires a URL', path, node)
    }
    return this.imageRun(
      node,
      source,
      stringProperty(node, 'alt') ?? '',
      stringProperty(node, 'title'),
      path,
    )
  }

  private async renderImageReference(
    node: MdNode,
    path: string,
  ): Promise<ImageRun> {
    const definition = this.resolveDefinition(node, path)
    const source = stringProperty(definition, 'url')
    if (source === undefined) {
      throw this.error(
        'DOCX_IMAGE_DEFINITION',
        'A referenced image definition requires a URL',
        path,
        node,
      )
    }
    return this.imageRun(
      node,
      source,
      stringProperty(node, 'alt') ?? '',
      stringProperty(definition, 'title'),
      path,
    )
  }

  private async imageRun(
    node: MdNode,
    source: string,
    alt: string,
    title: string | undefined,
    path: string,
  ): Promise<ImageRun> {
    const resolved = await this.resolveImage(source, node, path)
    const imageData = asRecord(docxData(node)?.image)
    const fallbackSource = imageData?.fallback
    if (fallbackSource !== undefined && typeof fallbackSource !== 'string') {
      throw this.error(
        'DOCX_IMAGE_FALLBACK',
        'data.docx.image.fallback must be a PNG/JPEG data URL or resource source',
        `${path}.data.docx.image.fallback`,
        node,
      )
    }
    const direct = cleanOptions(imageData, ['data', 'fallback', 'type'])
    const directTransformation = asRecord(direct.transformation)
    const directWidth = finitePositive(directTransformation?.width)
    const directHeight = finitePositive(directTransformation?.height)
    const transformation = {
      ...directTransformation,
      width:
        directWidth ??
        (directHeight === undefined
          ? resolved.width
          : (resolved.width * directHeight) / resolved.height),
      height:
        directHeight ??
        (directWidth === undefined
          ? resolved.height
          : (resolved.height * directWidth) / resolved.width),
    }
    validateDimensions(
      transformation,
      `${path}.data.docx.image.transformation`,
      node,
    )
    const altText = direct.altText ?? {
      name: alt || source,
      description: alt,
      ...(title === undefined ? {} : {title}),
    }
    const shared = {...direct, transformation, altText}

    if (resolved.type === 'svg') {
      const directFallback =
        fallbackSource === undefined
          ? undefined
          : await this.resolveImage(
              fallbackSource,
              node,
              `${path}.data.docx.image.fallback`,
            )
      if (
        directFallback !== undefined &&
        directFallback.type !== 'png' &&
        directFallback.type !== 'jpg'
      ) {
        throw this.error(
          'DOCX_IMAGE_FALLBACK',
          'An SVG fallback source must resolve to PNG or JPEG',
          `${path}.data.docx.image.fallback`,
          node,
        )
      }
      const fallback =
        directFallback ??
        resolved.fallback ??
        rasterizeSvg(resolved.data, path, node)
      return new ImageRun({
        ...shared,
        type: 'svg',
        data: resolved.data,
        fallback: {type: fallback.type, data: fallback.data},
      } as IImageOptions)
    }
    if (fallbackSource !== undefined) {
      throw this.error(
        'DOCX_IMAGE_FALLBACK',
        'data.docx.image.fallback is accepted only for an SVG image',
        `${path}.data.docx.image.fallback`,
        node,
      )
    }
    return new ImageRun({
      ...shared,
      type: resolved.type,
      data: resolved.data,
    } as IImageOptions)
  }

  private async resolveImage(
    source: string,
    node: MdNode,
    path: string,
  ): Promise<DocxResolvedImage> {
    let resolved: DocxResolvedImage
    try {
      if (source.startsWith('data:')) {
        resolved = imageFromDataUrl(source, path, node)
      } else if (this.options.resolveResource !== undefined) {
        resolved = await this.options.resolveResource(source, {
          kind: 'image',
          node: node as never,
        })
      } else {
        resolved = imageFromDataUrl(source, path, node)
      }
    } catch (error) {
      throw preserveWriterError(
        error,
        'DOCX_IMAGE_RESOLVE',
        `Could not resolve image resource ${JSON.stringify(source)}`,
        path,
      )
    }
    validateResolvedImage(resolved, path, node)
    return resolved
  }

  private renderFootnoteReference(
    node: MdNode,
    path: string,
  ): FootnoteReferenceRun {
    const identifier = stringProperty(node, 'identifier')
    if (identifier === undefined) {
      throw this.error(
        'DOCX_FOOTNOTE_IDENTIFIER',
        'A footnoteReference requires an identifier',
        path,
        node,
      )
    }
    const normalized = normalizeIdentifier(identifier)
    if (!this.footnoteDefinitions.has(normalized)) {
      throw this.error(
        'DOCX_FOOTNOTE_MISSING',
        `No footnoteDefinition exists for ${JSON.stringify(identifier)}`,
        path,
        node,
      )
    }
    let id = this.footnoteIds.get(normalized)
    if (id === undefined) {
      id = this.footnoteIds.size + 1
      this.footnoteIds.set(normalized, id)
    }
    return new FootnoteReferenceRun(id)
  }

  private renderField(
    value: unknown,
    fallback: string,
    path: string,
    node: MdNode,
  ): SimpleField {
    const field = requireRecord(value, `${path}.data.docx.field`)
    const kind = stringFrom(field.kind)
    const cached = stringFrom(field.cached) ?? fallback
    let instruction: string
    switch (kind) {
      case 'pageNumber':
        instruction = 'PAGE'
        break
      case 'pageCount':
        instruction = 'NUMPAGES'
        break
      case 'date':
        instruction = stringFrom(field.instruction) ?? 'DATE'
        break
      case 'sequence': {
        const sequence = stringFrom(field.sequence)
        validateFieldIdentifier(sequence, 'sequence', path, node)
        instruction = `SEQ ${sequence}`
        break
      }
      case 'reference': {
        const target = stringFrom(field.target)
        validateFieldIdentifier(target, 'reference target', path, node)
        instruction = `REF ${target} \\h`
        break
      }
      case 'custom': {
        const custom = stringFrom(field.instruction)
        if (custom === undefined || custom.trim().length === 0) {
          throw this.error(
            'DOCX_FIELD_INSTRUCTION',
            'A custom DOCX field requires a non-empty instruction',
            path,
            node,
          )
        }
        instruction = custom
        break
      }
      default:
        throw this.error(
          'DOCX_FIELD_KIND',
          `Unsupported DOCX field kind ${JSON.stringify(kind)}`,
          path,
          node,
        )
    }
    if (hasControlCharacter(instruction)) {
      throw this.error(
        'DOCX_FIELD_INSTRUCTION',
        'DOCX field instructions cannot contain control characters',
        path,
        node,
      )
    }
    this.fieldsNeedUpdate = true
    return new SimpleField(instruction, cached)
  }

  private tocEntries(
    value: unknown,
    path: string,
    node: MdNode,
  ): readonly {title: string; level: number; href?: string}[] {
    if (value === undefined) return []
    if (!Array.isArray(value)) {
      throw this.error(
        'DOCX_TOC_CACHE',
        'data.docx.toc.cachedHeadings must be an array',
        path,
        node,
      )
    }
    return value.map((rawEntry, index) => {
      const entry = requireRecord(rawEntry, `${path}[${index}]`)
      const title = stringFrom(entry.text)
      const level = entry.depth
      const href = stringFrom(entry.target)
      if (
        title === undefined ||
        typeof level !== 'number' ||
        !Number.isInteger(level) ||
        level < 1 ||
        level > 9
      ) {
        throw this.error(
          'DOCX_TOC_CACHE',
          'Each cached TOC heading requires string text and an integer depth from 1 through 9',
          `${path}[${index}]`,
          node,
        )
      }
      if (href !== undefined)
        validateBookmark(href, `${path}[${index}].target`, node)
      return {title, level, ...(href === undefined ? {} : {href})}
    })
  }

  private resolveDefinition(node: MdNode, path: string): MdNode {
    const identifier = stringProperty(node, 'identifier')
    if (identifier === undefined) {
      throw this.error(
        'DOCX_REFERENCE_IDENTIFIER',
        `${node.type} requires an identifier`,
        path,
        node,
      )
    }
    const definition = this.definitions.get(normalizeIdentifier(identifier))
    if (definition === undefined) {
      throw this.error(
        'DOCX_REFERENCE_MISSING',
        `No definition exists for ${JSON.stringify(identifier)}`,
        path,
        node,
      )
    }
    return definition
  }

  private rawBlock(value: unknown, path: string, node: MdNode): FileChild {
    const component = this.importRaw(value, 'block', path, node)
    return new ImportedFileChild(component)
  }

  private rawInline(
    value: unknown,
    path: string,
    node: MdNode,
  ): ParagraphChild {
    const component = this.importRaw(value, 'inline', path, node)
    return new ImportedParagraphChild(component) as ParagraphChild
  }

  private importRaw(
    value: unknown,
    expected: 'block' | 'inline',
    path: string,
    node: MdNode,
  ): ImportedXmlComponent {
    const data = requireRecord(value, `${path}.data.docx.rawXml`)
    const context = stringFrom(data.context)
    const xml = stringFrom(data.xml)
    if (context !== expected) {
      throw this.error(
        'DOCX_RAW_CONTEXT',
        `Raw OOXML with context ${JSON.stringify(context)} cannot be used in ${expected} content`,
        `${path}.data.docx.rawXml.context`,
        node,
      )
    }
    if (xml === undefined || xml.trim().length === 0) {
      throw this.error(
        'DOCX_RAW_XML',
        'Raw OOXML requires a non-empty xml string',
        `${path}.data.docx.rawXml.xml`,
        node,
      )
    }
    try {
      return importedXmlRoot(xml)
    } catch (error) {
      throw new DocxWriterError(
        'DOCX_RAW_XML',
        'Raw OOXML could not be imported',
        {
          path: `${path}.data.docx.rawXml.xml`,
          cause: error,
        },
      )
    }
  }

  private renderBlockHtml(node: MdNode, path: string): FileChild[] {
    const value = stringProperty(node, 'value') ?? ''
    if (/^\s*<br\s*\/?>\s*$/iu.test(value)) {
      return [new Paragraph({children: [new TextRun({break: 1})]})]
    }
    this.rejectHtml(node, path)
  }

  private renderInlineHtml(
    node: MdNode,
    path: string,
    style: InlineStyle,
  ): ParagraphChild[] {
    const value = stringProperty(node, 'value') ?? ''
    if (/^\s*<br\s*\/?>\s*$/iu.test(value)) {
      return [new TextRun({...style, break: 1})]
    }
    this.rejectHtml(node, path)
  }

  private rejectHtml(node: MdNode, path: string): never {
    throw this.error(
      'DOCX_HTML',
      'Raw HTML has no implicit Word mapping; transform it to ordinary MDAST or validated data.docx.rawXml first',
      path,
      node,
    )
  }

  private paragraphOptions(
    node: MdNode,
    defaults: Readonly<Record<string, unknown>> = {},
  ): Omit<IParagraphOptions, 'children' | 'text'> {
    return {
      ...defaults,
      ...cleanOptions(docxData(node)?.paragraph, ['children', 'text']),
    } as Omit<IParagraphOptions, 'children' | 'text'>
  }

  private runOptions(
    node: MdNode,
    defaults: Readonly<Record<string, unknown>> = {},
  ): Omit<IRunOptions, 'children' | 'text'> {
    return {
      ...defaults,
      ...cleanOptions(docxData(node)?.run, ['children', 'text']),
    } as Omit<IRunOptions, 'children' | 'text'>
  }

  private tableOptions(node: MdNode): Omit<ITableOptions, 'rows'> {
    return cleanOptions(docxData(node)?.table, ['rows']) as Omit<
      ITableOptions,
      'rows'
    >
  }

  private rowOptions(node: MdNode): Omit<ITableRowOptions, 'children'> {
    return cleanOptions(docxData(node)?.row, ['children']) as Omit<
      ITableRowOptions,
      'children'
    >
  }

  private cellOptions(node: MdNode): Omit<ITableCellOptions, 'children'> {
    return cleanOptions(docxData(node)?.cell, ['children']) as Omit<
      ITableCellOptions,
      'children'
    >
  }

  private bookmarkedChildren(
    node: MdNode,
    children: readonly ParagraphChild[],
    path: string,
  ): ParagraphChild[] {
    const metadata = docxData(node)
    const direct = stringFrom(metadata?.bookmark)
    const caption = stringFrom(asRecord(metadata?.caption)?.bookmark)
    const bibliography = stringFrom(
      asRecord(metadata?.bibliographyEntry)?.bookmark,
    )
    const bookmark = direct ?? caption ?? bibliography
    if (bookmark === undefined) return [...children]
    validateBookmark(bookmark, path, node)
    const numericId = this.nextBookmarkNumericId
    this.nextBookmarkNumericId += 1
    return [
      new BookmarkStart(bookmark, numericId) as ParagraphChild,
      ...children,
      new BookmarkEnd(numericId) as ParagraphChild,
    ]
  }

  private error(
    code: string,
    message: string,
    path: string,
    node?: MdNode,
  ): DocxWriterError {
    const line = node?.position?.start?.line
    const column = node?.position?.start?.column
    const location =
      line === undefined
        ? ''
        : ` (source ${line}${column === undefined ? '' : `:${column}`})`
    return new DocxWriterError(code, `${message}${location}`, {path})
  }
}

function importedXmlRoot(xml: string): ImportedXmlComponent {
  const imported = ImportedXmlComponent.fromXmlString(xml)
  const inspected = imported as unknown as {
    readonly rootKey?: unknown
    readonly root?: readonly unknown[]
  }
  if (typeof inspected.rootKey === 'string' && inspected.rootKey.length > 0) {
    return imported
  }

  // docx 9.7.1 wraps the parsed document in an ImportedXmlComponent whose
  // root key is undefined. Feature-detect and unwrap its one real XML root.
  if (
    inspected.rootKey === undefined &&
    inspected.root?.length === 1 &&
    inspected.root[0] instanceof ImportedXmlComponent
  ) {
    return inspected.root[0]
  }
  throw new TypeError('Imported OOXML did not produce exactly one root element')
}

class ImportedFileChild extends FileChild {
  constructor(private readonly imported: ImportedXmlComponent) {
    super('')
  }

  override prepForXml(context: IContext): IXmlableObject | undefined {
    return this.imported.prepForXml(context)
  }
}

class ImportedParagraphChild extends XmlComponent {
  constructor(private readonly imported: ImportedXmlComponent) {
    super('')
  }

  override prepForXml(context: IContext): IXmlableObject | undefined {
    return this.imported.prepForXml(context)
  }
}

function docxData(node: MdNode): Readonly<Record<string, unknown>> | undefined {
  return asRecord(asRecord(node.data)?.docx)
}

function asRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

function requireRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  const record = asRecord(value)
  if (record === undefined) {
    throw new DocxWriterError('DOCX_DATA', `${path} must be an object`, {path})
  }
  return record
}

function copyRecord(value: unknown): Record<string, unknown> {
  return {...asRecord(value)}
}

function cleanOptions(
  value: unknown,
  omitted: readonly string[],
): Record<string, unknown> {
  const result = copyRecord(value)
  for (const key of omitted) delete result[key]
  return result
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function stringProperty(node: MdNode, key: string): string | undefined {
  return stringFrom(node[key])
}

function numberProperty(node: MdNode, key: string): number | undefined {
  const value = node[key]
  return typeof value === 'number' && Number.isInteger(value)
    ? value
    : undefined
}

function walk(node: MdNode, callback: (node: MdNode) => void): void {
  callback(node)
  for (const child of node.children ?? []) walk(child, callback)
}

function textContent(node: MdNode): string {
  if (typeof node.value === 'string') return node.value
  return (node.children ?? []).map((child) => textContent(child)).join('')
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().replace(/\s+/gu, ' ').toLowerCase()
}

function sectionRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (typeof value === 'string') {
    throw new DocxWriterError(
      'DOCX_SECTION_UNRESOLVED',
      `Named section ${JSON.stringify(value)} was not resolved to plain data`,
      {path},
    )
  }
  return requireRecord(value, path)
}

function mergeSectionData(
  defaults: Readonly<Record<string, unknown>> | undefined,
  next: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (defaults === undefined) return next
  return {
    ...defaults,
    ...next,
    properties: {
      ...asRecord(defaults.properties),
      ...asRecord(next.properties),
    },
  }
}

function sectionBreakType(
  value: unknown,
  path: string,
): ISectionPropertiesOptions['type'] {
  if (value === 'nextPage') return SectionType.NEXT_PAGE
  if (value === 'continuous') return SectionType.CONTINUOUS
  if (value === 'evenPage') return SectionType.EVEN_PAGE
  if (value === 'oddPage') return SectionType.ODD_PAGE
  throw new DocxWriterError(
    'DOCX_SECTION_BREAK',
    `${path} must be continuous, nextPage, evenPage, or oddPage`,
    {path},
  )
}

function isSectionMarker(node: MdNode): boolean {
  return (
    (node.type === 'leafDirective' && node.name === 'docx-section') ||
    (node.type === 'paragraph' &&
      (node.children?.length ?? 0) === 0 &&
      docxData(node)?.section !== undefined)
  )
}

function isSpecialMarker(node: MdNode, name: string): boolean {
  return (
    (node.type === 'leafDirective' && node.name === name) ||
    (name === 'docx-page-break' &&
      node.type === 'paragraph' &&
      (node.children?.length ?? 0) === 0 &&
      docxData(node)?.pageBreak === true)
  )
}

function isTransparentFlowContainer(node: MdNode): boolean {
  if (node.type !== 'containerDirective') return false
  const metadata = docxData(node)
  return (
    metadata?.rawXml === undefined &&
    metadata?.toc === undefined &&
    metadata?.field === undefined &&
    metadata?.pageBreak !== true
  )
}

function tableAlignment(value: unknown): IParagraphOptions['alignment'] {
  if (value === 'left') return AlignmentType.LEFT
  if (value === 'right') return AlignmentType.RIGHT
  if (value === 'center') return AlignmentType.CENTER
  return undefined
}

function validateFieldIdentifier(
  value: string | undefined,
  label: string,
  path: string,
  node: MdNode,
): asserts value is string {
  if (value === undefined || !FIELD_IDENTIFIER.test(value)) {
    const location = node.position?.start?.line
    throw new DocxWriterError(
      'DOCX_FIELD_IDENTIFIER',
      `${label} must be a Word field identifier${location === undefined ? '' : ` (source ${location})`}`,
      {path},
    )
  }
}

function validateBookmark(value: string, path: string, node: MdNode): void {
  if (!BOOKMARK_IDENTIFIER.test(value)) {
    const location = node.position?.start?.line
    throw new DocxWriterError(
      'DOCX_BOOKMARK',
      `Bookmark ${JSON.stringify(value)} is not a valid Word bookmark identifier${location === undefined ? '' : ` (source ${location})`}`,
      {path},
    )
  }
}

function decodeAnchor(value: string, path: string, node: MdNode): string {
  try {
    return decodeURIComponent(value)
  } catch (error) {
    const line = node.position?.start?.line
    throw new DocxWriterError(
      'DOCX_LINK_ANCHOR',
      `Internal link anchor is not valid percent-encoding${line === undefined ? '' : ` (source ${line})`}`,
      {path, cause: error},
    )
  }
}

function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.startsWith('#') ? value.slice(1) : value
}

function validateDimensions(
  transformation: Readonly<Record<string, unknown>>,
  path: string,
  node: MdNode,
): void {
  for (const key of ['width', 'height'] as const) {
    const value = transformation[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      const line = node.position?.start?.line
      throw new DocxWriterError(
        'DOCX_IMAGE_DIMENSIONS',
        `${path}.${key} must be a positive finite number${line === undefined ? '' : ` (source ${line})`}`,
        {path: `${path}.${key}`},
      )
    }
  }
}

function validateResolvedImage(
  image: DocxResolvedImage,
  path: string,
  node: MdNode,
): void {
  if (!asRecord(image) || !(image.data instanceof Uint8Array)) {
    throw new DocxWriterError(
      'DOCX_IMAGE_RESULT',
      'resolveResource must return an image with Uint8Array data',
      {path},
    )
  }
  if (!['png', 'jpg', 'gif', 'bmp', 'svg'].includes(image.type)) {
    throw new DocxWriterError(
      'DOCX_IMAGE_RESULT',
      `resolveResource returned unsupported image type ${JSON.stringify(image.type)}`,
      {path},
    )
  }
  validateDimensions(
    image as unknown as Readonly<Record<string, unknown>>,
    path,
    node,
  )
  if (image.fallback !== undefined) {
    if (
      !(image.fallback.data instanceof Uint8Array) ||
      !['png', 'jpg'].includes(image.fallback.type)
    ) {
      throw new DocxWriterError(
        'DOCX_IMAGE_RESULT',
        'An SVG fallback must contain png or jpg Uint8Array data',
        {path},
      )
    }
  }
}

function imageFromDataUrl(
  source: string,
  path: string,
  node: MdNode,
): DocxResolvedImage {
  if (!source.startsWith('data:')) {
    throw new DocxWriterError(
      'DOCX_RESOURCE_SERVICE',
      `Image ${JSON.stringify(source)} requires DocxWriteOptions.resolveResource`,
      {path},
    )
  }
  const comma = source.indexOf(',')
  if (comma < 5) {
    throw new DocxWriterError('DOCX_DATA_URL', 'Malformed image data URL', {
      path,
    })
  }
  const descriptor = source.slice(5, comma)
  const payload = source.slice(comma + 1)
  const segments = descriptor.split(';')
  const mime = segments[0]?.toLowerCase() ?? ''
  let data: Uint8Array
  try {
    data = segments.includes('base64')
      ? Uint8Array.from(Buffer.from(payload, 'base64'))
      : new TextEncoder().encode(decodeURIComponent(payload))
  } catch (error) {
    throw new DocxWriterError(
      'DOCX_DATA_URL',
      'Malformed image data URL payload',
      {
        path,
        cause: error,
      },
    )
  }
  const type = imageTypeFromMime(mime)
  if (type === undefined) {
    throw new DocxWriterError(
      'DOCX_IMAGE_TYPE',
      `Unsupported image media type ${JSON.stringify(mime)}`,
      {path},
    )
  }
  const dimensions = readImageDimensions(data, type, path, node)
  return {data, type, ...dimensions}
}

function imageTypeFromMime(
  mime: string,
): DocxResolvedImage['type'] | undefined {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'image/bmp') return 'bmp'
  if (mime === 'image/svg+xml') return 'svg'
  return undefined
}

function readImageDimensions(
  data: Uint8Array,
  type: DocxResolvedImage['type'],
  path: string,
  node: MdNode,
): {width: number; height: number} {
  let dimensions: {width: number; height: number} | undefined
  if (type === 'png' && hasPrefix(data, PNG_SIGNATURE) && data.length >= 24) {
    dimensions = {width: uint32be(data, 16), height: uint32be(data, 20)}
  } else if (type === 'gif' && data.length >= 10) {
    dimensions = {width: uint16le(data, 6), height: uint16le(data, 8)}
  } else if (type === 'bmp' && data.length >= 26) {
    dimensions = {
      width: Math.abs(int32le(data, 18)),
      height: Math.abs(int32le(data, 22)),
    }
  } else if (type === 'jpg') {
    dimensions = jpegDimensions(data)
  } else if (type === 'svg') {
    dimensions = svgDimensions(new TextDecoder().decode(data))
  }
  if (
    dimensions === undefined ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    const line = node.position?.start?.line
    throw new DocxWriterError(
      'DOCX_IMAGE_DIMENSIONS',
      `Could not read ${type.toUpperCase()} image dimensions${line === undefined ? '' : ` (source ${line})`}`,
      {path},
    )
  }
  return dimensions
}

function jpegDimensions(
  data: Uint8Array,
): {width: number; height: number} | undefined {
  if (data[0] !== 0xff || data[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = data[offset + 1]
    if (
      marker !== undefined &&
      ((marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf))
    ) {
      return {
        height: uint16be(data, offset + 5),
        width: uint16be(data, offset + 7),
      }
    }
    const length = uint16be(data, offset + 2)
    if (length < 2) return undefined
    offset += length + 2
  }
  return undefined
}

function svgDimensions(
  source: string,
): {width: number; height: number} | undefined {
  const open = /<svg\b([^>]*)>/iu.exec(source)?.[1]
  if (open === undefined) return undefined
  const width = svgLength(attribute(open, 'width'))
  const height = svgLength(attribute(open, 'height'))
  if (width !== undefined && height !== undefined) return {width, height}
  const viewBox = attribute(open, 'viewBox')
    ?.trim()
    .split(/[\s,]+/u)
    .map(Number)
  if (viewBox?.length === 4) {
    const viewWidth = viewBox[2]
    const viewHeight = viewBox[3]
    if (
      viewWidth !== undefined &&
      viewHeight !== undefined &&
      Number.isFinite(viewWidth) &&
      Number.isFinite(viewHeight) &&
      viewWidth > 0 &&
      viewHeight > 0
    ) {
      if (width !== undefined) {
        return {width, height: height ?? (width * viewHeight) / viewWidth}
      }
      if (height !== undefined) {
        return {width: (height * viewWidth) / viewHeight, height}
      }
      return {width: viewWidth, height: viewHeight}
    }
  }
  return undefined
}

function attribute(source: string, name: string): string | undefined {
  const expression = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'iu')
  return expression.exec(source)?.[2]
}

function svgLength(value: string | undefined): number | undefined {
  if (value === undefined || /%\s*$/u.test(value)) return undefined
  const match =
    /^\s*([+]?(?:\d+(?:\.\d*)?|\.\d+))(px|pt|pc|mm|cm|in)?\s*$/iu.exec(value)
  if (match?.[1] === undefined) return undefined
  const number = Number(match[1])
  if (!Number.isFinite(number) || number <= 0) return undefined
  const unit = match[2]?.toLowerCase()
  if (unit === 'pt') return (number * 96) / 72
  if (unit === 'pc') return number * 16
  if (unit === 'mm') return (number * 96) / 25.4
  if (unit === 'cm') return (number * 96) / 2.54
  if (unit === 'in') return number * 96
  return number
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function rasterizeSvg(
  data: Uint8Array,
  path: string,
  node: MdNode,
): NonNullable<DocxResolvedImage['fallback']> {
  try {
    const png = new Resvg(Buffer.from(data), {
      font: {loadSystemFonts: false},
    })
      .render()
      .asPng()
    if (!hasPrefix(png, PNG_SIGNATURE))
      throw new Error('Resvg returned invalid PNG data')
    return {type: 'png', data: Uint8Array.from(png)}
  } catch (error) {
    const line = node.position?.start?.line
    throw new DocxWriterError(
      'DOCX_SVG_FALLBACK',
      `Could not rasterize the SVG fallback${line === undefined ? '' : ` (source ${line})`}`,
      {path, cause: error},
    )
  }
}

function hasPrefix(data: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((value, index) => data[index] === value)
}

function uint16be(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)
}

function uint16le(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8)
}

function uint32be(data: Uint8Array, offset: number): number {
  return (
    (((data[offset] ?? 0) << 24) |
      ((data[offset + 1] ?? 0) << 16) |
      ((data[offset + 2] ?? 0) << 8) |
      (data[offset + 3] ?? 0)) >>>
    0
  )
}

function int32le(data: Uint8Array, offset: number): number {
  return (
    (data[offset] ?? 0) |
    ((data[offset + 1] ?? 0) << 8) |
    ((data[offset + 2] ?? 0) << 16) |
    ((data[offset + 3] ?? 0) << 24)
  )
}

function preserveWriterError(
  error: unknown,
  code: string,
  message: string,
  path?: string,
): DocxWriterError {
  return error instanceof DocxWriterError
    ? error
    : new DocxWriterError(code, message, {
        ...(path === undefined ? {} : {path}),
        cause: error,
      })
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) return true
  }
  return false
}

function outputPath(output: string | URL): string {
  if (output instanceof URL) {
    if (output.protocol !== 'file:') {
      throw new DocxWriterError(
        'DOCX_OUTPUT_URL',
        `DOCX output URL must use file:, received ${JSON.stringify(output.protocol)}`,
      )
    }
    return fileURLToPath(output)
  }
  if (output.length === 0) {
    throw new DocxWriterError(
      'DOCX_OUTPUT_PATH',
      'DOCX output path cannot be empty',
    )
  }
  return resolve(output)
}

async function writeAtomically(
  target: string,
  data: Uint8Array,
): Promise<void> {
  const directory = dirname(target)
  const temporary = resolve(
    directory,
    `.${basename(target)}.${randomUUID()}.tmp`,
  )
  try {
    await mkdir(directory, {recursive: true})
    await writeFile(temporary, data, {flag: 'wx'})
    await rename(temporary, target)
  } catch (error) {
    throw new DocxWriterError(
      'DOCX_OUTPUT_WRITE',
      `Could not atomically write DOCX output ${JSON.stringify(target)}`,
      {path: target, cause: error},
    )
  } finally {
    await rm(temporary, {force: true}).catch(() => undefined)
  }
}
