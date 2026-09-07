import type {} from '@markscript/mdast-util-mdx-directive'
import type {
  Heading,
  Nodes,
  Parent,
  PhrasingContent,
  Root,
  RootContent,
  Text,
} from 'mdast'
import {
  clonePlain,
  docxData,
  isRecord,
  plainText,
  replaceChild,
  visitMutable,
} from './tree.ts'
import type {
  DocxBibliographyRecord,
  DocxBibliographySource,
  DocxCaptionData,
  DocxData,
  DocxDocumentConfig,
  DocxSectionData,
} from './types.ts'

interface Target {
  bookmark: string
  cached: string
}

interface BibliographyEntry {
  record: DocxBibliographyRecord
  number?: number
  bookmark?: string
}

interface BibliographyState {
  name: string
  entries: Map<string, BibliographyEntry>
  sourceOrder: string[]
  citedOrder: string[]
}

interface NormalizedBibliography {
  sources: Map<string, BibliographyState>
  defaultSource?: string
}

const DOCX_DIRECTIVES = new Set([
  'paragraph',
  'cite',
  'docx-page-break',
  'docx-tab',
  'docx-field',
  'docx-section',
  'docx-toc',
  'docx-caption',
  'docx-ref',
  'docx-citation',
  'docx-bibliography',
])

/**
 * Resolves document-wide Word semantics into readable MDAST and plain
 * `data.docx` values. Functions and named configuration never enter the tree.
 */
export async function resolveDocx(
  root: Root,
  config: DocxDocumentConfig = {},
): Promise<void> {
  materializeDocxDirectives(root)
  const usedBookmarks = new Set<string>()
  const explicitBookmarks = seedBookmarks(root, usedBookmarks)
  resolveDocumentConfig(root, config)
  resolveSections(root, config.sections ?? {})
  await resolveBibliography(root, config, usedBookmarks)

  const {targets, headings} = resolveCaptionsAndHeadings(
    root,
    usedBookmarks,
    explicitBookmarks,
  )
  resolveReferences(root, targets)
  resolveTocs(root, headings)

  visitMutable(root, ({node, path}) => {
    if (node.data?.docx === undefined) return
    if (!isRecord(node.data.docx)) {
      throw new TypeError(`${path}.data.docx must be a plain object`)
    }
    node.data.docx = clonePlain(node.data.docx, `${path}.data.docx`)
  })
}

function materializeDocxDirectives(root: Root): void {
  visitMutable(root, ({node, parent, index, path}) => {
    const directiveNode =
      (node.type === 'leafDirective' ||
        node.type === 'containerDirective' ||
        node.type === 'textDirective') &&
      DOCX_DIRECTIVES.has(node.name)
        ? node
        : undefined
    if (directiveNode) {
      applyDocxDirective(
        node,
        directiveNode.name,
        directiveNode.attributes ?? {},
        path,
      )
    }
    for (const [name, attributes] of Object.entries(node.data ?? {})) {
      if (!DOCX_DIRECTIVES.has(name) || !isRecord(attributes)) continue
      applyDocxDirective(node, name, attributes, path)
      delete node.data?.[name]
    }
    if (directiveNode) {
      normalizeDocxDirective(
        directiveNode,
        parent,
        index,
        directiveNode.name,
        directiveNode.name === 'paragraph' ? {} : docxData(node),
      )
    }
  })
}

