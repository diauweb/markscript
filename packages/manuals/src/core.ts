import type {ListItem, Nodes, PhrasingContent, Root, RootContent} from 'mdast'

export const MANUAL_CATEGORIES = [
  'tutorials',
  'handbooks',
  'diagnostics',
] as const

export type ManualCategory = (typeof MANUAL_CATEGORIES)[number]
export type ArticleManualCategory = Exclude<ManualCategory, 'diagnostics'>
export type DiagnosticKind = 'syntax' | 'error' | 'suggestion'
export type DiagnosticPrefix = 'SYN' | 'ERR' | 'SUG'
export type DiagnosticCode = `${DiagnosticPrefix}${number}`
export type ArticlePrefix = 'TUT' | 'HBK'
export type ArticleManualCode = `${ArticlePrefix}${number}`
export type ManualPageCode = DiagnosticCode | ArticleManualCode
export type ManualIndexSelector = '' | ManualCategory
export type ManualPageSelector = ManualPageCode
export type ManualSelector = ManualIndexSelector | ManualPageSelector

export interface ManualSection {
  readonly title?: string
  readonly text: string
}

interface ManualEntryBase {
  readonly kind: 'page'
  readonly selector: ManualPageSelector
  readonly category: ManualCategory
  readonly title: string
  readonly sections: readonly ManualSection[]
  readonly documentationUrl: string
}

export interface DiagnosticManualEntry extends ManualEntryBase {
  readonly selector: DiagnosticCode
  readonly category: 'diagnostics'
  readonly code: DiagnosticCode
  readonly diagnosticKind: DiagnosticKind
  readonly problem?: string
  readonly fix?: string
}

export interface ArticleManualEntry extends ManualEntryBase {
  readonly selector: ArticleManualCode
  readonly category: ArticleManualCategory
  readonly code: ArticleManualCode
}

export type ManualEntry = DiagnosticManualEntry | ArticleManualEntry

export interface DiagnosticManualPage extends DiagnosticManualEntry {
  readonly root: Root
}

export interface ArticleManualPage extends ArticleManualEntry {
  readonly root: Root
}

export type ManualPage = DiagnosticManualPage | ArticleManualPage

export interface ManualIndex {
  readonly kind: 'index'
  readonly selector: ManualIndexSelector
  readonly category?: ManualCategory
  readonly title: string
  readonly entries: readonly ManualEntry[]
  readonly documentationUrl: string
  readonly root: Root
}

export type ManualDocument = ManualPage | ManualIndex

export interface ManualPageInput {
  readonly category: ManualCategory
  readonly key: string
  readonly root: Root
  readonly documentationUrl: string
}

export interface ManualDocumentationLocations {
  readonly root: string
  readonly categories: Readonly<Record<ManualCategory, string>>
}

export type ManualLookupResult =
  | {
      readonly found: true
      readonly requested: string
      readonly selector: ManualSelector
      readonly manual: ManualDocument
    }
  | {
      readonly found: false
      readonly requested: string
      readonly normalized: string
      readonly reason: 'invalid-selector' | 'unknown-manual'
      readonly category?: ManualCategory
    }

export interface ManualCatalog {
  readonly manualsBySelector: Readonly<Record<string, ManualDocument>>
  getManual(requested: string): ManualDocument | undefined
  lookupManual(requested: string): ManualLookupResult
  listManuals(category?: ManualCategory): ManualPage[]
  manualDocumentationUrl(requested: string): string | undefined
  isManualSelector(value: unknown): value is ManualSelector
}

export const DIAGNOSTIC_CODE_PATTERN = /^(?:SYN|ERR|SUG)\d{4}$/u
export const ARTICLE_CODE_PATTERN = /^(?:TUT|HBK)\d{4}$/u
export const MANUAL_PAGE_CODE_PATTERN = /^(?:SYN|ERR|SUG|TUT|HBK)\d{4}$/u

export function isDiagnosticCodePattern(
  value: unknown,
): value is DiagnosticCode {
  return typeof value === 'string' && DIAGNOSTIC_CODE_PATTERN.test(value)
}

export function isArticleCodePattern(
  value: unknown,
): value is ArticleManualCode {
  return typeof value === 'string' && ARTICLE_CODE_PATTERN.test(value)
}

