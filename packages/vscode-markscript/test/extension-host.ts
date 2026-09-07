import assert from 'node:assert/strict'
import * as vscode from 'vscode'

const extensionId = 'markscript.markscript-vscode'
const timeoutMilliseconds = 30_000

interface VolarLabsExports {
  volarLabs: {
    version: string
    languageClients: unknown[]
    languageServerProtocol: {
      GetVirtualFileRequest?: unknown
      GetVirtualCodeRequest?: unknown
    }
  }
}

export async function run(): Promise<void> {
  const bun = process.env.MARKSCRIPT_BUN
  assert.ok(bun, 'MARKSCRIPT_BUN must name the Bun executable')
  await vscode.workspace
    .getConfiguration('markscript.server')
    .update('runtime', bun, vscode.ConfigurationTarget.Global)

  const extension = vscode.extensions.getExtension(extensionId)
  assert.ok(extension, `Extension ${extensionId} failed to load`)
  const extensionExports = (await extension.activate()) as VolarLabsExports
  assert.equal(extension.isActive, true)
  assert.match(extensionExports.volarLabs.version, /^\d+\.\d+\.\d+$/u)
  assert.equal(extensionExports.volarLabs.languageClients.length, 1)
  assert.ok(
    extensionExports.volarLabs.languageServerProtocol.GetVirtualFileRequest,
  )
  assert.ok(
    extensionExports.volarLabs.languageServerProtocol.GetVirtualCodeRequest,
  )

  const editor = await openWorkspaceDocument('editor.ms')
  assert.equal(editor.document.languageId, 'markscript')

  await testDiagnosticsAndDependencyRefresh(editor.document)
  await testLanguageFeatures(editor.document)
  await testProjectConfigurationRefresh(editor.document)
  await testFormatting()
  await testTypeScriptImportingMarkscript()
  await testCommands(extensionExports)

  console.log('MarkScript Extension Development Host workflows passed')
}

async function testProjectConfigurationRefresh(
  document: vscode.TextDocument,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]
  assert.ok(folder)
  const configUri = vscode.Uri.joinPath(folder.uri, 'tsconfig.json')
  const originalConfig = await vscode.workspace.fs.readFile(configUri)

  await replace(document, "'ready'", 'undefined')
  try {
    await waitFor(
      () =>
        vscode.languages
          .getDiagnostics(document.uri)
          .find((candidate) => String(candidate.code) === 'TS2322'),
      'strict project diagnostics before a configuration edit',
    )

    const relaxedConfig = JSON.parse(originalConfig.toString()) as {
      compilerOptions: {strict: boolean}
    }
    relaxedConfig.compilerOptions.strict = false
    await vscode.workspace.fs.writeFile(
      configUri,
      Buffer.from(`${JSON.stringify(relaxedConfig, null, 2)}\n`),
    )
    await waitFor(
      () =>
        vscode.languages
          .getDiagnostics(document.uri)
          .every((candidate) => String(candidate.code) !== 'TS2322'),
      'diagnostics to refresh after relaxing tsconfig strictness',
    )

    await vscode.workspace.fs.writeFile(configUri, originalConfig)
    await waitFor(
      () =>
        vscode.languages
          .getDiagnostics(document.uri)
          .find((candidate) => String(candidate.code) === 'TS2322'),
      'diagnostics to refresh after restoring tsconfig strictness',
    )
  } finally {
    await vscode.workspace.fs.writeFile(configUri, originalConfig)
    if (document.getText().includes('undefined')) {
      await replace(document, 'undefined', "'ready'")
    }
  }

  await waitFor(
    () =>
      vscode.languages
        .getDiagnostics(document.uri)
        .every((candidate) => String(candidate.code) !== 'TS2322'),
    'the temporary configuration diagnostic to clear',
  )
}

async function testDiagnosticsAndDependencyRefresh(
  document: vscode.TextDocument,
): Promise<void> {
  const readyRange = rangeOf(document, "'ready'")
  const edit = new vscode.WorkspaceEdit()
  edit.replace(document.uri, readyRange, '123')
  assert.equal(await vscode.workspace.applyEdit(edit), true)

  const diagnostic = await waitFor(
    () =>
      vscode.languages
        .getDiagnostics(document.uri)
        .find((candidate) => String(candidate.code) === 'TS2322'),
    'a mapped TS2322 diagnostic',
  )
  assert.equal(diagnostic.range.start.line, 4)
  assert.match(diagnostic.message, /not assignable/u)

  await replace(document, '123', "'ready'")
  await waitFor(
    () =>
      vscode.languages
        .getDiagnostics(document.uri)
        .every((candidate) => String(candidate.code) !== 'TS2322'),
    'the stale TS2322 diagnostic to clear',
  )

  const utility = await openWorkspaceDocument('utility.ts')
  await replace(utility.document, 'name: string', 'name: number')
  await waitFor(
    () =>
      vscode.languages
        .getDiagnostics(document.uri)
        .find((candidate) => String(candidate.code) === 'TS2345'),
    'a dependency-edit diagnostic in the open MarkScript document',
  )
  await replace(utility.document, 'name: number', 'name: string')
  await utility.document.save()
  await waitFor(
    () =>
      vscode.languages
        .getDiagnostics(document.uri)
        .every((candidate) => String(candidate.code) !== 'TS2345'),
    'the dependency-edit diagnostic to clear',
  )
}

