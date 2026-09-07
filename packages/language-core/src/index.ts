import {
  createTypeScriptProjection,
  type Diagnostic,
  imageAssetTypeScriptModule,
  type MarkscriptNode,
  parseMarkscript,
  type TypeScriptProjection,
} from '@markscript/compiler'
import type {
  CodeInformation,
  CodeMapping,
  IScriptSnapshot,
  LanguagePlugin,
  VirtualCode,
} from '@volar/language-core'
import type {TypeScriptExtraServiceScript} from '@volar/typescript'
import type ts from 'typescript'

export interface MarkscriptLanguagePluginOptions<ScriptId> {
  fileName(scriptId: ScriptId): string
  server?: {
    imageAssetTypes?: boolean
  }
}

const markscriptFeatures: CodeInformation = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
  format: true,
}

const markdownFeatures: CodeInformation = {
  completion: true,
  semantic: {shouldHighlight: () => false},
  navigation: true,
  structure: true,
}

const copiedTypeScriptFeatures: CodeInformation = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
}

const syntheticTypeScriptFeatures: CodeInformation = {
  completion: {isAdditional: true},
}

export class MarkscriptVirtualCode implements VirtualCode {
  readonly id = 'markscript'
  readonly languageId = 'markscript'
  readonly mappings: CodeMapping[] = []
  readonly embeddedCodes: VirtualCode[] = []
  projection: TypeScriptProjection
  private readonly imageAssetTypesCode: ImageTypeScriptCode | undefined
  private readonly markdownCode: MarkscriptMarkdownCode
  private readonly typescriptCode: MarkscriptTypeScriptCode

  constructor(
    readonly fileName: string,
    public snapshot: IScriptSnapshot,
    typescript: typeof ts,
    imageAssetTypes: boolean,
  ) {
    const source = snapshotText(snapshot)
    this.projection = createTypeScriptProjection(source, fileName)
    this.markdownCode = new MarkscriptMarkdownCode(
      markdownSource(source, fileName),
      typescript,
    )
    this.typescriptCode = new MarkscriptTypeScriptCode('', [], typescript)
    this.imageAssetTypesCode = imageAssetTypes
      ? new ImageTypeScriptCode(
          'markscript-image-asset-types',
          typescript,
          imageAssetTypeDeclarations(),
        )
      : undefined
    this.refresh()
  }

  get diagnostics(): readonly Diagnostic[] {
    return this.projection.diagnostics
  }

  update(snapshot: IScriptSnapshot): void {
    this.snapshot = snapshot
    const source = snapshotText(snapshot)
    this.projection = createTypeScriptProjection(source, this.fileName)
    this.markdownCode.update(markdownSource(source, this.fileName))
    this.refresh()
  }

  private refresh(): void {
    const sourceLength = this.snapshot.getLength()
    this.mappings.splice(
      0,
      this.mappings.length,
      identityMapping(sourceLength, markscriptFeatures),
    )
    const generated = this.projection.generated
    this.embeddedCodes.splice(0, this.embeddedCodes.length, this.markdownCode)
    if (generated) {
      this.typescriptCode.update(
        generated.code,
        generated.spans.map((span) =>
          typescriptMapping(span, this.projection.source, generated.code),
        ),
      )
      this.embeddedCodes.push(this.typescriptCode)
    }
    if (this.imageAssetTypesCode)
      this.embeddedCodes.push(this.imageAssetTypesCode)
  }
}

export class MarkscriptMarkdownCode implements VirtualCode {
  readonly id = 'markdown'
  readonly languageId = 'markdown'
  readonly mappings: CodeMapping[] = []
  snapshot: IScriptSnapshot

  constructor(
    source: string,
    private readonly typescript: typeof ts,
  ) {
    this.snapshot = new IncrementalSnapshot(source, undefined, typescript)
    this.refreshMapping()
  }

  update(source: string): void {
    this.snapshot = updateSnapshot(this.snapshot, source, this.typescript)
    this.refreshMapping()
  }