export function isManualPageCodePattern(
  value: unknown,
): value is ManualPageCode {
  return typeof value === 'string' && MANUAL_PAGE_CODE_PATTERN.test(value)
}

export function isManualCategory(value: unknown): value is ManualCategory {
  return (
    typeof value === 'string' &&
    (MANUAL_CATEGORIES as readonly string[]).includes(value)
  )
}

export function normalizeManualSelector(
  requested: string,
): ManualSelector | undefined {
  const trimmed = requested.trim()
  if (trimmed === '') return ''

  const lower = trimmed.toLowerCase()
  if (isManualCategory(lower)) return lower

  const pageCode = trimmed.toUpperCase()
  return isManualPageCodePattern(pageCode) ? pageCode : undefined
}

export function isManualSelectorPattern(
  value: unknown,
): value is ManualSelector {
  return typeof value === 'string' && normalizeManualSelector(value) === value
}

export function parseManualPage(input: ManualPageInput): ManualPage {
  const {category, key, root, documentationUrl} = input
  if (!isManualCategory(category)) {
    fail(`${category}/${key}`, 'category is unsupported')
  }

  const [titleNode] = root.children
  if (titleNode?.type !== 'heading' || titleNode.depth !== 1) {
    fail(`${category}/${key}`, 'first node must be the manual H1 identity')
  }
  const heading = phrasingText(titleNode.children).trim()
  if (heading === '') fail(`${category}/${key}`, 'H1 title is required')

  const sections = parseSections(root.children.slice(1))
  if (category === 'diagnostics') {
    if (!isDiagnosticCodePattern(key)) {
      fail(key, 'filename must use SYN####, ERR####, or SUG####')
    }
    const match = /^(SYN\d{4}|ERR\d{4}|SUG\d{4}) — (.+)$/u.exec(heading)
    if (match === null || match[1] !== key || match[2]?.trim() === '') {
      fail(key, `H1 must be \`${key} — Title\``)
    }

    const problem = sections.find(
      (section) => section.title === 'Problem',
    )?.text
    const fix = sections.find((section) => section.title === 'Fix')?.text
    return Object.freeze({
      kind: 'page',
      selector: key,
      category,
      code: key,
      diagnosticKind: diagnosticKindForCode(key),
      title: match[2]?.trim() ?? '',
      sections,
      ...(problem === undefined ? {} : {problem}),
      ...(fix === undefined ? {} : {fix}),
      documentationUrl,
      root,
    })
  }

  if (!isArticleCodePattern(key)) {
    fail(`${category}/${key}`, 'filename must use TUT#### or HBK####')
  }
  if (articleCategoryForCode(key) !== category) {
    fail(
      `${category}/${key}`,
      `code prefix belongs to another category; expected ${category}`,
    )
  }
  const match = /^(TUT\d{4}|HBK\d{4}) — (.+)$/u.exec(heading)
  if (match === null || match[1] !== key || match[2]?.trim() === '') {
    fail(key, `H1 must be \`${key} — Title\``)
  }
  return Object.freeze({
    kind: 'page',
    selector: key,
    category,
    code: key,
    title: match[2]?.trim() ?? '',
    sections,
    documentationUrl,
    root,
  })
}

export function createManualIndexes(
  entries: readonly ManualEntry[],
  locations: ManualDocumentationLocations,
): readonly ManualIndex[] {
  const categoryIndexes = MANUAL_CATEGORIES.map((category) => {
    const categoryEntries = entries.filter(
      (entry) => entry.category === category,
    )
    return createIndex(
      category,
      categoryTitle(category),
      categoryEntries,
      locations.categories[category],
    )
  })
  const root = createRootIndex(entries, locations.root)
  return Object.freeze([root, ...categoryIndexes])
}

