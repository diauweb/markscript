import {realpath, stat} from 'node:fs/promises'
import path from 'node:path'
import {readBuiltSiteFiles} from './site.ts'

const NOT_FOUND_FILE = '404.html'

export interface ServeSiteOptions {
  readonly directory: string
  readonly hostname?: string
  readonly port?: number
}

export type SiteRequestHandler = (request: Request) => Promise<Response>

interface BuiltSiteState {
  readonly directory: string
  readonly files: ReadonlySet<string>
  readonly routes: ReadonlyMap<string, string>
  readonly redirects: ReadonlyMap<string, string>
}

interface ResolvedFile {
  readonly filename: string
  readonly size: number
}

class UnsafeSiteFileError extends Error {}

export async function serveSite(
  options: ServeSiteOptions,
): Promise<Bun.Server<undefined>> {
  const fetch = await createSiteRequestHandler(options.directory)
  return Bun.serve({
    hostname: options.hostname ?? '127.0.0.1',
    port: options.port ?? 8000,
    fetch,
  })
}

export async function createSiteRequestHandler(
  directory: string,
): Promise<SiteRequestHandler> {
  const site = await loadBuiltSite(directory)
  return (request) => serveRequest(site, request)
}

async function loadBuiltSite(
  requestedDirectory: string,
): Promise<BuiltSiteState> {
  const directory = await realpath(path.resolve(requestedDirectory))
  const files = new Set(await readBuiltSiteFiles(directory))
  if (!files.has(NOT_FOUND_FILE)) {
    throw new Error('Built msdocs manifest is missing the static 404.html page')
  }

  const {routes, redirects} = createRoutes(files)
  const site: BuiltSiteState = {directory, files, routes, redirects}
  const notFound = await resolveAllowedFile(site, NOT_FOUND_FILE)
  if (notFound === undefined) {
    throw new Error('Built msdocs site requires a regular 404.html file')
  }
  return site
}

async function serveRequest(
  site: BuiltSiteState,
  request: Request,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return methodNotAllowedResponse()
  }
  const head = request.method === 'HEAD'
  const url = new URL(request.url)
  const pathname = safeRequestPath(url.pathname)
  if (pathname === undefined) {
    return textResponse('Forbidden\n', 403, head)
  }

  try {
    const redirect = site.redirects.get(pathname)
    if (redirect !== undefined) {
      return redirectResponse(redirectLocation(url, redirect))
    }

    const relative = site.routes.get(pathname)
    if (relative === undefined) return notFoundResponse(site, head)

    const resolved = await resolveAllowedFile(site, relative)
    if (resolved === undefined) return notFoundResponse(site, head)
    return fileResponse(resolved, 200, head)
  } catch (error) {
    if (error instanceof UnsafeSiteFileError) {
      return textResponse('Forbidden\n', 403, head)
    }
    console.error('msdocs preview request failed', error)
    return textResponse('Internal Server Error\n', 500, head)
  }
}

function createRoutes(files: ReadonlySet<string>): {
  routes: ReadonlyMap<string, string>
  redirects: ReadonlyMap<string, string>
} {
  const routes = new Map<string, string>()
  const redirects = new Map<string, string>()

  for (const filename of files) {
    if (filename === 'index.html') {
      addRoute(routes, redirects, '/', filename)
      addRedirect(routes, redirects, '/index.html', '/')
      continue
    }

    if (filename.endsWith('/index.html')) {
      const route = `/${filename.slice(0, -'index.html'.length)}`
      addRoute(routes, redirects, route, filename)
      addRedirect(routes, redirects, route.slice(0, -1), route)
      addRedirect(routes, redirects, `/${filename}`, route)
      continue
    }

    if (filename.endsWith('.html') && filename !== NOT_FOUND_FILE) {
      const route = `/${filename.slice(0, -'.html'.length)}`
      addRoute(routes, redirects, route, filename)
      addRedirect(routes, redirects, `/${filename}`, route)
      continue
    }

    addRoute(routes, redirects, `/${filename}`, filename)
  }

  return {routes, redirects}
}

