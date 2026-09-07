import {spawn} from 'node:child_process'
import path from 'node:path'
import {
  activateAutoInsertion,
  activateFindFileReferences,
  activateReloadProjects,
  activateTsVersionStatusItem,
  createLabsInfo,
  getTsdk,
  middleware,
} from '@volar/vscode'
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from '@volar/vscode/node'
import {GetMatchTsConfigRequest} from '@volar/vscode/protocol'
import * as vscode from 'vscode'

const restartCommand = 'markscript.restartLanguageServer'
const findFileReferencesCommand = 'markscript.findFileReferences'
const reloadProjectsCommand = 'markscript.reloadProjects'
const openTsConfigCommand = 'markscript.openTsConfig'
const selectTypeScriptVersionCommand = 'markscript.selectTypeScriptVersion'
const checkFileCommand = 'markscript.checkFile'
const checkWorkspaceCommand = 'markscript.checkWorkspace'
const runFileCommand = 'markscript.runFile'
const showOutputCommand = 'markscript.showLanguageServerOutput'
const configurationSection = 'markscript.server'
const documentSelector = [
  {language: 'markscript', scheme: 'file'},
  {language: 'markscript', scheme: 'untitled'},
  {language: 'typescript', scheme: 'file'},
  {language: 'typescript', scheme: 'untitled'},
  {language: 'typescriptreact', scheme: 'file'},
  {language: 'typescriptreact', scheme: 'untitled'},
  {language: 'javascript', scheme: 'file'},
  {language: 'javascript', scheme: 'untitled'},
  {language: 'javascriptreact', scheme: 'file'},
  {language: 'javascriptreact', scheme: 'untitled'},
] satisfies vscode.DocumentSelector

let client: LanguageClient | undefined
let transition: Promise<void> = Promise.resolve()
let commandOutput: vscode.OutputChannel | undefined
let selectedTypeScript: Awaited<ReturnType<typeof getTsdk>>
let clientFeatureDisposables: vscode.Disposable[] = []
const volarLabs = createLabsInfo()

type ExtensionExports = typeof volarLabs.extensionExports

export async function activate(
  context: vscode.ExtensionContext,
): Promise<ExtensionExports> {
  context.subscriptions.push(
    vscode.commands.registerCommand(restartCommand, () => restart(context)),
    vscode.commands.registerCommand(checkFileCommand, () =>
      checkActiveFile(context),
    ),
    vscode.commands.registerCommand(checkWorkspaceCommand, () =>
      checkWorkspace(context),
    ),
    vscode.commands.registerCommand(runFileCommand, () =>
      runActiveFile(context),
    ),
    vscode.commands.registerCommand(showOutputCommand, () =>
      client?.outputChannel.show(true),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(configurationSection)) {
        void restart(context)
      }
    }),
    activateTsVersionStatusItem(
      documentSelector,
      selectTypeScriptVersionCommand,
      context,
      (version) => `TypeScript ${version}`,
      () => void restart(context),
    ),
  )
  commandOutput = vscode.window.createOutputChannel('MarkScript Commands')
  context.subscriptions.push(commandOutput)

  await enqueue(() => start(context))
  return volarLabs.extensionExports
}

export async function deactivate(): Promise<void> {
  await enqueue(stop)
}

function restart(context: vscode.ExtensionContext): Promise<void> {
  return enqueue(async () => {
    await stop()
    await start(context)
  })
}

function enqueue(operation: () => Promise<void>): Promise<void> {
  transition = transition.then(operation, operation)
  return transition
}