async function testLanguageFeatures(
  document: vscode.TextDocument,
): Promise<void> {
  const cardPosition = positionOf(document, '<Card', 2)
  await waitFor(async () => {
    const definitions = await vscode.commands.executeCommand<
      (vscode.Location | vscode.LocationLink)[]
    >('vscode.executeDefinitionProvider', document.uri, cardPosition)
    return definitions.some((location) =>
      definitionUri(location).fsPath.endsWith('component.tsx'),
    )
  }, 'Card definition to resolve to authored component.tsx after the project reload')

  const libraryPosition = positionOf(document, '{libraryValue}', 2)
  const libraryDefinitions = await vscode.commands.executeCommand<
    (vscode.Location | vscode.LocationLink)[]
  >('vscode.executeDefinitionProvider', document.uri, libraryPosition)
  assert.ok(
    libraryDefinitions.some((location) =>
      definitionUri(location).fsPath.endsWith('library.ms'),
    ),
    'libraryValue definition must resolve to authored library.ms',
  )
  assert.ok(
    libraryDefinitions.every(
      (location) => !definitionUri(location).fsPath.includes('.ms.ts'),
    ),
    'navigation must expose authored MarkScript files exclusively',
  )

  const greetPosition = positionOf(document, "greet('MarkScript')", 2)
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    document.uri,
    greetPosition,
  )
  assert.match(markdownText(hovers), /greet\(name: string\): string/u)

  const titleRange = rangeOf(document, 'title')
  const edit = new vscode.WorkspaceEdit()
  edit.replace(document.uri, titleRange, 'ti')
  assert.equal(await vscode.workspace.applyEdit(edit), true)
  const completionPosition = titleRange.start.translate(0, 2)
  await waitFor(async () => {
    const completions =
      await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        document.uri,
        completionPosition,
      )
    return completions.items.find(
      (item) =>
        (typeof item.label === 'string' ? item.label : item.label.label) ===
        'title',
    )
  }, 'imported Card props to include title completion')
  await replace(document, 'ti=', 'title=')

  const signaturePosition = positionOf(document, '<Card ', '<Card '.length)
  const signature = await vscode.commands.executeCommand<vscode.SignatureHelp>(
    'vscode.executeSignatureHelpProvider',
    document.uri,
    signaturePosition,
    '<',
  )
  assert.ok(
    signature.signatures.some((item) => /CardProps/u.test(item.label)),
    'component signature help must use the imported CardProps type',
  )

  await waitFor(async () => {
    const symbols = await vscode.commands.executeCommand<
      (vscode.DocumentSymbol | vscode.SymbolInformation)[]
    >('vscode.executeDocumentSymbolProvider', document.uri)
    return symbols.some((symbol) => symbol.name === '# Editor')
  }, 'the # Editor document symbol')

  const folds = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
    'vscode.executeFoldingRangeProvider',
    document.uri,
  )
  assert.ok(folds.length > 0, 'Markdown sections must be foldable')

  const legend =
    await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
      'vscode.provideDocumentSemanticTokensLegend',
      document.uri,
    )
  const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
    'vscode.provideDocumentSemanticTokens',
    document.uri,
  )
  assert.ok(legend.tokenTypes.includes('typescriptPunctuation'))
  assert.ok(legend.tokenTypes.includes('markdownHeading'))
  assert.ok(legend.tokenTypes.includes('mdxTagDelimiter'))
  assert.ok(
    tokens.data.length > 0,
    'semantic token provider returned no tokens',
  )
  const cardFence = document.positionAt(document.getText().indexOf('<Card'))
  assert.equal(
    semanticTokenTypeAt(tokens, legend, cardFence),
    'mdxTagDelimiter',
  )
}

function semanticTokenTypeAt(
  tokens: vscode.SemanticTokens,
  legend: vscode.SemanticTokensLegend,
  position: vscode.Position,
): string | undefined {
  let line = 0
  let character = 0
  for (let index = 0; index < tokens.data.length; index += 5) {
    const deltaLine = tokens.data[index] ?? 0
    line += deltaLine
    character =
      deltaLine === 0
        ? character + (tokens.data[index + 1] ?? 0)
        : (tokens.data[index + 1] ?? 0)
    const length = tokens.data[index + 2] ?? 0
    if (
      line === position.line &&
      character <= position.character &&
      position.character < character + length
    ) {
      return legend.tokenTypes[tokens.data[index + 3] ?? -1]
    }
  }
  return undefined
}

