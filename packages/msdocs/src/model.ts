import type {Root} from 'mdast'
import type {Options as MdastToHastOptions} from 'mdast-util-to-hast'

export type SiteMdastOptions = MdastToHastOptions

export interface SitePage {
  /** URL path without an extension. Empty is home; a trailing slash is an index. */
  readonly path: string
  readonly title: string
  readonly root: Root
}

export interface SiteNavigationSection {
  readonly title: string
  readonly pages: readonly SitePage[]
}

export interface SiteDefinition {
  readonly title: string
  readonly home: SitePage
  readonly sections: readonly SiteNavigationSection[]
  /** Standard mdast-util-to-hast options used for every page. */
  readonly mdastToHast?: SiteMdastOptions
}

export function sitePages(site: SiteDefinition): SitePage[] {
  return [site.home, ...site.sections.flatMap(({pages}) => pages)]
}

export function validateSite(site: SiteDefinition): void {
  if (site.title.trim() === '') throw new Error('Site title is required')
  if (site.home.path !== '')
    throw new Error('The site home page must use path ""')
  for (const section of site.sections) {
    if (section.title.trim() === '') {
      throw new Error('Site navigation section titles are required')
    }
  }

  const paths = new Set<string>()
  const outputs: string[] = []
  const routes = new Set<string>()
  for (const page of sitePages(site)) {
    validatePage(page)
    if (paths.has(page.path)) {
      throw new Error(`Duplicate site page path ${JSON.stringify(page.path)}`)
    }
    paths.add(page.path)
    const output = pageOutputPath(page.path)
    outputs.push(output)

    const route = page.path.endsWith('/') ? page.path.slice(0, -1) : page.path
    if (routes.has(route)) {
      throw new Error(
        `Site pages collide at canonical route ${JSON.stringify(route)}`,
      )
    }
    routes.add(route)
  }
  assertOutputPathsDoNotCollide(outputs)
}

export function assertOutputPathsDoNotCollide(
  outputs: readonly string[],
): void {
  const seen = new Set<string>()
  for (const output of outputs) {
    if (seen.has(output)) {
      throw new Error(
        `Generated outputs collide at path ${JSON.stringify(output)}`,
      )
    }
    seen.add(output)
  }

  for (const file of outputs) {
    const directoryPrefix = `${file}/`
    const child = outputs.find((candidate) =>
      candidate.startsWith(directoryPrefix),
    )
    if (child !== undefined) {
      throw new Error(
        `Generated output ${JSON.stringify(file)} conflicts with directory path ${JSON.stringify(child)}`,
      )
    }
  }
}

export function pageOutputPath(pagePath: string): string {
  if (pagePath === '') return 'index.html'
  if (pagePath.endsWith('/')) return `${pagePath}index.html`
  return `${pagePath}.html`
}

function validatePage(page: SitePage): void {
  if (page.title.trim() === '') {
    throw new Error(`Site page ${JSON.stringify(page.path)} has no title`)
  }
  if (page.root.type !== 'root') {
    throw new Error(
      `Site page ${JSON.stringify(page.path)} must be an MDAST root`,
    )
  }
  if (page.path.startsWith('/') || page.path.includes('\\')) {
    throw new Error(
      `Invalid absolute site page path ${JSON.stringify(page.path)}`,
    )
  }

  const withoutTrailingSlash = page.path.endsWith('/')
    ? page.path.slice(0, -1)
    : page.path
  if (page.path === '') return

  for (const segment of withoutTrailingSlash.split('/')) {
    if (segment === '') {
      throw new Error(`Invalid site page path ${JSON.stringify(page.path)}`)
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment)) {
      throw new Error(`Invalid site page path ${JSON.stringify(page.path)}`)
    }
  }
}