function applyDocxDirective(
  node: Nodes,
  name: string,
  attributes: DirectiveAttributes,
  path: string,
): void {
  if (name === 'paragraph') return
  const data = docxData(node)
  switch (name) {
    case 'docx-page-break':
      data.pageBreak ??= true
      return
    case 'docx-tab':
      data.tab ??= true
      return
    case 'docx-field': {
      if (data.field !== undefined) return
      const kind = stringAttribute(attributes, 'kind', path)
      if (
        kind !== 'pageNumber' &&
        kind !== 'pageCount' &&
        kind !== 'date' &&
        kind !== 'sequence' &&
        kind !== 'reference' &&
        kind !== 'custom'
      ) {
        throw new TypeError(
          `${path}: docx-field kind must be pageNumber, pageCount, date, sequence, reference, or custom`,
        )
      }
      const instruction = stringAttribute(attributes, 'instruction', path)
      const target = stringAttribute(attributes, 'target', path)
      const sequence = stringAttribute(attributes, 'sequence', path)
      data.field = {
        kind,
        cached:
          stringAttribute(attributes, 'cached', path) ??
          (plainText(node) || '?'),
        ...(instruction === undefined ? {} : {instruction}),
        ...(target === undefined ? {} : {target}),
        ...(sequence === undefined ? {} : {sequence}),
      }
      return
    }
    case 'docx-section': {
      if (data.section !== undefined) return
      const name =
        stringAttribute(attributes, 'section', path) ??
        stringAttribute(attributes, 'name', path)
      const breakBefore = stringAttribute(attributes, 'breakBefore', path)
      if (
        breakBefore !== undefined &&
        breakBefore !== 'continuous' &&
        breakBefore !== 'nextPage' &&
        breakBefore !== 'evenPage' &&
        breakBefore !== 'oddPage'
      ) {
        throw new TypeError(
          `${path}: docx-section breakBefore must be continuous, nextPage, evenPage, or oddPage`,
        )
      }
      if (name === undefined && breakBefore === undefined) {
        throw new TypeError(
          `${path}: docx-section requires section or breakBefore`,
        )
      }
      data.section =
        breakBefore === undefined && name !== undefined
          ? name
          : {
              ...(name === undefined ? {} : {name}),
              ...(breakBefore === undefined ? {} : {breakBefore}),
            }
      return
    }
    case 'docx-toc': {
      if (data.toc !== undefined) return
      const toc: Record<string, string | boolean> = {}
      for (const key of [
        'captionLabel',
        'entriesFromBookmark',
        'captionLabelIncludingNumbers',
        'sequenceAndPageNumbersSeparator',
        'tcFieldIdentifier',
        'tcFieldLevelRange',
        'pageNumbersEntryLevelsRange',
        'headingStyleRange',
        'entryAndPageNumberSeparator',
        'seqFieldIdentifierForPrefix',
      ]) {
        const value = stringAttribute(attributes, key, path)
        if (value !== undefined) toc[key] = value
      }
      for (const key of [
        'hyperlink',
        'useAppliedParagraphOutlineLevel',
        'preserveTabInEntries',
        'preserveNewLineInEntries',
        'hideTabAndPageNumbersInWebView',
      ]) {
        const value = booleanAttribute(attributes, key, path)
        if (value !== undefined) toc[key] = value
      }
      data.toc = toc as NonNullable<DocxData['toc']>
      return
    }
    case 'docx-caption': {
      if (data.caption !== undefined) return
      const id = requiredStringAttribute(attributes, 'id', path)
      const kind = stringAttribute(attributes, 'kind', path) ?? 'figure'
      const label =
        stringAttribute(attributes, 'label', path) ?? titleCase(kind)
      const reset = integerAttribute(attributes, 'resetAtHeading', path)
      data.caption = {
        id,
        kind,
        label,
        ...(reset === undefined ? {} : {resetAtHeading: reset}),
      }
      return
    }
    case 'docx-ref': {
      if (data.reference !== undefined) return
      data.reference = {
        target: requiredStringAttribute(attributes, 'target', path),
      }
      return
    }
    case 'cite':
    case 'docx-citation': {
      if (data.citation !== undefined) return
      const rawKeys =
        stringAttribute(attributes, 'keys', path) ?? plainText(node)
      const keys = rawKeys
        .split(/[;,]/u)
        .map((key) => key.trim().replace(/^@/u, ''))
        .filter((key) => key.length > 0)
      if (keys.length === 0) {
        throw new TypeError(`${path}: docx-citation requires at least one key`)
      }
      const source = stringAttribute(attributes, 'source', path)
      data.citation = {
        keys,
        ...(source === undefined ? {} : {source}),
      }
      if (name === 'cite') {
        data.run = {...data.run, superScript: true}
      }
      return
    }
    case 'docx-bibliography': {
      if (data.bibliography !== undefined) return
      const source = stringAttribute(attributes, 'source', path)
      const title =
        stringAttribute(attributes, 'title', path) ??
        (plainText(node) || 'References')
      const headingDepth = integerAttribute(attributes, 'headingDepth', path)
      const includeUncited =
        booleanAttribute(attributes, 'includeUncited', path) ?? false
      data.bibliography = {
        ...(source === undefined ? {} : {source}),
        title,
        includeUncited,
        ...(headingDepth === undefined
          ? {}
          : {headingDepth: headingDepth as 1 | 2 | 3 | 4 | 5 | 6}),
      }
      return
    }
    default:
      return
  }
}