async function testFormatting(): Promise<void> {
  const editor = await openWorkspaceDocument('format.ms')
  const document = editor.document
  const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    'vscode.executeFormatDocumentProvider',
    document.uri,
    {insertSpaces: true, tabSize: 2},
  )
  assert.ok(edits.length > 0, 'Format Document returned no edits')
  const workspaceEdit = new vscode.WorkspaceEdit()
  workspaceEdit.set(document.uri, edits)
  assert.equal(await vscode.workspace.applyEdit(workspaceEdit), true)
  assert.match(document.getText(), /export const value =/u)
  await waitFor(
    () => vscode.languages.getDiagnostics(document.uri).length === 0,
    'formatted MarkScript to remain valid',
  )
  await replaceDocument(document, unformattedSource)
  await document.save()
}

async function testTypeScriptImportingMarkscript(): Promise<void> {
  const editor = await openWorkspaceDocument('consumer.ts')
  const document = editor.document
  await waitFor(
    () =>
      vscode.languages
        .getDiagnostics(document.uri)
        .every((diagnostic) => String(diagnostic.code) !== '2307'),
    'the Volar TypeScript project to resolve the imported .ms module',
  )

  const valuePosition = positionOf(document, 'literal: 42 = libraryValue', 16)
  const definitions = await vscode.commands.executeCommand<
    (vscode.Location | vscode.LocationLink)[]
  >('vscode.executeDefinitionProvider', document.uri, valuePosition)
  assert.ok(
    definitions.some((location) =>
      definitionUri(location).fsPath.endsWith('library.ms'),
    ),
    'TypeScript navigation must land on the authored .ms export',
  )

  const resultPosition = positionOf(document, 'entryResult', 2)
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    document.uri,
    resultPosition,
  )
  assert.match(markdownText(hovers), /Promise<Root>/u)
}

async function testCommands(extensionExports: VolarLabsExports): Promise<void> {
  await openWorkspaceDocument('run.ms')
  await vscode.commands.executeCommand('markscript.checkFile')
  await vscode.commands.executeCommand('markscript.checkWorkspace')
  await vscode.commands.executeCommand('markscript.runFile')
  const marker = process.env.MARKSCRIPT_EXTENSION_TEST_MARKER
  assert.ok(marker)
  await waitFor(async () => {
    try {
      return (await vscode.workspace.fs.readFile(vscode.Uri.file(marker)))
        .toString()
        .includes('ran')
    } catch {
      return false
    }
  }, 'Run File to complete the document lifetime')
  const previousClient = extensionExports.volarLabs.languageClients[0]
  await vscode.commands.executeCommand('markscript.restartLanguageServer')
  assert.equal(extensionExports.volarLabs.languageClients.length, 1)
  assert.notEqual(extensionExports.volarLabs.languageClients[0], previousClient)
  await vscode.commands.executeCommand('markscript.showLanguageServerOutput')
}

async function openWorkspaceDocument(name: string): Promise<vscode.TextEditor> {
  const folder = vscode.workspace.workspaceFolders?.[0]
  assert.ok(folder, 'The extension test workspace failed to open')
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, name),
  )
  return vscode.window.showTextDocument(document)
}

async function replace(
  document: vscode.TextDocument,
  search: string,
  replacement: string,
): Promise<void> {
  const edit = new vscode.WorkspaceEdit()
  edit.replace(document.uri, rangeOf(document, search), replacement)
  assert.equal(await vscode.workspace.applyEdit(edit), true)
}

async function replaceDocument(
  document: vscode.TextDocument,
  source: string,
): Promise<void> {
  const edit = new vscode.WorkspaceEdit()
  edit.replace(
    document.uri,
    new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length),
    ),
    source,
  )
  assert.equal(await vscode.workspace.applyEdit(edit), true)
}

function rangeOf(document: vscode.TextDocument, text: string): vscode.Range {
  const offset = document.getText().indexOf(text)
  assert.notEqual(offset, -1, `Missing text ${JSON.stringify(text)}`)
  return new vscode.Range(
    document.positionAt(offset),
    document.positionAt(offset + text.length),
  )
}

function positionOf(
  document: vscode.TextDocument,
  text: string,
  within: number,
): vscode.Position {
  const offset = document.getText().indexOf(text)
  assert.notEqual(offset, -1, `Missing text ${JSON.stringify(text)}`)
  return document.positionAt(offset + within)
}

function markdownText(hovers: readonly vscode.Hover[] | undefined): string {
  return (hovers ?? [])
    .flatMap((hover) => hover.contents)
    .map((content) =>
      typeof content === 'string'
        ? content
        : content instanceof vscode.MarkdownString
          ? content.value
          : content.value,
    )
    .join('\n')
}

function definitionUri(
  location: vscode.Location | vscode.LocationLink,
): vscode.Uri {
  return 'uri' in location ? location.uri : location.targetUri
}

async function waitFor<Result>(
  probe: () => Result | Promise<Result>,
  description: string,
): Promise<NonNullable<Awaited<Result>>> {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result as NonNullable<Awaited<Result>>
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

const unformattedSource = `export const value={answer:42}\n\n# Format\n\n{value.answer}\n`
