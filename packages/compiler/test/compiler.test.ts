import {afterAll, beforeEach, describe, expect, test} from 'bun:test'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import type {Root} from 'mdast'
import {fromMarkdown} from 'mdast-util-from-markdown'
import {toMarkdown} from 'mdast-util-to-markdown'
import {SourceMapConsumer} from 'source-map'
import ts from 'typescript'
import {
  bundleFile,
  check,
  compile,
  createTypeScriptProjection,
  formatMarkscript,
  parseMarkscript,
  runFile,
} from '../src/index.ts'

const temporaryRoot = path.join(process.cwd(), '.markscript-test')
let caseNumber = 0

beforeEach(async () => {
  await mkdir(temporaryRoot, {recursive: true})
})

afterAll(async () => {
  await rm(temporaryRoot, {recursive: true, force: true})
})

describe('compiler frontend', () => {
  test('formats Markdown, ESM, TSX, directives, and expression islands', async () => {
    const filename = fixtureName('format.ms')
    const source = `import {onReady,onTransform} from '@markscript/markscript'

export const title='Report'
export function Note({children}:{children?:unknown}){return <blockquote>{children}</blockquote>}

# {title?title.toUpperCase():'Untitled'}

::ref{id=summary public reviewed=false}
<Note>
Formatted **document**.
</Note>

\`\`\`ts
const   untouched   = { brace: true }
\`\`\`

{
onReady(({root})=>{
console.error(root.children.length)
})
}
`
    const formatted = await formatMarkscript(source, {filename})
    expect(formatted).toContain(
      "import { onReady, onTransform } from '@markscript/markscript'",
    )
    expect(formatted).toContain("# {title ? title.toUpperCase() : 'Untitled'}")
    expect(formatted).toContain('export function Note({ children }')
    expect(formatted).toContain('onReady(({ root }) => {')
    expect(formatted).toContain('  console.error(root.children.length)')
    expect(formatted).toContain('const untouched = { brace: true }')
    expect(parseMarkscript(formatted, filename).diagnostics).toEqual([])
    expect(errorCodes(await check(formatted, {filename}))).toEqual([])
    expect(await formatMarkscript(formatted, {filename})).toBe(formatted)
  })

  test('formatting rejects invalid source without evaluating it', async () => {
    await expect(
      formatMarkscript(
        "export const sideEffect = (() => { throw new Error('executed') })()\n\n# Safe\n",
        {filename: fixtureName('non-executing-format.ms')},
      ),
    ).resolves.toContain("throw new Error('executed')")
    await expect(
      formatMarkscript(
        'export const sideEffect = (() => { throw boom })()\n\n{',
        {
          filename: fixtureName('invalid-format.ms'),
        },
      ),
    ).rejects.toThrow()
  })

  test('preserves fenced code contents while formatting surrounding source', async () => {
    const filename = fixtureName('format-fence.ms')
    const fenceBody =
      '<div style={{display:"flex"}}>**literal** { title }</div>'
    const source = `export const title='Fence'\n\n#   Before\n\n\`\`\`card\n${fenceBody}\n\`\`\`\n\nAfter.\n`
    const formatted = await formatMarkscript(source, {filename})

    expect(formatted).toContain("export const title = 'Fence'")
    expect(formatted).toContain(fenceBody)
    expect(await formatMarkscript(formatted, {filename})).toBe(formatted)
  })

  test('accepts TypeScript syntax in modules, expressions, attributes, and TSX', async () => {
    const source = `export type Point = {x: number}

export const point = {x: 2} satisfies Point

export function Box({children}: {children?: unknown}) {
  return <blockquote>{children}</blockquote>
}

export function Item<Value>({value}: {value: Value}) {
  return <p>{String(value)}</p>
}

# {point.x as number}

<Box><strong>{[point].map<Point>(item => item)[0]!.x}</strong></Box>

<Item value={point.x} />
`
    const result = await compile(source, {
      filename: fixtureName('typescript.ms'),
    })

    expect(errorCodes(result.diagnostics)).toEqual([])
    expect(result.code).toContain('export const point')
    expect(result.code).toContain('export function Box')
    expect(result.code).toContain('export default')
  })

  test('keeps projected TSX on the MarkScript JSX runtime in React projects', () => {
    const projection = createTypeScriptProjection(
      `export function Heading() {
  return <h1>Report</h1>
}

<Heading />
`,
      fixtureName('react-project.ms'),
    )
    const generated = projection.generated?.code
    expect(generated).toStartWith('/** @jsxImportSource @markscript/runtime */')

    const transpiled = ts.transpileModule(generated ?? '', {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: 'react',
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText
    expect(transpiled).toContain('@markscript/runtime/jsx-runtime')
    expect(transpiled).not.toContain('react/jsx-runtime')
  })

  test('keeps language-labelled fences as ordinary code nodes', async () => {
    const filename = fixtureName('consumer-fence.ms')
    const source = `::card{enabled width=1200}

\`\`\`card
<unknown-tag>**literal** {notTypeScript}</unknown-tag>
\`\`\`
`
    await writeFile(filename, source)
    expect(
      errorCodes(await check(source, {filename, tsconfig: false})),
    ).toEqual([])
    const root = await runFile(filename, {check: false})
    expect(root.children[0]).toMatchObject({
      type: 'code',
      lang: 'card',
      value: '<unknown-tag>**literal** {notTypeScript}</unknown-tag>',
      data: {card: {enabled: true, width: '1200'}},
    })
  })

  test('implicitly awaits document expressions before MarkValue lowering', async () => {
    const filename = fixtureName('implicit-await.ms')
    await writeFile(
      filename,
      `export function Card({label}: {label: string}) {
  return <p>{label}</p>
}

# {Promise.resolve('Async title')}

{Promise.resolve(<h2>Async section</h2>)}

<Card label={Promise.resolve('Named attribute')} />

<Card {...Promise.resolve({label: 'Spread attribute'})} />

{Promise.all([
  Promise.resolve(<p>First item</p>),
  Promise.resolve(<p>Second item</p>)
])}
`,
    )

    const root = await runFile(filename)
    expect(root.children).toMatchObject([
      {type: 'heading', children: [{value: 'Async title'}]},
      {type: 'heading', children: [{value: 'Async section'}]},
      {type: 'paragraph', children: [{value: 'Named attribute'}]},
      {type: 'paragraph', children: [{value: 'Spread attribute'}]},
      {type: 'paragraph', children: [{value: 'First item'}]},
      {type: 'paragraph', children: [{value: 'Second item'}]},
    ])

    const unresolvedFilename = fixtureName('nested-promise.ms')
    await writeFile(unresolvedFilename, `{[Promise.resolve('still nested')]}`)
    await expect(
      runFile(unresolvedFilename, {check: false}),
    ).rejects.toMatchObject({code: 'ERR1103'})
  })

  test('rejects explicit top-level await while allowing await inside functions', async () => {
    const forbiddenModule = await check(
      `export const value = await Promise.resolve('module')

# {value}
`,
      {filename: fixtureName('top-level-await.ms'), tsconfig: false},
    )
    expect(errorCodes(forbiddenModule)).toContain('ERR1003')

    const forbiddenDocument = await check(
      `# {await Promise.resolve('heading')}

<a href={await Promise.resolve('/guide')}>Guide</a>
`,
      {filename: fixtureName('document-await.ms'), tsconfig: false},
    )
    expect(errorCodes(forbiddenDocument)).toContain('ERR1003')

    const allowed = await check(
      `export async function loadValue() {
  return await Promise.resolve('function')
}

# {loadValue()}
`,
      {filename: fixtureName('function-await.ms'), tsconfig: false},
    )
    expect(errorCodes(allowed)).toEqual([])
  })

  test('reports MarkScript structure diagnostics', async () => {
    const diagnostics = await check(
      `export function Card({count}: {count: number}) {
  return <p>{count}</p>
}

# Invalid

<article>not markdown</article>

<h2 className="red">Heading</h2>

Paragraph <h3>nested flow</h3>

<p>
> nested block
</p>

<Card wrong="x" />
`,
      {filename: fixtureName('invalid.ms')},
    )

    expect(errorCodes(diagnostics)).toContain('ERR1101')
    expect(errorCodes(diagnostics)).toContain('ERR1102')
    expect(errorCodes(diagnostics)).toContain('ERR1104')
    expect(errorCodes(diagnostics)).toContain('TS2769')
  })

  test('treats standalone Markdown-shaped JSX as flow constructors', async () => {
    const filename = fixtureName('flow-jsx.ms')
    const source = `<h3>Hello <em>world</em></h3>

<h4>
Multiline heading
</h4>

<pre>
<code>const value = 1</code>
</pre>
`
    await writeFile(filename, source)
    expect(errorCodes(await check(source, {filename}))).toEqual([])

    const root = await runFile(filename, {check: false})
    expect(root.children.map((node) => node.type)).toEqual([
      'heading',
      'heading',
      'code',
    ])
    expect(root.children[0]).toMatchObject({type: 'heading', depth: 3})
    expect(root.children[1]).toMatchObject({type: 'heading', depth: 4})
    expect(root.children[2]).toMatchObject({
      type: 'code',
      value: 'const value = 1',
    })
  })

  test('preserves GFM source as canonical MDAST', async () => {
    const filename = fixtureName('gfm.ms')
    await writeFile(
      filename,
      `# Release status

| Package | State |
| :-- | --: |
| compiler | ~~pending~~ ready |

- [x] parsed
- [ ] published

The details are recorded here[^build].

[^build]: The generated module retains this note.
`,
    )

    const root = await runFile(filename)

    expect(root.children.map((node) => node.type)).toEqual([
      'heading',
      'table',
      'list',
      'paragraph',
      'footnoteDefinition',
    ])
    expect(root.children[1]).toMatchObject({
      type: 'table',
      align: ['left', 'right'],
      children: [
        {
          type: 'tableRow',
          children: [
            {type: 'tableCell', children: [{type: 'text', value: 'Package'}]},
            {type: 'tableCell', children: [{type: 'text', value: 'State'}]},
          ],
        },
        {
          type: 'tableRow',
          children: [
            {type: 'tableCell', children: [{type: 'text', value: 'compiler'}]},
            {
              type: 'tableCell',
              children: [
                {
                  type: 'delete',
                  children: [{type: 'text', value: 'pending'}],
                },
                {type: 'text', value: ' ready'},
              ],
            },
          ],
        },
      ],
    })
    expect(root.children[2]).toMatchObject({
      type: 'list',
      children: [
        {type: 'listItem', checked: true},
        {type: 'listItem', checked: false},
      ],
    })
    expect(root.children[3]).toMatchObject({
      type: 'paragraph',
      children: [
        {type: 'text', value: 'The details are recorded here'},
        {type: 'footnoteReference', identifier: 'build'},
        {type: 'text', value: '.'},
      ],
    })
    expect(root.children[4]).toMatchObject({
      type: 'footnoteDefinition',
      identifier: 'build',
    })
  })

  test('lowers directives into attached data without directive nodes', async () => {
    const filename = fixtureName('directives.ms')
    const source = `export const heading = Promise.resolve('Release')
export const audience = Promise.resolve('agent')
export const shared = {owner: 'release', active: true}

:::callout{#release .warning audience={audience} options={{keepWithNext: true}} {...shared}}
## {heading}

Paragraph.
:::

::badge{tone="success"}

Build **ready**.

The :abbr{title="HyperText Markup Language"}**HTML** spec.
`
    await writeFile(filename, source)

    const projection = createTypeScriptProjection(source, filename)
    const generatedCode = projection.generated?.code ?? ''
    expect(generatedCode).toContain('directiveGroup as')
    expect(generatedCode).toContain('directiveAnnotation as')

    const root = await runFile(filename)

    expect(root.children).toHaveLength(4)
    expect(root.children[0]).toMatchObject({
      type: 'heading',
      data: {
        callout: {
          id: 'release',
          class: 'warning',
          audience: 'agent',
          options: {keepWithNext: true},
          owner: 'release',
          active: true,
        },
      },
    })
    expect(root.children[1]).toMatchObject({
      type: 'paragraph',
      data: {
        callout: {
          id: 'release',
          class: 'warning',
          audience: 'agent',
          options: {keepWithNext: true},
          owner: 'release',
          active: true,
        },
      },
    })
    expect(root.children[2]).toMatchObject({
      type: 'paragraph',
      data: {badge: {tone: 'success'}},
    })
    expect(root.children[3]).toMatchObject({
      type: 'paragraph',
      children: [
        {type: 'text', value: 'The '},
        {
          type: 'strong',
          data: {abbr: {title: 'HyperText Markup Language'}},
        },
        {type: 'text', value: ' spec.'},
      ],
    })
    expect(JSON.stringify(root)).not.toContain('Directive')
  })

  test('reserves default export without rejecting named and type exports', async () => {
    const diagnostics = await check(
      `export type DocumentValue = number

export const value: DocumentValue = 1

export default function forbidden() {}

# Document
`,
      {filename: fixtureName('default.ms')},
    )
    const codes = errorCodes(diagnostics)
    expect(codes).toContain('ERR1201')
    expect(codes.every((code) => code === 'ERR1201' || code === 'TS2528')).toBe(
      true,
    )
  })

  test('uses TypeScript project checking without executing source', async () => {
    delete globalState().__markscriptCompileExecuted
    const source = `export const neverRun: number = (() => {
  ;(globalThis as typeof globalThis & {__markscriptCompileExecuted?: boolean})
    .__markscriptCompileExecuted = true
  return 'wrong'
})()

# Safe compile
`
    const diagnostics = await check(source, {
      filename: fixtureName('nonexecuting.ms'),
    })
    const result = await compile(source, {
      filename: fixtureName('nonexecuting.ms'),
    })

    expect(globalState().__markscriptCompileExecuted).toBeUndefined()
    expect(errorCodes(diagnostics)).toContain('TS2322')
    expect(errorCodes(result.diagnostics)).toContain('TS2322')
  })

  test('applies project settings and ambient declarations without checking unrelated roots', async () => {
    const projectDirectory = fixtureName('profile')
    const filename = path.join(projectDirectory, 'document.ms')
    await mkdir(projectDirectory, {recursive: true})
    await writeFile(
      path.join(projectDirectory, 'globals.d.ts'),
      'declare const projectTitle: string\n',
    )
    await writeFile(
      path.join(projectDirectory, 'unrelated.ts'),
      `const unrelated: number = 'not part of this file check'\n`,
    )
    await writeFile(
      path.join(projectDirectory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'CommonJS',
          moduleResolution: 'Node',
          strict: false,
          types: [],
        },
        include: ['*.ts', '*.ms'],
      }),
    )

    const diagnostics = await check(
      `export const nullable: string = null

# {projectTitle.toUpperCase()}
`,
      {filename},
    )
    expect(errorCodes(diagnostics)).toEqual([])
  })

  test('maps TypeScript diagnostics and emitted code back to .ms positions', async () => {
    const filename = fixtureName('mapping.ms')
    const source = `export const title: number = 'wrong'

# {title}
`
    const diagnostics = await check(source, {filename, tsconfig: false})
    const assignment = diagnostics.find((item) => item.code === 'TS2322')
    expect(assignment?.line).toBe(1)
    expect(assignment?.column).toBe(14)

    const indentedSource = `export function accept(value: number) {
  return value
}

{
  accept(
    'wrong',
  )
}
`
    const indentedDiagnostics = await check(indentedSource, {
      filename,
      tsconfig: false,
    })
    const argument = indentedDiagnostics.find((item) => item.code === 'TS2345')
    expect(argument?.line).toBe(7)
    expect(argument?.column).toBe(5)

    const validSource = `export const title = 'Mapped'

# {title}
`
    const result = await compile(validSource, {
      filename,
      sourceMap: true,
      tsconfig: false,
    })
    expect(result.map).toBeDefined()
    if (result.map === undefined) throw new Error('Expected a source map')
    const generated = generatedPoint(result.code, '(title)', 1)
    await SourceMapConsumer.with(result.map, null, (consumer) => {
      expect(consumer.originalPositionFor(generated)).toMatchObject({
        source: filename,
        line: 3,
        column: 3,
      })
      expect(consumer.sourceContentFor(filename)).toBe(validSource)
    })
  })
})