function normalizeDocxDirective(
  directiveNode: Nodes | undefined,
  parent: Parent | undefined,
  index: number | undefined,
  name: string,
  data: DocxData,
): void {
  if (
    directiveNode === undefined ||
    parent === undefined ||
    index === undefined
  )
    return

  if (name === 'paragraph' && directiveNode.type === 'leafDirective') {
    replaceChild(parent, index, [
      {
        type: 'paragraph',
        children: [],
        ...(directiveNode.data === undefined ? {} : {data: directiveNode.data}),
        ...(directiveNode.position === undefined
          ? {}
          : {position: directiveNode.position}),
      },
    ])
    return
  }

  if (directiveNode.type === 'textDirective') {
    const children =
      directiveNode.children.length === 0
        ? ([{type: 'text', value: ''}] as PhrasingContent[])
        : directiveNode.children
    attachDirectiveData(children[0], directiveNode, data)
    replaceChild(parent, index, children)
    return
  }

  if (directiveNode.type === 'containerDirective') {
    const children = directiveNode.children
    if (children.length > 0) {
      attachDirectiveData(children[0], directiveNode, data)
      replaceChild(parent, index, children)
      return
    }
  }

  const paragraph: RootContent = {
    type: 'paragraph',
    children:
      name === 'docx-page-break' || name === 'docx-section'
        ? []
        : directiveNode.type === 'leafDirective'
          ? directiveNode.children
          : [],
    ...(directiveNode.data === undefined ? {} : {data: directiveNode.data}),
    ...(directiveNode.position === undefined
      ? {}
      : {position: directiveNode.position}),
  }
  replaceChild(parent, index, [paragraph])
}

function attachDirectiveData(
  target: Nodes | undefined,
  directiveNode: Nodes,
  data: DocxData,
): void {
  if (target === undefined) return
  const targetDocx = target.data?.docx
  if (isRecord(targetDocx)) Object.assign(data, targetDocx)
  target.data = {...directiveNode.data, ...target.data, docx: data}
}

function seedBookmarks(root: Root, used: Set<string>): WeakMap<object, string> {
  const owners = new WeakMap<object, string>()
  visitMutable(root, ({node, path}) => {
    const metadata = node.data?.docx
    const candidates = [
      metadata?.bookmark,
      metadata?.caption?.bookmark,
      metadata?.bibliographyEntry?.bookmark,
    ].filter((value): value is string => value !== undefined)
    if (candidates.length === 0) return
    const unique = new Set(candidates)
    if (unique.size !== 1) {
      throw new RangeError(
        `${path}.data.docx contains conflicting bookmark values`,
      )
    }
    const bookmark = candidates[0] as string
    if (
      typeof bookmark !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_.-]{0,39}$/u.test(bookmark)
    ) {
      throw new TypeError(
        `${path}.data.docx.bookmark is not a valid Word bookmark`,
      )
    }
    if (used.has(bookmark)) {
      throw new RangeError(
        `${path}.data.docx.bookmark duplicates ${JSON.stringify(bookmark)}`,
      )
    }
    used.add(bookmark)
    owners.set(node, bookmark)
  })
  return owners
}

function resolveDocumentConfig(root: Root, config: DocxDocumentConfig): void {
  const existing = root.data?.docx
  if (existing !== undefined && !isRecord(existing)) {
    throw new TypeError('$.data.docx must be a plain object')
  }
  if (config.document !== undefined) {
    const data = docxData(root)
    data.document = {
      ...(data.document === undefined
        ? {}
        : clonePlain(data.document, '$.data.docx.document')),
      ...clonePlain(config.document, 'hookDocx.document'),
    }
  }
  if (config.defaultSection !== undefined) {
    docxData(root).defaultSection = resolveSection(
      config.defaultSection,
      config.sections ?? {},
      'hookDocx.defaultSection',
    )
  }
}

function resolveSections(
  root: Root,
  sections: Readonly<Record<string, DocxSectionData>>,
): void {
  const rootDefault = root.data?.docx?.defaultSection
  if (rootDefault !== undefined) {
    docxData(root).defaultSection = resolveSection(
      rootDefault,
      sections,
      '$.data.docx.defaultSection',
    )
  }
  visitMutable(root, ({node, path}) => {
    const section = node.data?.docx?.section
    if (section === undefined) return
    docxData(node).section = resolveSection(
      section,
      sections,
      `${path}.data.docx.section`,
    )
  })
}