function addRoute(
  routes: Map<string, string>,
  redirects: ReadonlyMap<string, string>,
  route: string,
  filename: string,
): void {
  if (routes.has(route) || redirects.has(route)) {
    throw new Error(`Built msdocs manifest has a route collision at ${route}`)
  }
  routes.set(route, filename)
}

function addRedirect(
  routes: ReadonlyMap<string, string>,
  redirects: Map<string, string>,
  route: string,
  destination: string,
): void {
  if (routes.has(route) || redirects.has(route)) {
    throw new Error(`Built msdocs manifest has a route collision at ${route}`)
  }
  redirects.set(route, destination)
}

function safeRequestPath(pathname: string): string | undefined {
  if (!pathname.startsWith('/') || /%2f/iu.test(pathname)) return undefined

  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  if (decoded.includes('\\') || hasControlCharacter(decoded)) {
    return undefined
  }
  if (decoded === '/') return decoded

  const body = decoded.endsWith('/') ? decoded.slice(1, -1) : decoded.slice(1)
  const segments = body.split('/')
  if (
    body === '' ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    return undefined
  }
  return decoded
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true
    }
  }
  return false
}

function redirectLocation(url: URL, pathname: string): string {
  const target = new URL(url)
  target.pathname = pathname
  return target.pathname + target.search
}

async function resolveAllowedFile(
  site: BuiltSiteState,
  relative: string,
): Promise<ResolvedFile | undefined> {
  if (!site.files.has(relative)) return undefined

  const candidate = path.join(site.directory, ...relative.split('/'))
  let filename: string
  try {
    filename = await realpath(candidate)
  } catch (error) {
    if (isMissingFileError(error)) return undefined
    throw error
  }

  if (!isContained(site.directory, filename)) {
    throw new UnsafeSiteFileError(
      'Refusing to serve a file outside the built msdocs directory',
    )
  }

  try {
    const metadata = await stat(filename)
    return metadata.isFile() ? {filename, size: metadata.size} : undefined
  } catch (error) {
    if (isMissingFileError(error)) return undefined
    throw error
  }
}

function isContained(directory: string, filename: string): boolean {
  const relative = path.relative(directory, filename)
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

async function notFoundResponse(
  site: BuiltSiteState,
  head: boolean,
): Promise<Response> {
  const resolved = await resolveAllowedFile(site, NOT_FOUND_FILE)
  if (resolved === undefined) {
    return textResponse('Not Found\n', 404, head)
  }
  return fileResponse(resolved, 404, head)
}

function fileResponse(
  resolved: ResolvedFile,
  status: number,
  head: boolean,
): Response {
  const file = Bun.file(resolved.filename)
  const headers = securityHeaders()
  if (file.type !== '') headers.set('Content-Type', file.type)
  headers.set('Content-Length', String(resolved.size))
  return new Response(head ? null : file, {status, headers})
}

function methodNotAllowedResponse(): Response {
  const headers = securityHeaders()
  const body = 'Method Not Allowed\n'
  headers.set('Allow', 'GET, HEAD')
  headers.set('Content-Type', 'text/plain; charset=utf-8')
  headers.set('Content-Length', String(new TextEncoder().encode(body).length))
  return new Response(body, {status: 405, headers})
}

function redirectResponse(location: string): Response {
  const headers = securityHeaders()
  headers.set('Location', location)
  headers.set('Content-Length', '0')
  return new Response(null, {status: 308, headers})
}

function textResponse(body: string, status: number, head: boolean): Response {
  const headers = securityHeaders()
  headers.set('Content-Type', 'text/plain; charset=utf-8')
  headers.set('Content-Length', String(new TextEncoder().encode(body).length))
  return new Response(head ? null : body, {status, headers})
}

function securityHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'self'; base-uri 'none'; img-src 'self' data: http: https:; object-src 'none'; script-src 'self'; style-src 'self'",
    'X-Content-Type-Options': 'nosniff',
  })
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
