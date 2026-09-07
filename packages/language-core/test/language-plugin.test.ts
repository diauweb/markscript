import {describe, expect, test} from 'bun:test'
import {createLanguage} from '@volar/language-core'
import ts from 'typescript'
import {
  createMarkscriptLanguagePlugin,
  MarkscriptVirtualCode,
} from '../src/index.ts'

describe('MarkScript Volar language plugin', () => {
  test('projects .ms source into mapped TSX virtual code', () => {
    const plugin = createMarkscriptLanguagePlugin(ts, {
      fileName: (id: string) => id,
    })
    const language = createLanguage([plugin], new Map(), () => undefined)
    const source = 'export const count: number = 1\n\n# Report\n'
    const script = language.scripts.set(
      '/workspace/report.ms',
      ts.ScriptSnapshot.fromString(source),
      'markscript',
    )
    if (!script) throw new Error('Expected MarkScript source registration')

    expect(script.generated?.root).toBeInstanceOf(MarkscriptVirtualCode)
    const root = script.generated?.root as MarkscriptVirtualCode
    const typescript = root.embeddedCodes.find(
      (code) => code.id === 'typescript',
    )
    expect(typescript?.languageId).toBe('typescriptreact')
    expect(
      typescript?.snapshot.getText(0, typescript.snapshot.getLength()),
    ).toContain('const count: number = 1')

    const generatedOffset = typescript?.snapshot
      .getText(0, typescript.snapshot.getLength())
      .indexOf('count')
    const sourceOffset = source.indexOf('count')
    const map = typescript && language.maps.get(typescript, script)
    expect(
      map && generatedOffset !== undefined
        ? [...map.toSourceLocation(generatedOffset)][0]?.[0]
        : undefined,
    ).toBe(sourceOffset)
  })

  test('keeps parser diagnostics on the root virtual code', () => {
    const plugin = createMarkscriptLanguagePlugin(ts, {
      fileName: (id: string) => id,
    })
    const code = plugin.createVirtualCode?.(
      '/workspace/broken.ms',
      'markscript',
      ts.ScriptSnapshot.fromString('{'),
      {getAssociatedScript: () => undefined},
    )
    expect(code?.diagnostics.length).toBeGreaterThan(0)
    expect(code?.embeddedCodes.map((embedded) => embedded.id)).toEqual([
      'markdown',
    ])
  })

  test('keeps only copied TypeScript spans fully feature-enabled', () => {
    const plugin = createMarkscriptLanguagePlugin(ts, {
      fileName: (id: string) => id,
    })
    const source = "import {Card} from './card.ts'\n\n<Card value={count} />\n"
    const code = plugin.createVirtualCode?.(
      '/workspace/report.ms',
      'markscript',
      ts.ScriptSnapshot.fromString(source),
      {getAssociatedScript: () => undefined},
    )
    const typescript = code?.embeddedCodes.find(
      (embedded) => embedded.id === 'typescript',
    )
    const componentStart = source.indexOf('<Card')
    const synthetic = typescript?.mappings.find(
      (mapping) => mapping.sourceOffsets[0] === componentStart,
    )
    const copied = typescript?.mappings.find(
      (mapping) => mapping.sourceOffsets[0] === componentStart + 1,
    )

    expect(synthetic?.data).toEqual({completion: {isAdditional: true}})
    expect(copied?.data).toEqual({
      verification: true,
      completion: true,
      semantic: true,
      navigation: true,
      structure: true,
    })
  })

  test('masks MDX syntax in an offset-preserving Markdown view', () => {
    const plugin = createMarkscriptLanguagePlugin(ts, {
      fileName: (id: string) => id,
    })
    const source = [
      "import {Card} from './card.ts'",
      '',
      '# Outside',
      '',
      '<Card tone={theme}>',
      '## Inside {value}',
      '<Child>nested *Markdown* 😀</Child>',
      '</Card>',
      '',
      '{tail}',
      '',
      '```html',
      '# fenced code',
      '```',
      '',
    ].join('\r\n')
    const code = plugin.createVirtualCode?.(
      '/workspace/report.ms',
      'markscript',
      ts.ScriptSnapshot.fromString(source),
      {getAssociatedScript: () => undefined},
    )
    const markdown = code?.embeddedCodes.find(
      (embedded) => embedded.id === 'markdown',
    )
    if (!markdown) throw new Error('Expected Markdown virtual code')
    const masked = markdown.snapshot.getText(0, markdown.snapshot.getLength())

    expect(masked.length).toBe(source.length)
    for (let index = 0; index < source.length; index++) {
      if (source[index] === '\n' || source[index] === '\r') {
        expect(masked[index]).toBe(source[index])
      }
    }

    const esm = "import {Card} from './card.ts'"
    expect(masked.slice(0, esm.length)).toBe(' '.repeat(esm.length))
    expect(masked).toContain('# Outside')
    expect(masked).toContain('## Inside        ')
    expect(masked).toContain('nested *Markdown* 😀')

    for (const fence of [
      '<Card tone={theme}>',
      '<Child>',
      '</Child>',
      '</Card>',
    ]) {
      const start = source.indexOf(fence)
      expect(masked.slice(start, start + fence.length)).toBe(
        ' '.repeat(fence.length),
      )
    }

    const expression = '{tail}'
    const expressionStart = source.indexOf(expression)
    expect(
      masked.slice(expressionStart, expressionStart + expression.length),
    ).toBe(' '.repeat(expression.length))

    expect(masked).toContain('```html')
    expect(masked).toContain('# fenced code')
    expect(markdown.mappings[0]?.data).toEqual({
      completion: true,
      semantic: {shouldHighlight: expect.any(Function)},
      navigation: true,
      structure: true,
    })
    expect(markdown.mappings[0]?.data.verification).toBeUndefined()
    expect(markdown.mappings[0]?.data.format).toBeUndefined()
    const semantic = markdown.mappings[0]?.data.semantic
    expect(typeof semantic === 'object' && semantic.shouldHighlight?.()).toBe(
      false,
    )
  })

  test('preserves embedded code identity and reports incremental changes', () => {
    const plugin = createMarkscriptLanguagePlugin(ts, {
      fileName: (id: string) => id,
    })
    const language = createLanguage([plugin], new Map(), () => undefined)
    const fileName = '/workspace/report.ms'
    const source = '# Title\n\n{value}\n'
    const script = language.scripts.set(
      fileName,
      ts.ScriptSnapshot.fromString(source),
      'markscript',
    )
    const root = script?.generated?.root as MarkscriptVirtualCode
    const markdown = root.embeddedCodes.find((code) => code.id === 'markdown')
    const typescript = root.embeddedCodes.find(
      (code) => code.id === 'typescript',
    )
    const markdownSnapshot = markdown?.snapshot
    const typescriptSnapshot = typescript?.snapshot

    const nextSource = source.replace('Title', 'Report')
    const updated = language.scripts.set(
      fileName,
      ts.ScriptSnapshot.fromString(nextSource),
      'markscript',
    )
    const updatedRoot = updated?.generated?.root as MarkscriptVirtualCode
    const updatedMarkdown = updatedRoot.embeddedCodes.find(
      (code) => code.id === 'markdown',
    )
    const updatedTypeScript = updatedRoot.embeddedCodes.find(
      (code) => code.id === 'typescript',
    )

    expect(updatedRoot).toBe(root)
    expect(updatedMarkdown).toBe(markdown)
    expect(updatedTypeScript).toBe(typescript)
    expect(
      markdownSnapshot &&
        updatedMarkdown?.snapshot.getChangeRange(markdownSnapshot),
    ).toEqual({span: {start: 2, length: 5}, newLength: 6})
    expect(
      typescriptSnapshot &&
        updatedTypeScript?.snapshot.getChangeRange(typescriptSnapshot),
    ).toBeDefined()
  })

  test('exposes image declarations as an opt-in server service script', () => {
    const plugin = createMarkscriptLanguagePlugin(ts, {
      fileName: (id: string) => id,
      server: {imageAssetTypes: true},
    })
    const code = plugin.createVirtualCode?.(
      '/workspace/report.ms',
      'markscript',
      ts.ScriptSnapshot.fromString('# Report\n'),
      {getAssociatedScript: () => undefined},
    )
    if (!code) throw new Error('Expected MarkScript virtual code')

    const scripts = plugin.typescript?.getExtraServiceScripts?.(
      '/workspace/report.ms',
      code,
    )
    const declaration = scripts?.[0]
    expect(scripts).toHaveLength(1)
    if (!declaration)
      throw new Error('Expected image declaration service script')
    const declarationSource = declaration.code.snapshot.getText(
      0,
      declaration.code.snapshot.getLength(),
    )
    expect(declaration.fileName).toBe(
      '/workspace/report.ms.__markscript_image_asset_types.d.ts',
    )
    expect(code.embeddedCodes).toContain(declaration.code)
    expect(declaration.extension).toBe('.d.ts')
    expect(declarationSource).toContain("declare module '*.png'")
    expect(declarationSource).toContain('const source: string')
    expect(declarationSource).not.toContain('declare const source')
  })
})