function resolveSection(
  value: string | DocxSectionData,
  sections: Readonly<Record<string, DocxSectionData>>,
  path: string,
): DocxSectionData {
  if (typeof value === 'string') {
    const named = sections[value]
    if (named === undefined) {
      throw new RangeError(
        `${path} names unknown DOCX section ${JSON.stringify(value)}`,
      )
    }
    return clonePlain(named, `hookDocx.sections.${value}`)
  }
  if (!isRecord(value))
    throw new TypeError(`${path} must be a section name or object`)
  const local = clonePlain(value, path) as DocxSectionData
  const name = local.name
  if (name === undefined) return local
  if (sections[name] === undefined) {
    if (
      local.properties === undefined &&
      local.headers === undefined &&
      local.footers === undefined
    ) {
      throw new RangeError(
        `${path} names unknown DOCX section ${JSON.stringify(name)}`,
      )
    }
    return local
  }
  const base = clonePlain(
    sections[name],
    `hookDocx.sections.${name}`,
  ) as DocxSectionData
  return {
    ...base,
    ...local,
    ...(base.properties === undefined && local.properties === undefined
      ? {}
      : {properties: {...base.properties, ...local.properties}}),
  }
}

function resolveCaptionsAndHeadings(
  root: Root,
  usedBookmarks: Set<string>,
  explicitBookmarks: WeakMap<object, string>,
): {
  targets: Map<string, Target>
  headings: {depth: number; text: string; target: string}[]
} {
  const targets = new Map<string, Target>()
  const headings: {depth: number; text: string; target: string}[] = []
  const headingEpoch = [0, 0, 0, 0, 0, 0, 0]
  const counters = new Map<string, number>()
  let headingSerial = 0

  visitMutable(root, ({node, path}) => {
    if (node.type === 'heading') {
      headingSerial += 1
      for (let depth = node.depth; depth <= 6; depth += 1) {
        headingEpoch[depth] = headingSerial
      }
      const text = plainText(node)
      const requested = node.data?.docx?.bookmark
      const bookmark =
        explicitBookmarks.get(node) ??
        reserveBookmark(
          requested ?? `docx-heading-${headingSerial}`,
          usedBookmarks,
        )
      docxData(node).bookmark = bookmark
      headings.push({depth: node.depth, text, target: bookmark})
      targets.set(bookmark, {bookmark, cached: text})
      const sourceId = node.data?.id
      if (
        typeof sourceId === 'string' &&
        sourceId.length > 0 &&
        sourceId !== bookmark
      ) {
        registerTarget(targets, sourceId, {bookmark, cached: text}, path)
      }
    }

    const rawCaption = node.data?.docx?.caption
    if (rawCaption === undefined) return
    if (!isRecord(rawCaption)) {
      throw new TypeError(`${path}.data.docx.caption must be an object`)
    }
    const caption = clonePlain(
      rawCaption,
      `${path}.data.docx.caption`,
    ) as DocxCaptionData
    requireNonempty(caption.id, `${path}.data.docx.caption.id`)
    requireNonempty(caption.kind, `${path}.data.docx.caption.kind`)
    requireNonempty(caption.label, `${path}.data.docx.caption.label`)
    const resetDepth = caption.resetAtHeading
    if (
      resetDepth !== undefined &&
      (!Number.isInteger(resetDepth) || resetDepth < 1 || resetDepth > 6)
    ) {
      throw new RangeError(
        `${path}.data.docx.caption.resetAtHeading must be 1 through 6`,
      )
    }
    const scope = resetDepth === undefined ? 0 : headingEpoch[resetDepth]
    const counterKey = `${caption.kind}\u0000${scope}`
    const number = (counters.get(counterKey) ?? 0) + 1
    counters.set(counterKey, number)
    const bookmark =
      explicitBookmarks.get(node) ??
      reserveBookmark(`docx-caption-${caption.id}`, usedBookmarks)
    const resolved = {...caption, number, bookmark}
    docxData(node).caption = resolved
    updateCaptionText(node, resolved)
    registerTarget(
      targets,
      caption.id,
      {bookmark, cached: `${caption.label} ${number}`},
      path,
    )
    targets.set(bookmark, {bookmark, cached: `${caption.label} ${number}`})
  })
  return {targets, headings}
}

