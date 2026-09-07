import {mkdir, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'

const projectPath = '/tmp/markscript-packaged-server-smoke'
const uri = 'file:///tmp/markscript-packaged-server-smoke/document.ms'
const imagePath = path.join(projectPath, 'cover.jpeg')
const componentPath = path.join(projectPath, 'component.tsx')
const componentUri =
  'file:///tmp/markscript-packaged-server-smoke/component.tsx'
const templateInterpolation = '$' + '{root.children.length}'
const invalidTypeScript = 'export const bad: number = "wrong"\n'
const diagnosticFiles = ['broken.ts', 'broken-component.tsx']
const directiveLabel =
  'This long directive label must remain intact when project prose wrapping is enabled and its text exceeds the configured print width'
const source = `import {onReady, onTransform} from '@markscript/markscript'
import cover from './cover.jpeg'
import {Card} from './component.tsx'

export const report={title:'Quarterly'}
export const coverName = cover.toUpperCase()
/**
 * Format a report title.
 * @param value Report to format.
 */
export function titleOf(value: typeof report) {
  return value.title
}

# Intro

:::note[${directiveLabel}]
Body.
:::

# Inline <Card title="Heading" /> text

Escaped \\[link\\](url) stays literal.

Before {1 // expression comment
} after.

{report.title.toString}
{titleOf(report)}

<Card title={123} />

::ref{id=intro tags=public title="Hello *world*" note="a  b" value={1+2}}
::style{role=lead}
## Annotated

<>fragment</>

{
  onTransform(({root}) => {
    root.data = {...root.data, reviewed: true}
  })
}

{
  onReady(({root}) => {
    console.error(\`${templateInterpolation} top-level nodes\`)
  })
}

Read [the manual][manual].

[manual]: https://example.test/manual "Manual documentation"
`

const serverPath = path.resolve(import.meta.dir, '../dist/server.js')

async function main(): Promise<void> {
  await rm(projectPath, {recursive: true, force: true})
  await mkdir(projectPath, {recursive: true})
  await Promise.all([
    ...diagnosticFiles.map((filename) =>
      writeFile(path.join(projectPath, filename), invalidTypeScript),
    ),
    writeFile(
      path.join(projectPath, '.prettierrc.json'),
      JSON.stringify({proseWrap: 'always'}),
    ),
    writeFile(imagePath, new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
    writeFile(
      path.join(projectPath, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ESNext',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            jsx: 'react-jsx',
            jsxImportSource: '@markscript/runtime',
          },
          include: ['**/*.ts', '**/*.tsx', '**/*.ms'],
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      componentPath,
      `/** Render a typed report heading. */
export function Card({title}: {title: string}) {
  return title
}
`,
    ),
  ])
  const client = new StdioLanguageClient(serverPath)
  try {
    const initialized = await client.request<InitializeResult>('initialize', {
      processId: process.pid,
      rootUri: 'file:///tmp/markscript-packaged-server-smoke',
      capabilities: {
        workspace: {configuration: false, workspaceFolders: true},
        textDocument: {
          diagnostic: {dynamicRegistration: false},
          semanticTokens: {
            requests: {full: true},
            tokenTypes: [],
            tokenModifiers: [],
            formats: ['relative'],
          },
        },
      },
      workspaceFolders: [
        {
          uri: 'file:///tmp/markscript-packaged-server-smoke',
          name: 'markscript-packaged-server-smoke',
        },
      ],
    })
    for (const capability of [
      'completionProvider',
      'hoverProvider',
      'signatureHelpProvider',
      'definitionProvider',
      'typeDefinitionProvider',
      'referencesProvider',
      'documentHighlightProvider',
      'renameProvider',
      'codeActionProvider',
      'documentSymbolProvider',
      'foldingRangeProvider',
      'selectionRangeProvider',
      'documentFormattingProvider',
      'workspaceSymbolProvider',
      'semanticTokensProvider',
    ]) {
      assert(capability in initialized.capabilities, `Missing ${capability}`)
    }

    client.notify('initialized', {})
    const diagnosticsPromise = client.notification(
      'textDocument/publishDiagnostics',
      (value) =>
        (value as PublishDiagnostics).uri === uri &&
        (value as PublishDiagnostics).diagnostics?.some((diagnostic) =>
          String(diagnostic.code).startsWith('TS'),
        ) === true,
    )
    client.notify('textDocument/didOpen', {
      textDocument: {uri, languageId: 'markscript', version: 1, text: source},
    })

    const completion = await client.request<CompletionList>(
      'textDocument/completion',
      textPosition(positionAfter('report.title.to')),
    )
    const toUpperCase = completion.items.find(
      (item) => item.label === 'toUpperCase',
    )
    assert(
      toUpperCase,
      `TypeScript member completion is missing: ${completion.items.map((item) => item.label).join(', ')}`,
    )
    const resolved = await client.request<CompletionItem>(
      'completionItem/resolve',
      toUpperCase,
    )
    assert(
      resolved.detail?.includes('toUpperCase'),
      'Completion detail resolution failed',
    )
    assert(
      resolved.documentation?.kind === 'markdown',
      'Completion documentation lacks rich Markdown',
    )
    const imageCompletion = await client.request<CompletionList>(
      'textDocument/completion',
      textPosition(positionAfter('cover.to')),
    )
    assert(
      imageCompletion.items.some((item) => item.label === 'toUpperCase'),
      'Image imports are not typed as strings',
    )

    const signatureHelp = await client.request<SignatureHelp>(
      'textDocument/signatureHelp',
      {
        ...textPosition(positionInside('titleOf(report)', 'titleOf('.length)),
        context: {triggerKind: 1, isRetrigger: false},
      },
    )
    assert(
      signatureHelp.signatures[0]?.label.includes('titleOf'),
      'TypeScript signature help is missing',
    )
    const parameterDocumentation =
      signatureHelp.signatures[0]?.parameters?.[0]?.documentation
    assert(
      (typeof parameterDocumentation === 'string'
        ? parameterDocumentation
        : parameterDocumentation?.value
      )?.includes('Report to format'),
      'Signature parameter documentation is missing',
    )
    const componentSignature = await client.request<SignatureHelp>(
      'textDocument/signatureHelp',
      {
        ...textPosition(positionInside('<Card title', '<Card '.length)),
        context: {triggerKind: 1, isRetrigger: false},
      },
    )
    assert(
      componentSignature.signatures[0]?.label.includes('title: string'),
      'Component signature help is missing',
    )

    const markdownCompletion = await client.request<CompletionList>(
      'textDocument/completion',
      textPosition(positionInside('[manual]', 3)),
    )
    assert(
      markdownCompletion.items.some((item) => item.label === 'manual'),
      'Markdown reference completion is missing',
    )

    const hover = await client.request<Hover>(
      'textDocument/hover',
      textPosition(positionInside('<Card ', 2)),
    )
    assert(
      hover.contents.kind === 'markdown' &&
        hover.contents.value.includes('```typescript') &&
        hover.contents.value.includes('Render a typed report heading'),
      'Rich component JSDoc hover is missing',
    )

    const definitions = await client.request<Location[]>(
      'textDocument/definition',
      textPosition(positionInside('<Card ', 2)),
    )
    assert(
      definitions.some((location) => location.uri === componentUri),
      `Component definition mapping failed: ${definitions.map((location) => location.uri).join(', ')}`,
    )

    const references = await client.request<Location[]>(
      'textDocument/references',
      {
        ...textPosition(positionInside('<Card ', 2)),
        context: {includeDeclaration: true},
      },
    )
    assert(references.length >= 2, 'Component references are missing')

    const typeDefinitions = await client.request<Location[]>(
      'textDocument/typeDefinition',
      textPosition(positionInside('report.title.toString', 2)),
    )
    assert(
      typeDefinitions.some((location) => location.uri === uri),
      'Type definition mapping to MarkScript failed',
    )
    const highlights = await client.request<Array<{range: unknown}>>(
      'textDocument/documentHighlight',
      textPosition(positionInside('report.title.toString', 2)),
    )
    assert(highlights.length >= 3, 'Document highlights are missing')

    const preparedRename = await client.request<
      {start: unknown; end: unknown} | {range: unknown; placeholder?: string}
    >('textDocument/prepareRename', textPosition(positionInside('<Card ', 2)))
    assert(
      preparedRename &&
        (!('placeholder' in preparedRename) ||
          preparedRename.placeholder === undefined ||
          preparedRename.placeholder === 'Card'),
      'Prepare rename missed the authored component',
    )
    const rename = await client.request<WorkspaceEdit>('textDocument/rename', {
      ...textPosition(positionInside('<Card ', 2)),
      newName: 'ReportCard',
    })
    assert(rename.changes?.[uri]?.length, 'Workspace rename returned no edits')
    assert(
      Object.keys(rename.changes ?? {}).every(
        (target) => !target.includes('.ms.tsx'),
      ),
      'Workspace rename leaked a generated filename',
    )

    const sourceActions = await client.request<CodeAction[]>(
      'textDocument/codeAction',
      {
        textDocument: {uri},
        range: {
          start: {line: 0, character: 0},
          end: positionAt(source.length),
        },
        context: {diagnostics: [], only: ['source.organizeImports']},
      },
    )
    const organizeImports = sourceActions.find((action) =>
      action.kind?.startsWith('source.organizeImports'),
    )
    assert(
      organizeImports,
      'Organize Imports is missing from authored MarkScript',
    )
    const resolvedOrganizeImports = organizeImports.edit
      ? organizeImports
      : await client.request<CodeAction>('codeAction/resolve', organizeImports)
    assert(
      resolvedOrganizeImports.edit,
      'Organize Imports did not resolve to an authored edit',
    )

    const semanticProvider = semanticTokenProvider(initialized)
    const semanticTokens = await client.request<{data: number[]}>(
      'textDocument/semanticTokens/full',
      {textDocument: {uri}},
    )
    assert(semanticTokens.data.length > 0, 'Semantic tokens were empty')
    const decodedTokens = decodeSemanticTokens(
      semanticTokens.data,
      semanticProvider.legend.tokenTypes,
    )
    for (const [needle, innerOffset, expectedType] of [
      ['export const', 2, 'keyword'],
      ['# Intro', 2, 'markdownHeading'],
      ['<Card ', 0, 'mdxTagDelimiter'],
      ['<Card ', 2, 'macro'],
      ['::ref', 0, 'directive'],
      ['::style', 0, 'directive'],
      ['<>fragment</>', 0, 'mdxTagDelimiter'],
      ['<>fragment</>', 1, 'mdxTagDelimiter'],
      ['</>', 0, 'mdxTagDelimiter'],
      ['</>', 2, 'mdxTagDelimiter'],
      ['console.error', 9, 'method'],
    ] as const) {
      assert(
        semanticTypeAt(decodedTokens, positionInside(needle, innerOffset)) ===
          expectedType,
        `Expected ${expectedType} semantic highlighting for ${needle}`,
      )
    }
    const onTransformType = semanticTypeAt(
      decodedTokens,
      positionInside('onTransform(({root}', 2),
    )
    const onReadyType = semanticTypeAt(
      decodedTokens,
      positionInside('onReady(({root}', 2),
    )
    assert(
      onTransformType !== undefined && onTransformType === onReadyType,
      'Indented onTransform and onReady expressions have inconsistent TypeScript highlighting',
    )
    assert(
      semanticTypeAt(
        decodedTokens,
        positionInside('onTransform(({root}', 11),
      ) === 'typescriptPunctuation',
      'Indented onTransform expression punctuation lacks TypeScript mapping',
    )

    const symbols = await client.request<Array<{name: string}>>(
      'textDocument/documentSymbol',
      {textDocument: {uri}},
    )
    assert(
      symbols.some((symbol) => symbol.name === '# Intro'),
      `Markdown outline symbol is missing: ${JSON.stringify(symbols)}`,
    )
    const workspaceSymbols = await client.request<Array<{name: string}>>(
      'workspace/symbol',
      {query: 'titleOf'},
    )
    assert(
      workspaceSymbols.some((symbol) => symbol.name.startsWith('titleOf')),
      `Workspace symbol lookup missed authored exports: ${JSON.stringify(workspaceSymbols)}`,
    )
    const folds = await client.request<Array<{startLine: number}>>(
      'textDocument/foldingRange',
      {textDocument: {uri}},
    )
    assert(folds.length > 0, 'Markdown folding ranges are missing')
    const selections = await client.request<Array<{range: unknown}>>(
      'textDocument/selectionRange',
      {
        textDocument: {uri},
        positions: [positionInside('report.title.toString', 8)],
      },
    )
    assert(selections.length === 1, 'Selection ranges are missing')
    const formatting = await client.request<TextEdit[]>(
      'textDocument/formatting',
      {
        textDocument: {uri},
        options: {tabSize: 2, insertSpaces: true},
      },
    )
    assert(
      formatting.length === 1 && formatting[0]?.newText.includes('# Intro'),
      'Format Document returned invalid MarkScript text',
    )
    assert(
      formatting[0]?.newText.includes('title="Hello *world*"') &&
        formatting[0]?.newText.includes('note="a  b"') &&
        formatting[0]?.newText.includes('1 + 2'),
      'Format Document changed directive literals or skipped expression formatting',
    )
    assert(
      formatting[0]?.newText.includes('\\[link\\](url)') &&
        /\{1 \/\/ expression comment\r?\n\} after\./.test(
          formatting[0]?.newText ?? '',
        ),
      `Format Document changed escaped prose or leaked an expression comment: ${JSON.stringify(formatting[0]?.newText)}`,
    )
    assert(
      formatting[0]?.newText.includes('# Inline <Card title="Heading" /> text'),
      'Format Document moved inline JSX out of its heading',
    )
    assert(
      formatting[0]?.newText.includes(`:::note[${directiveLabel}]\n`),
      'Format Document wrapped a container directive label',
    )

    const diagnostics = (await diagnosticsPromise) as PublishDiagnostics
    assert(
      diagnostics.diagnostics.some((diagnostic) =>
        String(diagnostic.code).startsWith('TS'),
      ),
      'TypeScript diagnostics are missing',
    )

    const markscriptReport = await client.request<{
      items: PublishDiagnostics['diagnostics']
    }>('textDocument/diagnostic', {textDocument: {uri}})
    assert(
      markscriptReport.items.some((diagnostic) =>
        String(diagnostic.code).startsWith('TS'),
      ) &&
        !markscriptReport.items.some(
          (diagnostic) => typeof diagnostic.code === 'number',
        ),
      `MarkScript diagnostics must come from the compiler provider alone: ${JSON.stringify(markscriptReport.items)}`,
    )

    for (const filename of diagnosticFiles) {
      const documentUri = `file://${path.join(projectPath, filename)}`
      client.notify('textDocument/didOpen', {
        textDocument: {
          uri: documentUri,
          languageId: filename.endsWith('.tsx')
            ? 'typescriptreact'
            : 'typescript',
          version: 1,
          text: invalidTypeScript,
        },
      })
      const report = await client.request<{
        items: PublishDiagnostics['diagnostics']
      }>('textDocument/diagnostic', {textDocument: {uri: documentUri}})
      assert(
        report.items.filter((diagnostic) => diagnostic.code === 2322).length ===
          1,
        `Expected one TypeScript assignment diagnostic for ${filename}: ${JSON.stringify(report.items)}`,
      )
      client.notify('textDocument/didChange', {
        textDocument: {uri: documentUri, version: 2},
        contentChanges: [{text: 'export const bad: number = 42\n'}],
      })
      const corrected = await client.request<{
        items: PublishDiagnostics['diagnostics']
      }>('textDocument/diagnostic', {textDocument: {uri: documentUri}})
      assert(
        !corrected.items.some((diagnostic) => diagnostic.code === 2322),
        `TypeScript diagnostics were stale after correcting ${filename}`,
      )
    }

    console.log(
      `Packaged LSP smoke passed: ${completion.items.length} TS completions, ${semanticTokens.data.length / 5} semantic tokens, ${diagnostics.diagnostics.length} diagnostics`,
    )
  } finally {
    await client.close()
    await rm(projectPath, {recursive: true, force: true})
  }
}

class StdioLanguageClient {
  readonly #process: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
  readonly #pending = new Map<
    number,
    {resolve: (value: unknown) => void; reject: (error: Error) => void}
  >()
  readonly #notifications = new Map<
    string,
    Array<{
      predicate: (value: unknown) => boolean
      resolve: (value: unknown) => void
    }>
  >()
  readonly #readTask: Promise<void>
  #nextId = 1

  constructor(serverPath: string) {
    this.#process = Bun.spawn([process.execPath, serverPath, '--stdio'], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    this.#readTask = this.#read()
  }

  request<Result>(method: string, params: unknown): Promise<Result> {
    const id = this.#nextId
    this.#nextId += 1
    const response = new Promise<Result>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: (value) => resolve(value as Result),
        reject,
      })
    })
    this.#send({jsonrpc: '2.0', id, method, params})
    return withTimeout(response, method)
  }

  notify(method: string, params: unknown): void {
    this.#send({jsonrpc: '2.0', method, params})
  }

  notification(
    method: string,
    predicate: (value: unknown) => boolean = () => true,
  ): Promise<unknown> {
    return withTimeout(
      new Promise((resolve) => {
        const listeners = this.#notifications.get(method) ?? []
        listeners.push({predicate, resolve})
        this.#notifications.set(method, listeners)
      }),
      method,
    )
  }

  async close(): Promise<void> {
    try {
      await this.request('shutdown', null)
      this.notify('exit', null)
    } catch {
      this.#process.kill()
    }
    await this.#process.exited
    await this.#readTask
    const stderr = await new Response(this.#process.stderr).text()
    if (stderr.trim()) throw new Error(stderr.trim())
  }

  #send(message: unknown): void {
    const body = JSON.stringify(message)
    this.#process.stdin.write(
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    )
    this.#process.stdin.flush()
  }

  async #read(): Promise<void> {
    const reader = this.#process.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer = appendBytes(buffer, chunk.value)
      while (true) {
        const separator = headerSeparator(buffer)
        if (separator < 0) break
        const header = decoder.decode(buffer.slice(0, separator))
        const length = Number(/Content-Length:\s*(\d+)/iu.exec(header)?.[1])
        const bodyStart = separator + 4
        if (!Number.isFinite(length) || buffer.length < bodyStart + length)
          break
        const body = decoder.decode(buffer.slice(bodyStart, bodyStart + length))
        buffer = buffer.slice(bodyStart + length)
        this.#receive(JSON.parse(body) as JsonRpcMessage)
      }
    }
  }

  #receive(message: JsonRpcMessage): void {
    if (typeof message.id === 'number') {
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
      return
    }
    if (!message.method) return
    const listeners = this.#notifications.get(message.method) ?? []
    const remaining = listeners.filter((listener) => {
      if (!listener.predicate(message.params)) return true
      listener.resolve(message.params)
      return false
    })
    if (remaining.length > 0) {
      this.#notifications.set(message.method, remaining)
    } else {
      this.#notifications.delete(message.method)
    }
  }
}

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length)
  result.set(left)
  result.set(right, left.length)
  return result
}