describe('MarkScript module checking', () => {
  test('type-checks named and generated default exports from a relative .ms import', async () => {
    const libraryFilename = fixtureName('library.ms')
    const entryFilename = fixtureName('library-entry.ms')
    await writeFile(
      libraryFilename,
      `export const answer = 42

export function label(value: number): string {
  return String(value)
}

# Library
`,
    )

    const entrySource = `import LibraryDocument, {answer, label} from './${path.basename(libraryFilename)}'

export const typedAnswer: number = answer
export const typedLabel: string = label(answer)
export const loadLibrary: () => Promise<import('mdast').Root> = LibraryDocument

# Entry

<LibraryDocument />
`
    await writeFile(entryFilename, entrySource)
    const diagnostics = await check(entrySource, {
      filename: entryFilename,
      tsconfig: false,
    })

    expect(errorCodes(diagnostics)).toEqual([])

    const root = await runFile(entryFilename)
    expect(
      root.children
        .filter((node) => node.type === 'heading')
        .map((node) =>
          node.children
            .map((child) => ('value' in child ? child.value : ''))
            .join(''),
        ),
    ).toEqual(['Entry', 'Library'])
  })

  test.each(['@docs/library.ms', '@library', '@content/library'])(
    'resolves and checks MarkScript through the TypeScript alias %s',
    async (specifier) => {
      const directory = fixtureName('aliased-project')
      const docsDirectory = path.join(directory, 'docs')
      const entryFilename = path.join(directory, 'entry.ms')
      const libraryFilename = path.join(docsDirectory, 'library.ms')
      const configFilename = path.join(directory, 'tsconfig.json')
      await mkdir(docsDirectory, {recursive: true})
      await Promise.all([
        writeFile(
          libraryFilename,
          `export const answer: 42 = 42

# Library
`,
        ),
        writeFile(
          configFilename,
          JSON.stringify({
            compilerOptions: {
              paths: {
                '@docs/*': ['./docs/*'],
                '@library': ['./docs/library.ms'],
                '@content/*': ['./docs/*.ms'],
                '@utils': ['./utils.ts'],
              },
              strict: true,
            },
            include: ['**/*'],
          }),
        ),
      ])

      await writeFile(
        path.join(directory, 'utils.ts'),
        'const value = 1; export const utility: number = value',
      )
      const source = `import documentEntry, {answer} from '${specifier}'
import {utility} from '@utils'

export const utilityValue: number = utility

export const typed: 42 = answer
export const entry: () => Promise<import('mdast').Root> = documentEntry

# Aliased
`
      const options = {filename: entryFilename, tsconfig: configFilename}
      expect(errorCodes(await check(source, options))).toEqual([])
      await writeFile(
        libraryFilename,
        'export const answer: 42 = 0\n\n# Library\n',
      )
      const diagnostic = (await check(source, options)).find(
        (item) => item.code === 'TS2322',
      )
      expect(diagnostic?.filename).toBe(libraryFilename)
      expect(diagnostic?.line).toBe(1)
    },
  )

  test('composes an imported async MarkScript entry as JSX', async () => {
    const sectionFilename = fixtureName('implicit-section.ms')
    const reportFilename = fixtureName('implicit-report.ms')
    await writeFile(sectionFilename, '# Imported section\n')
    await writeFile(
      reportFilename,
      `import Section from './${path.basename(sectionFilename)}'

# Report

<Section />
`,
    )

    const root = await runFile(reportFilename)
    expect(root.children).toMatchObject([
      {type: 'heading', children: [{value: 'Report'}]},
      {type: 'heading', children: [{value: 'Imported section'}]},
    ])
  })

  test('parent transforms can mutate composed imported document nodes', async () => {
    const sectionFilename = fixtureName('mutable-section.ms')
    const reportFilename = fixtureName('mutable-report.ms')
    await writeFile(sectionFilename, '# Imported section\n')
    await writeFile(
      reportFilename,
      `import {onTransform} from '@markscript/markscript'
import Section from './${path.basename(sectionFilename)}'

{onTransform(({root}) => {
  for (const node of root.children) {
    node.data = {...node.data, transformedByParent: true}
  }
})}

# Report

<Section />
`,
    )

    const root = await runFile(reportFilename)
    expect(root.children).toMatchObject([
      {type: 'heading', data: {transformedByParent: true}},
      {type: 'heading', data: {transformedByParent: true}},
    ])
  })

  test('maps a diagnostic in an imported .ms module to that source file', async () => {
    const dependencyFilename = fixtureName('broken-dependency.ms')
    const bridgeFilename = fixtureName('broken-bridge.ms')
    const entryFilename = fixtureName('broken-entry.ms')
    await writeFile(
      dependencyFilename,
      `export const broken: number = 'wrong'

# Broken dependency
`,
    )
    await writeFile(
      bridgeFilename,
      `export {broken} from './${path.basename(dependencyFilename)}'

# Bridge
`,
    )

    const diagnostics = await check(
      `import {broken} from './${path.basename(bridgeFilename)}'

# {broken}
`,
      {filename: entryFilename, tsconfig: false},
    )
    const assignment = diagnostics.find((item) => item.code === 'TS2322')

    expect(assignment).toMatchObject({
      filename: dependencyFilename,
      line: 1,
      column: 14,
    })
  })

  test('checks a cyclic .ms graph through editor source overrides', async () => {
    const entryFilename = fixtureName('open-cycle-a.ms')
    const dependencyFilename = fixtureName('open-cycle-b.ms')
    await writeFile(
      dependencyFilename,
      `import {a} from './${path.basename(entryFilename)}'

export const b: number = 'from disk'

# {a}
`,
    )
    const entrySource = `import {b} from './${path.basename(dependencyFilename)}'

export const a: number = 1
export const fromB: number = b

# Cycle A
`

    const diskDiagnostics = await check(entrySource, {
      filename: entryFilename,
      tsconfig: false,
    })
    expect(errorCodes(diskDiagnostics)).toContain('TS2322')

    const overlayDiagnostics = await check(entrySource, {
      filename: entryFilename,
      sourceOverrides: new Map([
        [
          dependencyFilename,
          `import {a} from './${path.basename(entryFilename)}'

export const b: number = a

# Unsaved cycle B
`,
        ],
      ]),
      tsconfig: false,
    })
    expect(errorCodes(overlayDiagnostics)).toEqual([])
  })

  test('checks unsaved TypeScript dependencies through editor source overrides', async () => {
    const entryFilename = fixtureName('open-typescript-entry.ms')
    const dependencyFilename = fixtureName('open-typescript-dependency.ts')
    await writeFile(
      dependencyFilename,
      `export function greet(name: string): string {
  return name
}
`,
    )
    const entrySource = `import {greet} from './${path.basename(dependencyFilename)}'

# {greet('reader')}
`

    expect(
      errorCodes(
        await check(entrySource, {filename: entryFilename, tsconfig: false}),
      ),
    ).toEqual([])

    const diagnostics = await check(entrySource, {
      filename: entryFilename,
      sourceOverrides: new Map([
        [
          dependencyFilename,
          `export function greet(name: number): string {
  return String(name)
}
`,
        ],
      ]),
      tsconfig: false,
    })
    expect(errorCodes(diagnostics)).toContain('TS2345')
    expect(diagnostics.find((item) => item.code === 'TS2345')).toMatchObject({
      filename: entryFilename,
      line: 3,
    })
  })
})

