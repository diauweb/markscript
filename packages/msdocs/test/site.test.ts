import {afterAll, beforeAll, expect, test} from 'bun:test'
import {access, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import type {Root} from 'mdast'
import {readPublicFile} from '../src/render.ts'
import {createSiteRequestHandler} from '../src/server.ts'
import {buildSite, buildSiteModule, type SiteDefinition} from '../src/site.ts'

let temporaryRoot = ''

beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'msdocs-test-'))
})

afterAll(async () => {
  await rm(temporaryRoot, {recursive: true, force: true})
})

test('static builds render navigable HTML and own only generated files', async () => {
  const output = path.join(temporaryRoot, 'site')
  const home = page('', '<Home>', {
    type: 'root',
    children: [
      {type: 'heading', depth: 1, children: [{type: 'text', value: 'Home'}]},
      {
        type: 'heading',
        depth: 2,
        children: [{type: 'text', value: 'Content'}],
      },
      {
        type: 'paragraph',
        children: [
          {type: 'text', value: 'Read '},
          {
            type: 'link',
            url: 'guide.md#first',
            children: [{type: 'text', value: '<the guide>'}],
          },
          {type: 'text', value: ' or its '},
          {
            type: 'link',
            url: 'guide.ms',
            children: [{type: 'text', value: 'MarkScript source'}],
          },
          {type: 'text', value: ', '},
          {
            type: 'link',
            url: 'https://example.test/README.md',
            children: [{type: 'text', value: 'external Markdown'}],
          },
          {type: 'text', value: ', or '},
          {
            type: 'link',
            url: 'missing.md',
            children: [{type: 'text', value: 'an unmapped page'}],
          },
          {type: 'text', value: '.'},
        ],
      },
      {
        type: 'containerDirective',
        name: 'aside',
        attributes: {class: 'warning', 'data-level': 'notice'},
        children: [
          {
            type: 'paragraph',
            children: [{type: 'text', value: 'Directive block'}],
          },
        ],
      },
      {
        type: 'leafDirective',
        name: 'hr',
        children: [],
      },
      {
        type: 'paragraph',
        children: [
          {type: 'text', value: 'Read '},
          {
            type: 'textDirective',
            name: 'abbr',
            attributes: {title: 'HyperText Markup Language'},
            children: [{type: 'text', value: 'HTML'}],
          },
          {type: 'text', value: '.'},
        ],
      },
    ],
  })
  const guide = page('guide', 'Guide', {
    type: 'root',
    children: [
      {type: 'heading', depth: 1, children: [{type: 'text', value: 'Guide'}]},
    ],
  })
  const initial: SiteDefinition = {
    title: '<Test & docs>',
    home,
    sections: [{title: 'Learn', pages: [guide]}],
  }

  await buildSite(initial, {outDir: output})
  const homeHtml = await readFile(path.join(output, 'index.html'), 'utf8')
  expect(homeHtml).toContain('href="guide.html#first"')
  expect(homeHtml).toContain('href="guide.html">MarkScript source</a>')
  expect(homeHtml).toContain('href="https://example.test/README.md"')
  expect(homeHtml).toContain('href="missing.md"')
  expect(homeHtml).toContain('&#x3C;the guide>')
  expect(homeHtml).toContain('&lt;Test &amp; docs&gt;')
  expect(homeHtml).toContain('id="home"')
  expect(homeHtml).toContain('id="content-2"')
  expect(homeHtml).toContain('href="#content-2">Content</a>')
  expect(homeHtml).not.toContain('Directive block')
  expect(homeHtml).not.toContain('data-level="notice"')
  expect(homeHtml).not.toContain('HyperText Markup Language')
  expect(homeHtml).toContain('<p>Read .</p>')
  expect(await exists(path.join(output, 'guide.html'))).toBe(true)
  expect(
    (await readFile(path.join(output, 'assets/msdocs.css'))).toString('utf8'),
  ).toBe((await readPublicFile('assets/msdocs.css')).toString('utf8'))

  await writeFile(path.join(output, 'keep.txt'), 'user-owned')
  await buildSite(
    {title: '<Test & docs>', home, sections: []},
    {outDir: output},
  )
  expect(await exists(path.join(output, 'guide.html'))).toBe(false)
  expect(await readFile(path.join(output, 'keep.txt'), 'utf8')).toBe(
    'user-owned',
  )
  const singlePageHtml = await readFile(path.join(output, 'index.html'), 'utf8')
  expect(singlePageHtml).not.toContain('<aside class="sidebar"')
})