function resolveReferences(
  root: Root,
  targets: ReadonlyMap<string, Target>,
): void {
  visitMutable(root, ({node, path}) => {
    const raw = node.data?.docx?.reference
    if (raw === undefined) return
    if (!isRecord(raw) || typeof raw.target !== 'string') {
      throw new TypeError(
        `${path}.data.docx.reference requires a string target`,
      )
    }
    const target = targets.get(raw.target)
    if (target === undefined) {
      throw new RangeError(
        `${path}.data.docx.reference names unknown target ${JSON.stringify(raw.target)}`,
      )
    }
    const current = plainText(node)
    const cached =
      current.length === 0 || current === 'Reference ?'
        ? target.cached
        : current
    docxData(node).reference = {
      target: target.bookmark,
      cached,
      bookmark: target.bookmark,
    }
    if (node.type === 'link') node.url = `#${target.bookmark}`
    if (current.length === 0 || current === 'Reference ?')
      setReadableText(node, cached)
  })
}

function resolveTocs(
  root: Root,
  headings: readonly {depth: number; text: string; target: string}[],
): void {
  visitMutable(root, ({node, path}) => {
    const toc = node.data?.docx?.toc
    if (toc === undefined) return
    if (!isRecord(toc))
      throw new TypeError(`${path}.data.docx.toc must be an object`)
    const depths = tocHeadingDepths(toc.headingStyleRange, path)
    docxData(node).toc = {
      ...clonePlain(toc, `${path}.data.docx.toc`),
      cachedHeadings: headings
        .filter((heading) => depths === undefined || depths.has(heading.depth))
        .map((heading) => ({...heading})),
    }
  })
}

function tocHeadingDepths(
  value: unknown,
  path: string,
): Set<number> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(
      `${path}.data.docx.toc.headingStyleRange must be a range string`,
    )
  }
  const depths = new Set<number>()
  for (const rawPart of value.split(',')) {
    const match = /^\s*([1-9])(?:-([1-9]))?\s*$/u.exec(rawPart)
    if (match === null) {
      throw new TypeError(
        `${path}.data.docx.toc.headingStyleRange must contain depths 1 through 9`,
      )
    }
    const start = Number(match[1])
    const end = Number(match[2] ?? match[1])
    if (end < start) {
      throw new TypeError(
        `${path}.data.docx.toc.headingStyleRange ranges must be ascending`,
      )
    }
    for (let depth = start; depth <= end; depth += 1) depths.add(depth)
  }
  return depths
}

async function resolveBibliography(
  root: Root,
  config: DocxDocumentConfig,
  usedBookmarks: Set<string>,
): Promise<void> {
  const bibliography = normalizeBibliography(config.bibliography)
  const citations: {
    node: Nodes
    parent?: Parent
    index?: number
    path: string
  }[] = []
  visitMutable(root, ({node, parent, index, path}) => {
    if (node.data?.docx?.citation !== undefined)
      citations.push({
        node: node as Nodes,
        ...(parent === undefined ? {} : {parent}),
        ...(index === undefined ? {} : {index}),
        path,
      })
  })

  for (const {node, parent, index, path} of citations) {
    const raw = node.data?.docx?.citation
    if (!isRecord(raw) || !Array.isArray(raw.keys) || raw.keys.length === 0) {
      throw new TypeError(
        `${path}.data.docx.citation requires a non-empty keys array`,
      )
    }
    const keys = raw.keys.map((key, index) => {
      if (typeof key !== 'string' || key.length === 0) {
        throw new TypeError(
          `${path}.data.docx.citation.keys[${index}] must be a string`,
        )
      }
      return key
    })
    const source = selectSource(
      raw.source,
      bibliography,
      `${path}.data.docx.citation.source`,
    )
    const records: DocxBibliographyRecord[] = []
    const numbers: number[] = []
    const bookmarks: string[] = []
    for (const key of keys) {
      const entry = source.entries.get(key)
      if (entry === undefined) {
        throw new RangeError(
          `${path}.data.docx.citation names unknown ${JSON.stringify(key)} in source ${JSON.stringify(source.name)}`,
        )
      }
      assignBibliographyEntry(source, key, entry, usedBookmarks)
      records.push(entry.record)
      numbers.push(entry.number as number)
      bookmarks.push(entry.bookmark as string)
    }
    const useCustomFormatter =
      config.formatCitation !== undefined && keys.length === 1
    const cached =
      useCustomFormatter && config.formatCitation !== undefined
        ? await config.formatCitation(records, numbers)
        : `[${numbers.join(', ')}]`
    if (typeof cached !== 'string') {
      throw new TypeError('hookDocx.formatCitation must return a string')
    }
    docxData(node).citation = {
      keys,
      source: source.name,
      numbers,
      bookmarks,
      cached,
    }
    setCitationContent(
      node,
      parent,
      index,
      cached,
      numbers,
      bookmarks,
      useCustomFormatter,
    )
  }

  await expandBibliographyMarkers(
    root,
    '$',
    bibliography,
    config,
    usedBookmarks,
    new Set(),
  )
}