async function start(context: vscode.ExtensionContext): Promise<void> {
  if (client) return

  selectedTypeScript = await getTsdk(context)
  const serverOptions = createServerOptions(context)
  const clientOptions: LanguageClientOptions = {
    documentSelector,
    initializationOptions: () => ({typescript: selectedTypeScript}),
    middleware,
    outputChannelName: 'MarkScript Language Server',
  }

  const nextClient = new LanguageClient(
    'markscript',
    'MarkScript Language Server',
    serverOptions,
    clientOptions,
  )
  client = nextClient

  try {
    await nextClient.start()
    volarLabs.addLanguageClient(nextClient)
    clientFeatureDisposables = [
      activateAutoInsertion(documentSelector, nextClient),
      activateFindFileReferences(findFileReferencesCommand, nextClient),
      activateReloadProjects(reloadProjectsCommand, nextClient),
      activateProjectStatus(nextClient),
    ]
    context.subscriptions.push(...clientFeatureDisposables)
  } catch (error) {
    if (client === nextClient) client = undefined
    await nextClient.dispose()
    const detail = error instanceof Error ? error.message : String(error)
    void vscode.window.showErrorMessage(
      `MarkScript language server failed to start: ${detail}`,
    )
  }
}

async function stop(): Promise<void> {
  const activeClient = client
  client = undefined
  for (const disposable of clientFeatureDisposables) disposable.dispose()
  clientFeatureDisposables = []
  if (activeClient) {
    const labsClients = volarLabs.extensionExports.volarLabs.languageClients
    const labsIndex = labsClients.indexOf(activeClient)
    if (labsIndex !== -1) labsClients.splice(labsIndex, 1)
    await activeClient.stop()
  }
}

function createServerOptions(context: vscode.ExtensionContext): ServerOptions {
  const configuration = vscode.workspace.getConfiguration(configurationSection)
  const runtime = configuration.get<string>('runtime', 'bun').trim() || 'bun'
  const configuredPath = configuration.get<string>('path', '').trim()
  const serverPath = resolveServerPath(context, configuredPath)
  const options = configuredPath
    ? undefined
    : {cwd: context.asAbsolutePath('dist')}
  return {
    command: runtime,
    args: [serverPath],
    transport: TransportKind.stdio,
    ...(options ? {options} : {}),
  }
}

function activateProjectStatus(
  languageClient: LanguageClient,
): vscode.Disposable {
  const status = vscode.languages.createLanguageStatusItem(
    openTsConfigCommand,
    documentSelector,
  )
  status.name = 'MarkScript project configuration'

  let configUri: vscode.Uri | undefined
  let disposed = false
  let requestVersion = 0

  const update = async () => {
    const version = ++requestVersion
    const document = vscode.window.activeTextEditor?.document
    if (!document || vscode.languages.match(documentSelector, document) === 0) {
      configUri = undefined
      status.text = ''
      status.command = undefined
      return
    }

    try {
      const result = await languageClient.sendRequest(
        GetMatchTsConfigRequest.type,
        languageClient.code2ProtocolConverter.asTextDocumentIdentifier(
          document,
        ),
      )
      if (disposed || version !== requestVersion) return

      configUri = result?.uri ? vscode.Uri.parse(result.uri) : undefined
      status.text = configUri ? projectRelativePath(configUri) : 'No tsconfig'
      status.command = configUri
        ? {title: 'Open config file', command: openTsConfigCommand}
        : undefined
    } catch {
      if (disposed || version !== requestVersion) return
      configUri = undefined
      status.text = ''
      status.command = undefined
    }
  }

  const disposables = [
    status,
    vscode.commands.registerCommand(openTsConfigCommand, async () => {
      if (!configUri) return
      const document = await vscode.workspace.openTextDocument(configUri)
      await vscode.window.showTextDocument(document)
    }),
    vscode.window.onDidChangeActiveTextEditor(() => void update()),
    new vscode.Disposable(() => {
      disposed = true
      requestVersion += 1
    }),
  ]
  void update()
  return vscode.Disposable.from(...disposables)
}

function projectRelativePath(uri: vscode.Uri): string {
  const workspace = vscode.workspace.getWorkspaceFolder(uri)
  const root =
    workspace?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  return root
    ? path.relative(root, uri.fsPath) || path.basename(uri.fsPath)
    : uri.fsPath
}

