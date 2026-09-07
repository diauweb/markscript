import {expect, test} from 'bun:test'
import {readdir, readFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {runFile} from '@markscript/compiler'
import {
  getManual,
  isDiagnosticCodePattern,
  isManualPageCodePattern,
  listManuals,
  lookupManual,
  MANUAL_CATEGORIES,
  type ManualCategory,
  type ManualIndexSelector,
  type ManualPageSelector,
  manualsBySelector,
} from '@markscript/manuals'
import type {RootContent} from 'mdast'
import {parseManualPage} from '../src/core.ts'

interface SourceManual {
  category: ManualCategory
  key: string
  path: string
  selector: ManualPageSelector
}

test('compiled catalog and indexes match their categorized MarkScript sources', async () => {
  const packageRoot = path.resolve(import.meta.dir, '..')
  const sources = await sourceManuals(packageRoot)
  const pages = listManuals()
  const selectors = pages.map(({selector}) => selector)
  const expectedSelectors = sources.map(({selector}) => selector)

  expect(selectors).toEqual(expectedSelectors)
  expect(Object.keys(manualsBySelector).sort()).toEqual(
    ['', ...MANUAL_CATEGORIES, ...expectedSelectors].sort(),
  )

  for (const source of sources) {
    const generatedPage = getManual(source.selector)
    expect(generatedPage?.kind).toBe('page')
    if (generatedPage?.kind !== 'page') {
      throw new Error(`Generated catalog lost ${source.selector}`)
    }
    expect(generatedPage.category).toBe(source.category)

    expect(fileURLToPath(generatedPage.documentationUrl)).toBe(source.path)
    const currentRoot = await runFile(source.path, {check: false})
    expect(generatedPage.root).toEqual(currentRoot)

    const {root: _generatedRoot, ...generatedEntry} = generatedPage
    const {root: _currentRoot, ...currentEntry} = parseManualPage({
      category: source.category,
      key: source.key,
      root: currentRoot,
      documentationUrl: generatedPage.documentationUrl,
    })
    expect(currentEntry).toEqual(generatedEntry)
  }

  const indexSelectors: readonly ManualIndexSelector[] = [
    '',
    ...MANUAL_CATEGORIES,
  ]
  for (const selector of indexSelectors) {
    const index = getManual(selector)
    expect(index?.kind).toBe('index')
    if (index?.kind !== 'index') {
      throw new Error(`Compiled catalog lost the ${selector || 'root'} index`)
    }
    expect(path.resolve(fileURLToPath(index.documentationUrl))).toBe(
      selector === ''
        ? path.join(packageRoot, 'manuals')
        : path.join(packageRoot, 'manuals', selector),
    )
    expect(index.entries).toEqual(
      (selector === '' ? pages : listManuals(selector)).map(
        ({root: _root, ...entry}) => entry,
      ),
    )
  }

  const diagnostic = getManual('err1104')
  expect(diagnostic).toMatchObject({
    kind: 'page',
    selector: 'ERR1104',
    category: 'diagnostics',
    code: 'ERR1104',
    diagnosticKind: 'error',
  })
  if (diagnostic?.kind === 'page' && diagnostic.category === 'diagnostics') {
    expect(diagnostic.sections).toMatchObject([
      {text: expect.stringContaining('typed MDAST tree')},
      {title: 'Common cases'},
      {title: 'Fix'},
    ])
  }

  expect(getManual('tut1001')).toMatchObject({
    kind: 'page',
    selector: 'TUT1001',
    category: 'tutorials',
    code: 'TUT1001',
  })
  const tutorialIndex = getManual('tutorials')
  expect(tutorialIndex?.kind).toBe('index')
  if (tutorialIndex?.kind === 'index') {
    expect(
      tutorialIndex.root.children.map(headingText).filter(Boolean),
    ).toEqual(['Tutorials', 'Basic', 'Intermediate', 'Advanced'])
    expect(
      tutorialIndex.root.children
        .map(listCodes)
        .filter((codes) => codes.length),
    ).toEqual([
      ['TUT1001', 'TUT1002'],
      ['TUT1003', 'TUT1004'],
      ['TUT1005', 'TUT1006'],
    ])
  }
  expect(getManual('hbk1003')).toMatchObject({
    kind: 'page',
    selector: 'HBK1003',
    category: 'handbooks',
    code: 'HBK1003',
  })

  expect(lookupManual('TUT9999')).toEqual({
    found: false,
    requested: 'TUT9999',
    normalized: 'TUT9999',
    reason: 'unknown-manual',
    category: 'tutorials',
  })
  expect(lookupManual('tutorials/getting-started')).toEqual({
    found: false,
    requested: 'tutorials/getting-started',
    normalized: 'tutorials/getting-started',
    reason: 'invalid-selector',
  })

  const emittedCodes = await sourceDiagnosticCodes(
    path.resolve(packageRoot, '../..'),
  )
  const documentedCodes = new Set<string>(
    pages
      .filter((page) => page.category === 'diagnostics')
      .map((page) => page.code),
  )
  expect(emittedCodes.filter((code) => !documentedCodes.has(code))).toEqual([])
})

function headingText(node: RootContent): string {
  if (node.type !== 'heading') return ''
  return node.children
    .map((child) => ('value' in child ? child.value : ''))
    .join('')
}

function listCodes(node: RootContent): string[] {
  if (node.type !== 'list') return []
  return node.children.flatMap((item) => {
    const paragraph = item.children[0]
    if (paragraph?.type !== 'paragraph') return []
    const link = paragraph.children[0]
    if (link?.type !== 'link') return []
    const label = link.children[0]
    return label?.type === 'text' ? [label.value.slice(0, 7)] : []
  })
}

async function sourceManuals(packageRoot: string): Promise<SourceManual[]> {
  const result: SourceManual[] = []
  for (const category of MANUAL_CATEGORIES) {
    const categoryRoot = path.join(packageRoot, 'manuals', category)
    const sourceNames = (await readdir(categoryRoot))
      .filter((name) => name.endsWith('.ms'))
      .sort()
    for (const sourceName of sourceNames) {
      const key = path.basename(sourceName, '.ms')
      expect(isManualPageCodePattern(key)).toBe(true)
      expect(isDiagnosticCodePattern(key)).toBe(category === 'diagnostics')
      result.push({
        category,
        key,
        path: path.join(categoryRoot, sourceName),
        selector: key as ManualPageSelector,
      })
    }
  }
  return result
}

async function sourceDiagnosticCodes(workspaceRoot: string): Promise<string[]> {
  const canonical = new Set<string>()
  const literal = /(["'`])((?:SYN|ERR|SUG)\d{4})\1/gu

  for (const packageName of ['runtime', 'compiler', 'markscript']) {
    const sourceRoot = path.join(workspaceRoot, 'packages', packageName, 'src')
    const names = await readdir(sourceRoot, {recursive: true})
    for (const name of names) {
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
      const source = await readFile(path.join(sourceRoot, name), 'utf8')
      for (const match of source.matchAll(literal)) {
        const code = match[2]
        if (code !== undefined) canonical.add(code)
      }
    }
  }

  return [...canonical].sort()
}