function headerSeparator(value: Uint8Array): number {
  for (let index = 0; index <= value.length - 4; index += 1) {
    if (
      value[index] === 13 &&
      value[index + 1] === 10 &&
      value[index + 2] === 13 &&
      value[index + 3] === 10
    ) {
      return index
    }
  }
  return -1
}

interface JsonRpcMessage {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: {message: string}
}

interface InitializeResult {
  capabilities: Record<string, unknown>
}

interface SemanticTokenProvider {
  legend: {tokenTypes: string[]; tokenModifiers: string[]}
}

interface DecodedSemanticToken {
  line: number
  start: number
  length: number
  type: string
}

interface CompletionItem {
  label: string
  detail?: string
  documentation?: {kind: string; value: string}
  data?: unknown
}

interface CompletionList {
  items: CompletionItem[]
}

interface Hover {
  contents: {kind: string; value: string}
}

interface SignatureHelp {
  signatures: Array<{
    label: string
    parameters?: Array<{documentation?: {kind: string; value: string}}>
  }>
}

interface Location {
  uri: string
}

interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>
}

interface TextEdit {
  newText: string
}

interface CodeAction {
  kind?: string
  edit?: WorkspaceEdit
  data?: unknown
}

interface PublishDiagnostics {
  uri: string
  diagnostics: Array<{code?: string | number}>
}