async function checkActiveFile(
  context: vscode.ExtensionContext,
): Promise<void> {
  const document = activeMarkscriptDocument()
  if (!document || !(await document.save())) return
  const result = await runCli(context, document.uri, [
    'check',
    document.uri.fsPath,
  ])
  if (result === 0) {
    void vscode.window.showInformationMessage('MarkScript check passed.')
  } else if (result !== undefined) {
    void vscode.window.showErrorMessage(
      'MarkScript check failed. See MarkScript Commands output.',
    )
  }
}

async function checkWorkspace(context: vscode.ExtensionContext): Promise<void> {
  const files = await vscode.workspace.findFiles(
    '**/*.ms',
    '**/{node_modules,.git}/**',
  )
  if (files.length === 0) {
    void vscode.window.showInformationMessage(
      'No MarkScript files were found in this workspace.',
    )
    return
  }
  commandOutput?.show(true)
  let failures = 0
  for (const file of files.sort((left, right) =>
    left.fsPath.localeCompare(right.fsPath),
  )) {
    const result = await runCli(context, file, ['check', file.fsPath])
    if (result !== 0) failures += 1
  }
  const summary = `Checked ${files.length} MarkScript file${files.length === 1 ? '' : 's'}; ${failures} failed.`
  commandOutput?.appendLine(summary)
  if (failures === 0) void vscode.window.showInformationMessage(summary)
  else void vscode.window.showErrorMessage(summary)
}

async function runActiveFile(context: vscode.ExtensionContext): Promise<void> {
  const document = activeMarkscriptDocument()
  if (!document || !(await document.save())) return
  commandOutput?.show(true)
  const result = await runCli(context, document.uri, [
    'run',
    document.uri.fsPath,
  ])
  if (result !== 0 && result !== undefined) {
    void vscode.window.showErrorMessage(
      'MarkScript run failed. See MarkScript Commands output.',
    )
  }
}

function activeMarkscriptDocument(): vscode.TextDocument | undefined {
  const document = vscode.window.activeTextEditor?.document
  if (document?.languageId === 'markscript' && document.uri.scheme === 'file') {
    return document
  }
  void vscode.window.showWarningMessage(
    'Open a saved MarkScript .ms file before running this command.',
  )
  return undefined
}

function runCli(
  context: vscode.ExtensionContext,
  resource: vscode.Uri,
  args: string[],
): Promise<number | undefined> {
  const configuration = vscode.workspace.getConfiguration(configurationSection)
  const runtime = configuration.get<string>('runtime', 'bun').trim() || 'bun'
  const cliPath = context.asAbsolutePath('dist/cli.js')
  const workspace = vscode.workspace.getWorkspaceFolder(resource)
  commandOutput?.appendLine(`> markscript ${args.join(' ')}`)
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: number | undefined) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const child = spawn(runtime, [cliPath, ...args], {
      cwd: workspace?.uri.fsPath ?? path.dirname(resource.fsPath),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk: Buffer) =>
      commandOutput?.append(chunk.toString()),
    )
    child.stderr.on('data', (chunk: Buffer) =>
      commandOutput?.append(chunk.toString()),
    )
    child.on('error', (error) => {
      commandOutput?.appendLine(`MarkScript startup failed: ${error.message}`)
      finish(undefined)
    })
    child.on('close', (code) => {
      commandOutput?.appendLine(
        `MarkScript exited with code ${code ?? 'unknown'}.`,
      )
      finish(code ?? undefined)
    })
  })
}

function resolveServerPath(
  context: vscode.ExtensionContext,
  configuredPath: string,
): string {
  if (!configuredPath) return context.asAbsolutePath('dist/server.js')

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const expandedPath = workspacePath
    ? // biome-ignore lint/suspicious/noTemplateCurlyInString: this is the documented literal VS Code configuration token.
      configuredPath.replaceAll('${workspaceFolder}', workspacePath)
    : configuredPath

  if (path.isAbsolute(expandedPath)) return expandedPath
  return path.resolve(workspacePath ?? context.extensionPath, expandedPath)
}
