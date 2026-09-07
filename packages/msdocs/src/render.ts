import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import type {Element, Nodes as HastNodes, Root as HastRoot} from 'hast'
import {toHtml} from 'hast-util-to-html'
import {type Handler, toHast} from 'mdast-util-to-hast'
import {render} from 'squirrelly'
import type {SiteDefinition, SitePage} from './model.ts'
import {pageOutputPath, sitePages} from './model.ts'

interface TemplateNavigationPage {
  readonly current: boolean
  readonly href: string
  readonly title: string
}

interface TemplateTableOfContentsItem {
  readonly depthClass: string
  readonly href: string
  readonly title: string
}

interface PageTemplateData {
  readonly bodyClass: string
  readonly content: string
  readonly hasSiteNavigation: boolean
  readonly home: TemplateNavigationPage
  readonly homeUrl: string
  readonly pageTitle: string
  readonly scriptUrl: string
  readonly sections: readonly {
    readonly pages: readonly TemplateNavigationPage[]
    readonly title: string
  }[]
  readonly siteTitle: string
  readonly stylesUrl: string
  readonly tableOfContents: readonly TemplateTableOfContentsItem[]
}

let templatePromise: Promise<string> | undefined

const omitUnknownNode: Handler = () => undefined

export async function renderSitePage(
  site: SiteDefinition,
  page: SitePage,
): Promise<string> {
  const outputPath = pageOutputPath(page.path)
  const outputPaths = new Set(
    sitePages(site).map(({path: pagePath}) => pageOutputPath(pagePath)),
  )
  const tree = toHast(page.root, {
    unknownHandler: omitUnknownNode,
    ...site.mdastToHast,
  }) as HastRoot
  prepareContent(tree, outputPath, outputPaths)
  const template = await pageTemplate()
  const rendered = render(template, templateData(site, page, outputPath, tree))
  if (typeof rendered !== 'string') {
    throw new Error('Squirrelly returned a non-text page result')
  }
  return rendered.endsWith('\n') ? rendered : `${rendered}\n`
}

export async function readPublicFile(relativePath: string): Promise<Buffer> {
  if (!isPublicPath(relativePath)) {
    throw new Error(
      `Invalid msdocs public path ${JSON.stringify(relativePath)}`,
    )
  }
  let lastError: unknown
  for (const directory of publicDirectoryCandidates()) {
    try {
      return await readFile(path.join(directory, ...relativePath.split('/')))
    } catch (error) {
      lastError = error
      if (!isMissingFileError(error)) throw error
    }
  }
  throw new Error(`Packaged msdocs public file is missing: ${relativePath}`, {
    cause: lastError,
  })
}

function templateData(
  site: SiteDefinition,
  current: SitePage,
  currentOutputPath: string,
  tree: HastRoot,
): PageTemplateData {
  const hasSiteNavigation = sitePages(site).length > 1
  const tableOfContents = pageTableOfContents(tree)
  return {
    bodyClass: [
      hasSiteNavigation ? 'has-site-navigation' : '',
      tableOfContents.length > 0 ? 'has-page-toc' : '',
    ]
      .filter(Boolean)
      .join(' '),
    content: `${toHtml(tree)}\n`,
    hasSiteNavigation,
    home: navigationPage(site.home, current, currentOutputPath),
    homeUrl: relativeUrl(currentOutputPath, pageOutputPath(site.home.path)),
    pageTitle: current.title,
    scriptUrl: relativeUrl(currentOutputPath, 'assets/msdocs.js'),
    sections: site.sections.map((section) => ({
      title: section.title,
      pages: section.pages.map((page) =>
        navigationPage(page, current, currentOutputPath),
      ),
    })),
    siteTitle: site.title,
    stylesUrl: relativeUrl(currentOutputPath, 'assets/msdocs.css'),
    tableOfContents,
  }
}

function pageTableOfContents(tree: HastRoot): TemplateTableOfContentsItem[] {
  const items: TemplateTableOfContentsItem[] = []
  visit(tree, (element) => {
    if (element.tagName !== 'h2' && element.tagName !== 'h3') return
    const id = element.properties.id
    const title = textContent(element).trim()
    if (typeof id !== 'string' || title === '') return
    items.push({
      depthClass: `toc-${element.tagName}`,
      href: `#${id}`,
      title,
    })
  })
  return items
}

function navigationPage(
  page: SitePage,
  current: SitePage,
  currentOutputPath: string,
): TemplateNavigationPage {
  return {
    current: page.path === current.path,
    href: relativeUrl(currentOutputPath, pageOutputPath(page.path)),
    title: page.title,
  }
}

function prepareContent(
  root: HastRoot,
  currentOutputPath: string,
  outputPaths: ReadonlySet<string>,
): void {
  const usedIds = new Set(['content', 'site-navigation'])
  visit(root, (element) => {
    const id = element.properties.id
    if (typeof id === 'string') usedIds.add(id)
  })
  visit(root, (element) => {
    if (element.tagName === 'a') {
      rewriteMappedSourceHref(element, currentOutputPath, outputPaths)
    }
    if (/^h[1-6]$/u.test(element.tagName)) assignHeadingId(element, usedIds)
  })
}

function rewriteMappedSourceHref(
  element: Element,
  currentOutputPath: string,
  outputPaths: ReadonlySet<string>,
): void {
  const href = element.properties.href
  if (
    typeof href !== 'string' ||
    href.startsWith('/') ||
    href.startsWith('#') ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(href) ||
    href.startsWith('//')
  ) {
    return
  }
  const match = /^([^?#]+\.(?:md|ms))([?#].*)?$/u.exec(href)
  if (match === null) return
  const sourcePath = match[1]
  if (sourcePath === undefined) return
  const target = path.posix
    .normalize(
      path.posix.join(path.posix.dirname(currentOutputPath), sourcePath),
    )
    .replace(/\.(?:md|ms)$/u, '.html')
  if (!outputPaths.has(target)) return
  element.properties.href = `${relativeUrl(currentOutputPath, target)}${match[2] ?? ''}`
}

function assignHeadingId(element: Element, usedIds: Set<string>): void {
  if (typeof element.properties.id === 'string') return
  const base =
    textContent(element)
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'section'
  let id = base
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  usedIds.add(id)
  element.properties.id = id
}

function textContent(node: HastNodes): string {
  if (node.type === 'text') return node.value
  if ('children' in node) return node.children.map(textContent).join('')
  return ''
}

function visit(node: HastNodes, visitor: (element: Element) => void): void {
  if (node.type === 'element') visitor(node)
  if ('children' in node) {
    for (const child of node.children) visit(child, visitor)
  }
}

function relativeUrl(fromOutputPath: string, toOutputPath: string): string {
  const relative = path.posix.relative(
    path.posix.dirname(fromOutputPath),
    toOutputPath,
  )
  return relative === '' ? path.posix.basename(toOutputPath) : relative
}

function pageTemplate(): Promise<string> {
  templatePromise ??= readPublicFile('page.squirrelly').then((value) =>
    value.toString('utf8'),
  )
  return templatePromise
}

function publicDirectoryCandidates(): string[] {
  return [
    fileURLToPath(new URL('../public/', import.meta.url)),
    fileURLToPath(new URL('../../public/', import.meta.url)),
  ]
}

function isPublicPath(value: string): boolean {
  return (
    value !== '' &&
    !value.startsWith('/') &&
    value
      .split('/')
      .every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  )
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