async function expandBibliographyMarkers(
  parent: Parent,
  path: string,
  bibliography: NormalizedBibliography,
  config: DocxDocumentConfig,
  usedBookmarks: Set<string>,
  expanded: Set<string>,
): Promise<void> {
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index]
    if (child === undefined) continue
    const childPath = `${path}.children[${index}]`
    const marker = child.data?.docx?.bibliography
    if (marker !== undefined) {
      if (!isRecord(marker)) {
        throw new TypeError(
          `${childPath}.data.docx.bibliography must be an object`,
        )
      }
      const source = selectSource(
        marker.source,
        bibliography,
        `${childPath}.data.docx.bibliography.source`,
      )
      if (expanded.has(source.name)) {
        throw new RangeError(
          `${childPath}: bibliography source ${JSON.stringify(source.name)} is already emitted`,
        )
      }
      expanded.add(source.name)
      if (marker.includeUncited === true) {
        for (const key of source.sourceOrder) {
          const entry = source.entries.get(key)
          if (entry !== undefined)
            assignBibliographyEntry(source, key, entry, usedBookmarks)
        }
      }
      const depth = marker.headingDepth ?? 1
      if (!Number.isInteger(depth) || depth < 1 || depth > 6) {
        throw new RangeError(
          `${childPath}.data.docx.bibliography.headingDepth must be 1 through 6`,
        )
      }
      const title =
        typeof marker.title === 'string' ? marker.title : 'References'
      const replacement: RootContent[] = []
      if (title.length > 0) {
        replacement.push({
          type: 'heading',
          depth: depth as Heading['depth'],
          children: [{type: 'text', value: title}],
        })
      }
      for (const key of source.citedOrder) {
        const entry = source.entries.get(key)
        if (entry?.number === undefined || entry.bookmark === undefined)
          continue
        const value =
          config.formatBibliographyEntry === undefined
            ? defaultBibliographyEntry(entry.record, entry.number)
            : await config.formatBibliographyEntry(entry.record, entry.number)
        if (typeof value !== 'string') {
          throw new TypeError(
            'hookDocx.formatBibliographyEntry must return a string',
          )
        }
        replacement.push({
          type: 'paragraph',
          children: [{type: 'text', value}],
          data: {
            docx: {
              bibliographyEntry: {
                key,
                number: entry.number,
                bookmark: entry.bookmark,
              },
            },
          },
        })
      }
      ;(parent.children as RootContent[]).splice(index, 1, ...replacement)
      index += replacement.length - 1
      continue
    }
    if ('children' in child && Array.isArray(child.children)) {
      await expandBibliographyMarkers(
        child,
        childPath,
        bibliography,
        config,
        usedBookmarks,
        expanded,
      )
    }
  }
}

function assignBibliographyEntry(
  source: BibliographyState,
  key: string,
  entry: BibliographyEntry,
  usedBookmarks: Set<string>,
): void {
  if (entry.number !== undefined) return
  entry.number = source.citedOrder.length + 1
  entry.bookmark = reserveBookmark(
    `docx-bib-${source.name}-${key}`,
    usedBookmarks,
  )
  source.citedOrder.push(key)
}

function normalizeBibliography(
  input: DocxDocumentConfig['bibliography'],
): NormalizedBibliography {
  if (input === undefined) return {sources: new Map()}
  let sourcesInput: Readonly<Record<string, DocxBibliographySource>>
  let defaultSource: string | undefined
  if (Array.isArray(input) || isRecordSource(input)) {
    sourcesInput = {main: input as DocxBibliographySource}
    defaultSource = 'main'
  } else if (isRecord(input) && isRecord(input.sources)) {
    sourcesInput = input.sources as Readonly<
      Record<string, DocxBibliographySource>
    >
    if (input.defaultSource !== undefined) {
      if (typeof input.defaultSource !== 'string') {
        throw new TypeError(
          'hookDocx.bibliography.defaultSource must be a string',
        )
      }
      defaultSource = input.defaultSource
    }
  } else if (isRecord(input)) {
    sourcesInput = input as Readonly<Record<string, DocxBibliographySource>>
  } else {
    throw new TypeError(
      'hookDocx.bibliography must contain plain bibliography data',
    )
  }

  const sources = new Map<string, BibliographyState>()
  for (const [name, source] of Object.entries(sourcesInput)) {
    requireNonempty(name, 'hookDocx.bibliography source name')
    sources.set(name, normalizeSource(name, source))
  }
  if (defaultSource !== undefined && !sources.has(defaultSource)) {
    throw new RangeError(
      `hookDocx.bibliography.defaultSource names unknown source ${JSON.stringify(defaultSource)}`,
    )
  }
  if (defaultSource === undefined) {
    if (sources.has('main')) defaultSource = 'main'
    else if (sources.has('default')) defaultSource = 'default'
    else if (sources.size === 1)
      defaultSource = sources.keys().next().value as string
  }
  return {
    sources,
    ...(defaultSource === undefined ? {} : {defaultSource}),
  }
}