function textPosition(position: {line: number; character: number}) {
  return {textDocument: {uri}, position}
}

function positionAfter(needle: string) {
  return positionAt(source.indexOf(needle) + needle.length)
}

function positionInside(needle: string, innerOffset: number) {
  return positionAt(source.indexOf(needle) + innerOffset)
}

function positionAt(offset: number) {
  const lines = source.slice(0, offset).split('\n')
  return {line: lines.length - 1, character: lines.at(-1)?.length ?? 0}
}

function semanticTokenProvider(
  initialized: InitializeResult,
): SemanticTokenProvider {
  const provider = initialized.capabilities.semanticTokensProvider
  assert(
    typeof provider === 'object' && provider !== null && 'legend' in provider,
    'Semantic token legend is missing',
  )
  return provider as SemanticTokenProvider
}

function decodeSemanticTokens(
  data: number[],
  tokenTypes: string[],
): DecodedSemanticToken[] {
  const result: DecodedSemanticToken[] = []
  let line = 0
  let start = 0
  for (let index = 0; index < data.length; index += 5) {
    const deltaLine = data[index] ?? 0
    line += deltaLine
    start =
      deltaLine === 0 ? start + (data[index + 1] ?? 0) : (data[index + 1] ?? 0)
    const type = tokenTypes[data[index + 3] ?? -1]
    assert(type, `Unknown semantic token type index ${data[index + 3]}`)
    result.push({line, start, length: data[index + 2] ?? 0, type})
  }
  return result
}

function semanticTypeAt(
  tokens: DecodedSemanticToken[],
  position: {line: number; character: number},
): string | undefined {
  return tokens.find(
    (token) =>
      token.line === position.line &&
      token.start <= position.character &&
      position.character < token.start + token.length,
  )?.type
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function withTimeout<Result>(
  promise: Promise<Result>,
  label: string,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${label}`)),
      15_000,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

await main()