export function createManualCatalog(
  inputs: readonly ManualPageInput[],
  locations: ManualDocumentationLocations,
): ManualCatalog {
  const pages = inputs.map(parseManualPage)
  const entries = pages.map(stripRoot)
  const indexes = createManualIndexes(entries, locations)
  const table: Record<string, ManualDocument> = Object.create(null)

  for (const document of [...pages, ...indexes]) {
    if (table[document.selector] !== undefined) {
      fail(document.selector, 'duplicate manual selector')
    }
    table[document.selector] = document
  }
  const manualsBySelector = Object.freeze(table)

  const getManual = (requested: string): ManualDocument | undefined => {
    const selector = normalizeManualSelector(requested)
    return selector === undefined ? undefined : manualsBySelector[selector]
  }
  const lookupManual = (requested: string): ManualLookupResult => {
    const selector = normalizeManualSelector(requested)
    if (selector === undefined) {
      return {
        found: false,
        requested,
        normalized: requested.trim(),
        reason: 'invalid-selector',
      }
    }

    const manual = manualsBySelector[selector]
    if (manual !== undefined) return {found: true, requested, selector, manual}
    const category = categoryForSelector(selector)
    return {
      found: false,
      requested,
      normalized: selector,
      reason: 'unknown-manual',
      ...(category === undefined ? {} : {category}),
    }
  }
  const listManuals = (category?: ManualCategory): ManualPage[] =>
    pages
      .filter((page) => category === undefined || page.category === category)
      .map(clonePage)
  const manualDocumentationUrl = (requested: string): string | undefined =>
    getManual(requested)?.documentationUrl
  const isManualSelector = (value: unknown): value is ManualSelector => {
    if (typeof value !== 'string') return false
    const selector = normalizeManualSelector(value)
    return selector === value && manualsBySelector[selector] !== undefined
  }

  return Object.freeze({
    manualsBySelector,
    getManual,
    lookupManual,
    listManuals,
    manualDocumentationUrl,
    isManualSelector,
  })
}

function createRootIndex(
  entries: readonly ManualEntry[],
  documentationUrl: string,
): ManualIndex {
  const children: RootContent[] = [heading(1, 'MarkScript manuals')]
  for (const category of MANUAL_CATEGORIES) {
    children.push({
      type: 'heading',
      depth: 2,
      children: [
        {
          type: 'link',
          url: `./${category}/`,
          children: [{type: 'text', value: categoryTitle(category)}],
        },
      ],
    })
    const categoryEntries = entries.filter(
      (entry) => entry.category === category,
    )
    if (categoryEntries.length > 0) {
      children.push(entryList(categoryEntries, (entry) => pagePath(entry)))
    }
  }

  return Object.freeze({
    kind: 'index',
    selector: '',
    title: 'MarkScript manuals',
    entries: Object.freeze([...entries]),
    documentationUrl,
    root: deepFreeze<Root>({type: 'root', children}),
  })
}

function createIndex(
  category: ManualCategory,
  title: string,
  entries: readonly ManualEntry[],
  documentationUrl: string,
): ManualIndex {
  const children =
    category === 'tutorials'
      ? tutorialIndexChildren(title, entries)
      : categoryIndexChildren(title, entries)
  return Object.freeze({
    kind: 'index',
    selector: category,
    category,
    title,
    entries: Object.freeze([...entries]),
    documentationUrl,
    root: deepFreeze<Root>({type: 'root', children}),
  })
}

function categoryIndexChildren(
  title: string,
  entries: readonly ManualEntry[],
): RootContent[] {
  const children: RootContent[] = [heading(1, title)]
  if (entries.length > 0) {
    children.push(entryList(entries, (entry) => `./${pageKey(entry)}.ms`))
  }
  return children
}

const TUTORIAL_LEVELS = [
  {title: 'Basic', selectors: ['TUT1001', 'TUT1002']},
  {title: 'Intermediate', selectors: ['TUT1003', 'TUT1004']},
  {title: 'Advanced', selectors: ['TUT1005', 'TUT1006']},
] as const

function tutorialIndexChildren(
  title: string,
  entries: readonly ManualEntry[],
): RootContent[] {
  const children: RootContent[] = [
    heading(1, title),
    paragraph(
      'Complete the tutorials in order. Each level uses concepts introduced in the preceding level.',
    ),
  ]
  const included = new Set<string>()

  for (const level of TUTORIAL_LEVELS) {
    const selectors = new Set<string>(level.selectors)
    const levelEntries = entries.filter((entry) => selectors.has(entry.code))
    if (levelEntries.length === 0) continue
    for (const entry of levelEntries) included.add(entry.code)
    children.push(
      heading(2, level.title),
      entryList(levelEntries, (entry) => `./${pageKey(entry)}.ms`),
    )
  }

  const additionalEntries = entries.filter((entry) => !included.has(entry.code))
  if (additionalEntries.length > 0) {
    children.push(
      heading(2, 'Additional tutorials'),
      entryList(additionalEntries, (entry) => `./${pageKey(entry)}.ms`),
    )
  }

  return children
}