function normalizeSource(
  name: string,
  source: DocxBibliographySource,
): BibliographyState {
  const entries = new Map<string, BibliographyEntry>()
  const sourceOrder: string[] = []
  const records: DocxBibliographyRecord[] = Array.isArray(source)
    ? source.map((record, index) =>
        normalizeRecord(record, undefined, `${name}[${index}]`),
      )
    : Object.entries(source).map(([key, record]) =>
        normalizeRecord(record, key, `${name}.${key}`),
      )
  for (const record of records) {
    if (entries.has(record.id)) {
      throw new RangeError(
        `hookDocx.bibliography source ${JSON.stringify(name)} repeats id ${JSON.stringify(record.id)}`,
      )
    }
    entries.set(record.id, {record})
    sourceOrder.push(record.id)
  }
  return {name, entries, sourceOrder, citedOrder: []}
}

function normalizeRecord(
  value: unknown,
  key: string | undefined,
  path: string,
): DocxBibliographyRecord {
  if (!isRecord(value))
    throw new TypeError(`hookDocx.bibliography.${path} must be an object`)
  const record = clonePlain(value, `hookDocx.bibliography.${path}`)
  const id = key ?? record.id
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError(
      `hookDocx.bibliography.${path}.id must be a non-empty string`,
    )
  }
  if (typeof record.title !== 'string' || record.title.length === 0) {
    throw new TypeError(
      `hookDocx.bibliography.${path}.title must be a non-empty string`,
    )
  }
  return {...record, id} as DocxBibliographyRecord
}

function isRecordSource(value: unknown): boolean {
  if (!isRecord(value)) return false
  const values = Object.values(value)
  return (
    values.length === 0 ||
    values.every(
      (record) => isRecord(record) && typeof record.title === 'string',
    )
  )
}

function selectSource(
  requested: unknown,
  bibliography: NormalizedBibliography,
  path: string,
): BibliographyState {
  if (requested !== undefined && typeof requested !== 'string') {
    throw new TypeError(`${path} must be a string`)
  }
  const name = requested ?? bibliography.defaultSource
  if (name === undefined) {
    throw new RangeError(
      `${path} is required when more than one bibliography source exists`,
    )
  }
  const source = bibliography.sources.get(name)
  if (source === undefined) {
    throw new RangeError(`${path} names unknown source ${JSON.stringify(name)}`)
  }
  return source
}

function defaultBibliographyEntry(
  record: DocxBibliographyRecord,
  number: number,
): string {
  const author = record.author === undefined ? '' : `${record.author}. `
  const issued = record.issued === undefined ? '' : ` (${record.issued}).`
  const container =
    record.containerTitle === undefined ? '' : ` ${record.containerTitle}.`
  const publisher =
    record.publisher === undefined ? '' : ` ${record.publisher}.`
  const url = record.url === undefined ? '' : ` ${record.url}`
  return `[${number}] ${author}${record.title}.${issued}${container}${publisher}${url}`
    .replace(/\.\./gu, '.')
    .trim()
}

function updateCaptionText(
  node: Nodes | Root,
  caption: Required<Pick<DocxCaptionData, 'label' | 'number'>>,
): void {
  if (!('children' in node) || !Array.isArray(node.children)) return
  const prefix = `${caption.label} ${caption.number} — `
  const first = node.children[0]
  if (first?.type === 'text') {
    const pattern = new RegExp(
      `^${escapeRegExp(caption.label)} (?:\\?|\\d+) — `,
      'u',
    )
    if (pattern.test(first.value)) {
      first.value = first.value.replace(pattern, prefix)
      return
    }
  }
  ;(node.children as PhrasingContent[]).unshift({type: 'text', value: prefix})
}

