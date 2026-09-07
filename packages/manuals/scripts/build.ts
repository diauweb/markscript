import {mkdir, readdir, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  bundleFile,
  formatDiagnostic,
  hasErrors,
  runFile,
} from '@markscript/compiler'
import {emitDeclarations} from '../../../scripts/declarations.ts'
import {
  createManualCatalog,
  MANUAL_CATEGORIES,
  type ManualCatalog,
  type ManualCategory,
  type ManualPageInput,
  type ManualPageSelector,
} from '../src/core.ts'

interface ManualSource {
  category: ManualCategory
  key: ManualPageSelector
  path: string
}

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const sourceDirectory = path.join(packageRoot, 'manuals')
const outputDirectory = path.join(packageRoot, 'dist')
const declarationsDirectory = path.join(packageRoot, 'types')
const entriesDirectory = path.join(outputDirectory, 'entries')
const coreSourcePath = path.join(packageRoot, 'src', 'core.ts')
const sources = await readManualSources()
const pageInputs: ManualPageInput[] = []

if (!sources.some((source) => source.category === 'diagnostics')) {
  throw new Error('No diagnostic .ms manual pages were found.')
}

await rm(outputDirectory, {recursive: true, force: true})
await rm(declarationsDirectory, {recursive: true, force: true})
await mkdir(entriesDirectory, {recursive: true})

const coreBuild = await Bun.build({
  entrypoints: [coreSourcePath],
  outdir: outputDirectory,
  target: 'node',
  format: 'esm',
  packages: 'external',
  sourcemap: 'external',
  naming: {entry: 'core.js'},
})
if (!coreBuild.success) {
  throw new Error(coreBuild.logs.map((log) => log.message).join('\n'))
}

for (const source of sources) {
  const result = await bundleFile(source.path, {sourceMap: true})
  if (hasErrors(result.diagnostics) || result.code.length === 0) {
    throw new Error(result.diagnostics.map(formatDiagnostic).join('\n'))
  }
  if (result.map === undefined) {
    throw new Error(`${source.key} source map is missing.`)
  }

  const categoryEntries = path.join(entriesDirectory, source.category)
  await mkdir(categoryEntries, {recursive: true})
  const modulePath = path.join(categoryEntries, `${source.key}.js`)
  const moduleCode = [
    result.code
      .replace(/\n?\/\/# sourceMappingURL=.*?(?:\r?\n|$)/gu, '')
      .trimEnd(),
    `//# sourceMappingURL=${source.key}.js.map`,
    '',
  ].join('\n')
  await writeFile(modulePath, moduleCode, 'utf8')
  await writeFile(`${modulePath}.map`, `${result.map.trimEnd()}\n`, 'utf8')

  pageInputs.push({
    category: source.category,
    key: source.key,
    root: await runFile(source.path, {check: false}),
    documentationUrl: new URL(
      `../manuals/${source.category}/${source.key}.ms`,
      import.meta.url,
    ).href,
  })
}

const importLines = sources.map(
  (source, index) =>
    `import render${index} from "./entries/${source.category}/${source.key}.js";`,
)
const pageLines = sources.map(
  (source, index) =>
    `  {category: "${source.category}", key: "${source.key}", root: await render${index}(), documentationUrl: new URL("../manuals/${source.category}/${source.key}.ms", import.meta.url).href},`,
)
const categoryLocationLines = MANUAL_CATEGORIES.map(
  (category) =>
    `    ${category}: new URL("../manuals/${category}/", import.meta.url).href,`,
)
const catalogExports = [
  'manualsBySelector',
  'getManual',
  'lookupManual',
  'listManuals',
  'manualDocumentationUrl',
  'isManualSelector',
] as const satisfies readonly (keyof ManualCatalog)[]
const indexCode = [
  ...importLines,
  'import {createManualCatalog} from "./core.js";',
  '',
  'const catalog = createManualCatalog([',
  ...pageLines,
  '], {',
  '  root: new URL("../manuals/", import.meta.url).href,',
  '  categories: {',
  ...categoryLocationLines,
  '  },',
  '});',
  '',
  ...catalogExports.map((name) => `export const ${name} = catalog.${name};`),
  'export {',
  '  ARTICLE_CODE_PATTERN,',
  '  DIAGNOSTIC_CODE_PATTERN,',
  '  MANUAL_CATEGORIES,',
  '  MANUAL_PAGE_CODE_PATTERN,',
  '  createManualCatalog,',
  '  createManualIndexes,',
  '  isArticleCodePattern,',
  '  isDiagnosticCodePattern,',
  '  isManualCategory,',
  '  isManualPageCodePattern,',
  '  isManualSelectorPattern,',
  '  normalizeManualSelector,',
  '  parseManualPage,',
  '} from "./core.js";',
  '',
].join('\n')
const indexPath = path.join(outputDirectory, 'index.js')
await writeFile(indexPath, indexCode, 'utf8')
emitDeclarations(path.join(packageRoot, 'tsconfig.build.json'))
await writeFile(
  path.join(declarationsDirectory, 'index.d.ts'),
  [
    'export * from "./core.js";',
    'import type {ManualCatalog} from "./core.js";',
    ...catalogExports.map(
      (name) => `export declare const ${name}: ManualCatalog["${name}"];`,
    ),
    '',
  ].join('\n'),
)

const catalog = createManualCatalog(pageInputs, {
  root: new URL('../manuals/', import.meta.url).href,
  categories: Object.fromEntries(
    MANUAL_CATEGORIES.map((category) => [
      category,
      new URL(`../manuals/${category}/`, import.meta.url).href,
    ]),
  ) as Record<ManualCategory, string>,
})
if (catalog.listManuals().length !== sources.length) {
  throw new Error('Built manual count differs from its source manifest.')
}
for (const source of sources) {
  const manual = catalog.getManual(source.key)
  if (manual?.kind !== 'page' || manual.selector !== source.key) {
    throw new Error(`Built catalog lost the ${source.key} page.`)
  }
}

console.log(`${sources.length} manual modules`)
console.log(path.relative(process.cwd(), indexPath))

async function readManualSources(): Promise<ManualSource[]> {
  const result: ManualSource[] = []
  for (const category of MANUAL_CATEGORIES) {
    const categoryDirectory = path.join(sourceDirectory, category)
    const names = await readdir(categoryDirectory)
    const sourceNames = names.filter((name) => name.endsWith('.ms')).sort()
    const invalidNames = sourceNames.filter(
      (name) => !filenamePattern(category).test(name),
    )
    if (invalidNames.length > 0) {
      throw new Error(
        `Invalid ${category} manual filenames: ${invalidNames.join(', ')}`,
      )
    }

    for (const sourceName of sourceNames) {
      const key = path.basename(sourceName, '.ms') as ManualPageSelector
      result.push({
        category,
        key,
        path: path.join(categoryDirectory, sourceName),
      })
    }
  }
  return result
}

function filenamePattern(category: ManualCategory): RegExp {
  switch (category) {
    case 'diagnostics':
      return /^(?:SYN|ERR|SUG)\d{4}\.ms$/u
    case 'tutorials':
      return /^TUT\d{4}\.ms$/u
    case 'handbooks':
      return /^HBK\d{4}\.ms$/u
  }
}