  private refreshMapping(): void {
    this.mappings.splice(
      0,
      this.mappings.length,
      identityMapping(this.snapshot.getLength(), markdownFeatures),
    )
  }
}

export class MarkscriptTypeScriptCode implements VirtualCode {
  readonly id = 'typescript'
  readonly languageId = 'typescriptreact'
  snapshot: IScriptSnapshot

  constructor(
    source: string,
    readonly mappings: CodeMapping[],
    private readonly typescript: typeof ts,
  ) {
    this.snapshot = new IncrementalSnapshot(source, undefined, typescript)
  }

  update(source: string, mappings: CodeMapping[]): void {
    this.snapshot = updateSnapshot(this.snapshot, source, this.typescript)
    this.mappings.splice(0, this.mappings.length, ...mappings)
  }
}

class ImageTypeScriptCode implements VirtualCode {
  readonly languageId = 'typescript'
  readonly mappings: CodeMapping[] = []
  readonly snapshot: IScriptSnapshot

  constructor(
    readonly id: string,
    typescript: typeof ts,
    source = imageAssetTypeScriptModule,
  ) {
    this.snapshot = typescript.ScriptSnapshot.fromString(source)
  }
}

export function createMarkscriptLanguagePlugin<ScriptId>(
  typescript: typeof ts,
  options: MarkscriptLanguagePluginOptions<ScriptId>,
): LanguagePlugin<ScriptId, MarkscriptVirtualCode> {
  const imageAssetTypes = options.server?.imageAssetTypes === true

  return {
    getLanguageId(scriptId) {
      return options.fileName(scriptId).endsWith('.ms')
        ? 'markscript'
        : undefined
    },
    createVirtualCode(scriptId, languageId, snapshot) {
      if (languageId !== 'markscript') return undefined
      return new MarkscriptVirtualCode(
        options.fileName(scriptId),
        snapshot,
        typescript,
        imageAssetTypes,
      )
    },
    updateVirtualCode(_scriptId, virtualCode, snapshot) {
      virtualCode.update(snapshot)
      return virtualCode
    },
    typescript: {
      extraFileExtensions: [
        {
          extension: 'ms',
          isMixedContent: true,
          scriptKind: typescript.ScriptKind.Deferred,
        },
      ],
      getServiceScript(root: VirtualCode) {
        const code = root.embeddedCodes?.find(
          (embedded) => embedded.id === 'typescript',
        )
        return code
          ? {code, extension: '.tsx', scriptKind: typescript.ScriptKind.TSX}
          : undefined
      },
      ...(imageAssetTypes
        ? {
            getExtraServiceScripts(fileName: string, root: VirtualCode) {
              const code = root.embeddedCodes?.find(
                (embedded) => embedded.id === 'markscript-image-asset-types',
              )
              return code
                ? ([
                    {
                      fileName: extraServiceScriptFileName(fileName),
                      code,
                      extension: '.d.ts',
                      scriptKind: typescript.ScriptKind.TS,
                    },
                  ] satisfies TypeScriptExtraServiceScript[])
                : []
            },
          }
        : {}),
    },
  }
}

function snapshotText(snapshot: IScriptSnapshot): string {
  return snapshot.getText(0, snapshot.getLength())
}

class IncrementalSnapshot implements IScriptSnapshot {
  readonly changeRange: ts.TextChangeRange | undefined

  constructor(
    private readonly text: string,
    readonly previous: IScriptSnapshot | undefined,
    typescript: typeof ts,
  ) {
    this.changeRange = previous
      ? textChangeRange(snapshotText(previous), text, typescript)
      : undefined
  }

  getText(start: number, end: number): string {
    return this.text.slice(start, end)
  }

  getLength(): number {
    return this.text.length
  }

  getChangeRange(oldSnapshot: IScriptSnapshot): ts.TextChangeRange | undefined {
    return oldSnapshot === this.previous ? this.changeRange : undefined
  }
}

function updateSnapshot(
  current: IScriptSnapshot,
  source: string,
  typescript: typeof ts,
): IScriptSnapshot {
  return snapshotText(current) === source
    ? current
    : new IncrementalSnapshot(source, current, typescript)
}