function setReadableText(node: Nodes, value: string): void {
  if ('value' in node && typeof node.value === 'string') {
    node.value = value
    return
  }
  if ('children' in node && Array.isArray(node.children)) {
    ;(node.children as PhrasingContent[]).splice(0, node.children.length, {
      type: 'text',
      value,
    } as Text)
  }
}

function setCitationContent(
  node: Nodes,
  parent: Parent | undefined,
  index: number | undefined,
  cached: string,
  numbers: readonly number[],
  bookmarks: readonly string[],
  custom: boolean,
): void {
  const children: PhrasingContent[] = []
  if (custom) {
    const bookmark = bookmarks[0]
    if (bookmark === undefined) {
      children.push({type: 'text', value: cached})
    } else {
      children.push({
        type: 'link',
        url: `#${bookmark}`,
        children: [{type: 'text', value: cached}],
      })
    }
  } else {
    children.push({type: 'text', value: '['})
    for (const [index, number] of numbers.entries()) {
      if (index > 0) children.push({type: 'text', value: ', '})
      const bookmark = bookmarks[index]
      children.push(
        bookmark === undefined
          ? {type: 'text', value: String(number)}
          : {
              type: 'link',
              url: `#${bookmark}`,
              children: [{type: 'text', value: String(number)}],
            },
      )
    }
    children.push({type: 'text', value: ']'})
  }
  if ('children' in node && Array.isArray(node.children)) {
    ;(node.children as PhrasingContent[]).splice(
      0,
      node.children.length,
      ...children,
    )
    return
  }
  if (parent === undefined || index === undefined) {
    if ('value' in node && typeof node.value === 'string') node.value = cached
    return
  }

  const run = node.data?.docx?.run
  for (const [childIndex, child] of children.entries()) {
    child.data =
      childIndex === 0
        ? node.data
        : run === undefined
          ? child.data
          : {docx: {run: clonePlain(run)}}
  }
  const currentIndex = parent.children.indexOf(
    node as Parent['children'][number],
  )
  replaceChild(parent, currentIndex < 0 ? index : currentIndex, children)
}

function registerTarget(
  targets: Map<string, Target>,
  id: string,
  target: Target,
  path: string,
): void {
  if (targets.has(id)) {
    throw new RangeError(
      `${path} repeats DOCX reference target ${JSON.stringify(id)}`,
    )
  }
  targets.set(id, target)
}

function reserveBookmark(requested: string, used: Set<string>): string {
  let base = requested.replace(/[^A-Za-z0-9_.-]/gu, '-')
  if (!/^[A-Za-z_]/u.test(base)) base = `b-${base}`
  base = base.slice(0, 40) || 'bookmark'
  let result = base
  let suffix = 2
  while (used.has(result)) {
    const tail = `-${suffix}`
    result = `${base.slice(0, 40 - tail.length)}${tail}`
    suffix += 1
  }
  used.add(result)
  return result
}

function requireNonempty(
  value: unknown,
  path: string,
): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`)
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

type DirectiveAttributes = Readonly<Record<string, unknown>>

function stringAttribute(
  attributes: DirectiveAttributes,
  name: string,
  path: string,
): string | undefined {
  const value = attributes[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new TypeError(
      `${path}: directive attribute ${name} requires a string value`,
    )
  }
  return value
}

function requiredStringAttribute(
  attributes: DirectiveAttributes,
  name: string,
  path: string,
): string {
  const value = stringAttribute(attributes, name, path)
  if (value === undefined || value.length === 0) {
    throw new TypeError(
      `${path}: directive attribute ${name} must be non-empty`,
    )
  }
  return value
}

function booleanAttribute(
  attributes: DirectiveAttributes,
  name: string,
  path: string,
): boolean | undefined {
  const value = attributes[name]
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (value === null || value === '' || value === 'true') return true
  if (value === 'false') return false
  throw new TypeError(
    `${path}: directive attribute ${name} must be true or false`,
  )
}

function integerAttribute(
  attributes: DirectiveAttributes,
  name: string,
  path: string,
): number | undefined {
  const value =
    typeof attributes[name] === 'number'
      ? attributes[name]
      : stringAttribute(attributes, name, path)
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    throw new TypeError(
      `${path}: directive attribute ${name} must be an integer`,
    )
  }
  return parsed
}

function titleCase(value: string): string {
  return value.length === 0
    ? 'Caption'
    : `${value[0]?.toUpperCase()}${value.slice(1)}`
}