function heading(depth: 1 | 2, value: string): RootContent {
  return {type: 'heading', depth, children: [{type: 'text', value}]}
}

function paragraph(value: string): RootContent {
  return {type: 'paragraph', children: [{type: 'text', value}]}
}

function entryList(
  entries: readonly ManualEntry[],
  url: (entry: ManualEntry) => string,
): RootContent {
  const children: ListItem[] = entries.map((entry) => ({
    type: 'listItem',
    spread: false,
    children: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'link',
            url: url(entry),
            children: [{type: 'text', value: entryLabel(entry)}],
          },
        ],
      },
    ],
  }))
  return {type: 'list', ordered: false, spread: false, children}
}

function pagePath(entry: ManualEntry): string {
  return `./${entry.category}/${pageKey(entry)}.ms`
}

function pageKey(entry: ManualEntry): string {
  return entry.code
}

function entryLabel(entry: ManualEntry): string {
  return `${entry.code} — ${entry.title}`
}

function categoryTitle(category: ManualCategory): string {
  switch (category) {
    case 'diagnostics':
      return 'Diagnostics'
    case 'tutorials':
      return 'Tutorials'
    case 'handbooks':
      return 'Handbooks'
  }
}

function categoryForSelector(
  selector: ManualSelector,
): ManualCategory | undefined {
  if (selector === '') return undefined
  if (isManualCategory(selector)) return selector
  if (isDiagnosticCodePattern(selector)) return 'diagnostics'
  return isArticleCodePattern(selector)
    ? articleCategoryForCode(selector)
    : undefined
}

function articleCategoryForCode(
  code: ArticleManualCode,
): ArticleManualCategory {
  return code.startsWith('TUT') ? 'tutorials' : 'handbooks'
}

function parseSections(
  nodes: readonly RootContent[],
): readonly ManualSection[] {
  const sections: ManualSection[] = []
  let title: string | undefined
  let content: RootContent[] = []

  const flush = (): void => {
    if (title === undefined && content.length === 0) return
    sections.push(
      Object.freeze({
        ...(title === undefined ? {} : {title}),
        text: blockText(content),
      }),
    )
  }

  for (const node of nodes) {
    if (node.type === 'heading' && node.depth === 2) {
      flush()
      title = phrasingText(node.children).trim()
      content = []
      continue
    }
    content.push(node)
  }
  flush()
  return Object.freeze(sections)
}

function blockText(nodes: readonly RootContent[]): string {
  return nodes
    .map(nodeText)
    .filter((value) => value !== '')
    .join('\n\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .trim()
}

function phrasingText(children: readonly PhrasingContent[]): string {
  return children.map(phrasingNodeText).join('')
}

function phrasingNodeText(node: PhrasingContent): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return node.value
    case 'break':
      return '\n'
    case 'emphasis':
    case 'strong':
    case 'delete':
    case 'link':
      return phrasingText(node.children)
    default:
      return nodeText(node)
  }
}

function nodeText(node: Nodes): string {
  if (node.type === 'break') return '\n'
  if ('value' in node && typeof node.value === 'string') return node.value
  if ('alt' in node && typeof node.alt === 'string') return node.alt
  if ('children' in node && Array.isArray(node.children)) {
    const separator = isInlineContainer(node.type) ? '' : '\n'
    return node.children.map((child) => nodeText(child)).join(separator)
  }
  return ''
}

function isInlineContainer(type: string): boolean {
  return (
    type === 'paragraph' ||
    type === 'heading' ||
    type === 'emphasis' ||
    type === 'strong' ||
    type === 'delete' ||
    type === 'link'
  )
}

function diagnosticKindForCode(code: DiagnosticCode): DiagnosticKind {
  if (code.startsWith('SYN')) return 'syntax'
  if (code.startsWith('SUG')) return 'suggestion'
  return 'error'
}

function stripRoot(page: ManualPage): ManualEntry {
  const {root: _root, ...entry} = page
  return Object.freeze(entry) as ManualEntry
}

function clonePage(page: ManualPage): ManualPage {
  return {...page}
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function fail(selector: string, problem: string): never {
  throw new Error(`Invalid manual page ${selector}: ${problem}.`)
}