describe('compiled module ABI', () => {
  test('checks, bundles, and runs imported images as self-contained data URLs', async () => {
    const directory = fixtureName('image-asset')
    const entryFilename = path.join(directory, 'entry.ms')
    const imageFilename = path.join(directory, 'cover.png')
    const imageData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    const dataUrl = `data:image/png;base64,${imageData.toString('base64')}`
    await mkdir(directory, {recursive: true})
    await Promise.all([
      writeFile(imageFilename, imageData),
      writeFile(
        entryFilename,
        `import cover from './cover.png'

export function Cover() {
  return <p><img src={cover} alt="cover" /></p>
}

<Cover />
`,
      ),
    ])

    expect(
      errorCodes(
        await check(await Bun.file(entryFilename).text(), {
          filename: entryFilename,
          tsconfig: false,
        }),
      ),
    ).toEqual([])
    const bundled = await bundleFile(entryFilename, {tsconfig: false})
    expect(errorCodes(bundled.diagnostics)).toEqual([])
    expect(bundled.code).toContain(JSON.stringify(dataUrl))

    const root = await runFile(entryFilename, {tsconfig: false})
    expect(root).toMatchObject({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{type: 'image', url: dataUrl, alt: 'cover'}],
        },
      ],
    })

    expect(
      errorCodes(
        await check("import missing from './missing.png'\n\n{missing}\n", {
          filename: entryFilename,
          tsconfig: false,
        }),
      ),
    ).toContain('TS2307')
  })

  test('bundles a relative MarkScript and TypeScript graph without executing it', async () => {
    const globals = globalState()
    delete globals.__markscriptBundleRuns
    const graphDirectory = fixtureName('bundle-graph')
    const entryFilename = path.join(graphDirectory, 'entry.ms')
    const libraryFilename = path.join(graphDirectory, 'library.ms')
    const helperFilename = path.join(graphDirectory, 'helper.ts')
    const output = fixtureName('bundle.mjs')
    await mkdir(graphDirectory, {recursive: true})
    await writeFile(
      helperFilename,
      `const state = globalThis as typeof globalThis & {
  __markscriptBundleRuns?: number
}

state.__markscriptBundleRuns = (state.__markscriptBundleRuns ?? 0) + 1

export const suffix = '!'
`,
    )
    await writeFile(
      libraryFilename,
      `import {suffix} from './helper.ts'

export function decorate(value: string) {
  return value + suffix
}

# Library
`,
    )
    const entrySource = `import libraryDocument, {decorate} from './library.ms'
export {suffix} from './helper.ts'

export const loadLibrary = libraryDocument

# {decorate('Entry')}
`
    await writeFile(entryFilename, entrySource)

    const result = await bundleFile(entryFilename, {
      sourceMap: true,
      tsconfig: false,
    })

    expect(errorCodes(result.diagnostics)).toEqual([])
    expect(globals.__markscriptBundleRuns).toBeUndefined()
    expect(result.map).toBeDefined()
    await writeFile(output, result.code)
    await rm(graphDirectory, {recursive: true, force: true})

    const module = (await import(
      `${pathToFileURL(output).href}?case=${caseNumber}`
    )) as {
      default: () => Promise<Root>
      loadLibrary: () => Promise<Root>
      suffix: string
    }
    expect(module.suffix).toBe('!')
    expect(Number(globals.__markscriptBundleRuns)).toBe(1)
    expect(await module.default()).toMatchObject({
      type: 'root',
      children: [{type: 'heading', depth: 1, children: [{value: 'Entry!'}]}],
    })
    expect(await module.loadLibrary()).toMatchObject({
      type: 'root',
      children: [{type: 'heading', depth: 1, children: [{value: 'Library'}]}],
    })

    if (result.map === undefined)
      throw new Error('Expected a bundle source map')
    await SourceMapConsumer.with(result.map, null, (consumer) => {
      expect(consumer.sourceContentFor(entryFilename)).toBe(entrySource)
    })
  })

  test('keeps ordinary Markdown as semantic MDAST through serialization', async () => {
    const filename = fixtureName('markdown.ms')
    const source = `# Heading

Paragraph with *emphasis*, **strong text**, [a link][spec], \`code\`, and ![alt](/image.png).

> Quoted paragraph.

1. first
2. second

---

hard\\
break

\`\`\`ts title="sample"
const value = 1
\`\`\`

[spec]: /spec "Specification"
`
    await writeFile(filename, source)
    const root = await runFile(filename, {check: false})
    const reparsed = fromMarkdown(toMarkdown(root))

    expect(withoutPositions(reparsed)).toEqual(withoutPositions(root))
  })

  test('defers the body until default entry invocation and preserves named exports', async () => {
    const globals = globalState()
    delete globals.__markscriptModuleRuns
    delete globals.__markscriptRenderRuns

    const filename = fixtureName('abi.ms')
    const source = `export const state = globalThis as typeof globalThis & {
  __markscriptModuleRuns?: number
  __markscriptRenderRuns?: number
}

export const moduleRuns = (
  state.__markscriptModuleRuns = (state.__markscriptModuleRuns ?? 0) + 1
)

export function upper(value: string) {
  return value.toUpperCase()
}

# ABI

{(
  state.__markscriptRenderRuns = (state.__markscriptRenderRuns ?? 0) + 1,
  'rendered'
)}
`
    const result = await compile(source, {filename})
    expect(errorCodes(result.diagnostics)).toEqual([])

    const output = `${filename}.mjs`
    await writeFile(output, result.code)
    const module = (await import(
      `${pathToFileURL(output).href}?case=${caseNumber}`
    )) as {
      default: () => Promise<Root>
      moduleRuns: number
      upper: (value: string) => string
    }

    expect(module.moduleRuns).toBe(1)
    expect(module.upper('markscript')).toBe('MARKSCRIPT')
    expect(Number(globals.__markscriptModuleRuns)).toBe(1)
    expect(globals.__markscriptRenderRuns).toBeUndefined()

    const root = await module.default()
    expect(Number(globals.__markscriptRenderRuns)).toBe(1)
    expect(root.type).toBe('root')
    expect(root.children).toHaveLength(2)
    expect(Object.isFrozen(root)).toBe(true)
  })

  test('runs directives, transform callbacks, and ready callbacks in order', async () => {
    const globals = globalState()
    globals.__markscriptEvents = []
    const filename = fixtureName('lifetime.ms')
    const source = `import {onReady, onTransform} from '@markscript/markscript'

export const state = globalThis as typeof globalThis & {
  __markscriptEvents?: string[]
}

# Report

::ref{id=summary}
## Summary

{onTransform(async ({root}) => {
  await Promise.resolve()
  root.data = {...root.data, transformed: true}
  state.__markscriptEvents?.push('transform')
})}

{onReady(({root}) => {
  state.__markscriptEvents?.push(
    Object.isFrozen(root) ? 'ready:frozen' : 'ready:mutable'
  )
})}
`
    await writeFile(filename, source)
    const root = await runFile(filename)

    expect(globals.__markscriptEvents).toEqual(['transform', 'ready:frozen'])
    expect(
      (root.data as Record<string, unknown> | undefined)?.transformed,
    ).toBe(true)
    expect(
      (root.children[1]?.data as Record<string, unknown> | undefined)?.ref,
    ).toEqual({id: 'summary'})
  })
})

function fixtureName(name: string): string {
  caseNumber += 1
  return path.join(temporaryRoot, `${caseNumber}-${name}`)
}

function errorCodes(diagnostics: readonly {code: string; severity: string}[]) {
  return diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.code)
}

function generatedPoint(source: string, needle: string, innerOffset = 0) {
  const offset = source.indexOf(needle) + innerOffset
  const before = source.slice(0, offset)
  const lines = before.split('\n')
  return {
    line: lines.length,
    column: lines.at(-1)?.length ?? 0,
  }
}

function withoutPositions<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, item) =>
      key === 'position' ? undefined : item,
    ),
  ) as T
}

interface TestGlobalState {
  __markscriptCompileExecuted?: boolean
  __markscriptModuleRuns?: number
  __markscriptRenderRuns?: number
  __markscriptEvents?: string[]
  __markscriptBundleRuns?: number
}

function globalState(): typeof globalThis & TestGlobalState {
  return globalThis as typeof globalThis & TestGlobalState
}