function textChangeRange(
  previous: string,
  next: string,
  typescript: typeof ts,
): ts.TextChangeRange {
  let start = 0
  const sharedLength = Math.min(previous.length, next.length)
  while (start < sharedLength && previous[start] === next[start]) start++

  let previousEnd = previous.length
  let nextEnd = next.length
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd--
    nextEnd--
  }

  return typescript.createTextChangeRange(
    typescript.createTextSpan(start, previousEnd - start),
    nextEnd - start,
  )
}

function typescriptMapping(
  span: {
    generatedStart: number
    generatedEnd: number
    sourceStart: number
    sourceEnd: number
  },
  source: string,
  generated: string,
): CodeMapping {
  const sourceLength = span.sourceEnd - span.sourceStart
  const generatedLength = span.generatedEnd - span.generatedStart
  const isCopiedSource =
    sourceLength === generatedLength &&
    source.slice(span.sourceStart, span.sourceEnd) ===
      generated.slice(span.generatedStart, span.generatedEnd)

  return {
    sourceOffsets: [span.sourceStart],
    generatedOffsets: [span.generatedStart],
    lengths: [sourceLength],
    generatedLengths: [generatedLength],
    data: isCopiedSource
      ? copiedTypeScriptFeatures
      : syntheticTypeScriptFeatures,
  }
}

function markdownSource(source: string, fileName: string): string {
  const tree = parseMarkscript(source, fileName).tree
  if (!tree) return source

  const characters = source.split('')
  maskMarkdownSyntax(tree, source, characters)
  return characters.join('')
}

function maskMarkdownSyntax(
  node: MarkscriptNode,
  source: string,
  characters: string[],
): void {
  const range = nodeRange(node)
  if (node.type === 'mdxjsEsm' || isExpressionNode(node)) {
    if (range) maskRange(characters, range.start, range.end)
    return
  }

  if (isJsxNode(node) && range) {
    const childRanges = (node.children ?? [])
      .map(nodeRange)
      .filter((child): child is SourceRange => child !== undefined)
    const firstChild = childRanges[0]
    const lastChild = childRanges.at(-1)

    if (!firstChild || !lastChild) {
      maskRange(characters, range.start, range.end)
      return
    }

    const openingEnd = source.lastIndexOf('>', firstChild.start - 1)
    maskRange(
      characters,
      range.start,
      openingEnd >= range.start ? openingEnd + 1 : firstChild.start,
    )

    const closingStart = source.indexOf('</', lastChild.end)
    if (closingStart >= lastChild.end && closingStart < range.end) {
      maskRange(characters, closingStart, range.end)
    }
  }

  for (const child of node.children ?? []) {
    maskMarkdownSyntax(child, source, characters)
  }
}

interface SourceRange {
  start: number
  end: number
}

function nodeRange(node: MarkscriptNode): SourceRange | undefined {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return typeof start === 'number' && typeof end === 'number'
    ? {start, end}
    : undefined
}

function isExpressionNode(node: MarkscriptNode): boolean {
  return node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression'
}

function isJsxNode(node: MarkscriptNode): boolean {
  return node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement'
}

function maskRange(characters: string[], start: number, end: number): void {
  for (let index = start; index < end; index++) {
    if (characters[index] !== '\n' && characters[index] !== '\r') {
      characters[index] = ' '
    }
  }
}

function imageAssetTypeDeclarations(): string {
  const moduleBody = imageAssetTypeScriptModule
    .replace(/^declare /gmu, '')
    .trimEnd()
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
  return ['bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg']
    .map((extension) => `declare module '*.${extension}' {\n${moduleBody}\n}`)
    .join('\n\n')
}

function extraServiceScriptFileName(fileName: string): string {
  return `${fileName}.__markscript_image_asset_types.d.ts`
}

function identityMapping(length: number, data: CodeInformation): CodeMapping {
  return {
    sourceOffsets: [0],
    generatedOffsets: [0],
    lengths: [length],
    data,
  }
}