test('unknown MDAST is omitted unless the site supplies conversion options', async () => {
  const output = path.join(temporaryRoot, 'custom-mdast')
  const root: Root = {
    type: 'root',
    children: [
      {type: 'heading', depth: 1, children: [{type: 'text', value: 'Custom'}]},
      {
        type: 'paragraph',
        children: [
          {type: 'text', value: 'Before '},
          {
            type: 'textDirective',
            name: 'term',
            children: [{type: 'text', value: 'custom node'}],
          },
          {type: 'text', value: ' after.'},
        ],
      },
    ],
  }

  await buildSite(
    {
      title: 'Custom MDAST',
      home: page('', 'Custom', root),
      sections: [],
      mdastToHast: {
        unknownHandler(state, node) {
          return {
            type: 'element',
            tagName: 'mark',
            properties: {'data-node': node.type},
            children: state.all(node),
          }
        },
      },
    },
    {outDir: output},
  )

  const html = await readFile(path.join(output, 'index.html'), 'utf8')
  expect(html).toContain(
    '<p>Before <mark data-node="textDirective">custom node</mark> after.</p>',
  )
})

test('preview serves built pages at canonical routes', async () => {
  const output = path.join(temporaryRoot, 'preview')
  await buildSite(
    {
      title: 'Preview',
      home: page('', 'Home', headingRoot('Home')),
      sections: [
        {
          title: 'Pages',
          pages: [
            page('guide/', 'Guide index', headingRoot('Guide index')),
            page('about', 'About', headingRoot('About')),
          ],
        },
      ],
    },
    {outDir: output},
  )

  const request = await createSiteRequestHandler(output)
  const siteUrl = new URL('http://msdocs.test')
  const call = (pathname: string, init?: RequestInit): Promise<Response> =>
    request(new Request(new URL(pathname, siteUrl), init))

  const about = await call('/about')
  expect(about.status).toBe(200)
  expect(await about.text()).toContain('<h1 id="about">About</h1>')

  const leafRedirect = await call('/about.html?from=file')
  expect(leafRedirect.status).toBe(308)
  expect(leafRedirect.headers.get('location')).toBe('/about?from=file')

  const indexRedirect = await call('/guide?from=index')
  expect(indexRedirect.status).toBe(308)
  expect(indexRedirect.headers.get('location')).toBe('/guide/?from=index')
  expect((await call('/guide/')).status).toBe(200)
  expect((await call('/about/')).status).toBe(404)
})

test('site modules provide generic site configuration', async () => {
  const output = path.join(temporaryRoot, 'site-module')
  const built = await buildSiteModule(
    path.join(import.meta.dir, 'fixtures/site.ts'),
    {outDir: output, title: 'Configured title'},
  )

  expect(built.pages).toBe(1)
  const html = await readFile(path.join(output, 'index.html'), 'utf8')
  expect(html).toContain('<title>Fixture home · Configured title</title>')
  expect(html).toContain('<h1 id="fixture-home">Fixture home</h1>')
})

function page(pagePath: string, title: string, root: Root) {
  return {path: pagePath, title, root}
}

function headingRoot(title: string): Root {
  return {
    type: 'root',
    children: [
      {type: 'heading', depth: 1, children: [{type: 'text', value: title}]},
    ],
  }
}

async function exists(filename: string): Promise<boolean> {
  try {
    await access(filename)
    return true
  } catch {
    return false
  }
}
