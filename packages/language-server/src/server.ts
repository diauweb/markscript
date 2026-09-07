#!/usr/bin/env bun

import {createMarkscriptLanguagePlugin} from '@markscript/language-core'
import {
  createConnection,
  createServer,
  createTypeScriptProject,
  type Disposable,
  loadTsdkByPath,
  PositionEncodingKind,
} from '@volar/language-server/node'
import type {LanguageServicePlugin} from '@volar/language-service'
import bundledTypeScript, {type MapLike} from 'typescript'
import {create as createMarkdownService} from 'volar-service-markdown'
import {create as createTypeScriptService} from 'volar-service-typescript'
import {URI} from 'vscode-uri'
import {createMarkscriptDiagnosticService} from './diagnostic-service.ts'
import {createMarkscriptService} from './markscript-service.ts'

interface MarkscriptInitializationOptions {
  typescript?: {
    tsdk: string
    version: string
    isWorkspacePath: boolean
  }
}

const connection = createConnection()
const server = createServer(connection)
let project: ReturnType<typeof createTypeScriptProject> | undefined
let watchedFiles: Disposable | undefined

connection.onInitialize((params) => {
  const options = params.initializationOptions as
    | MarkscriptInitializationOptions
    | undefined
  const selected = loadTypeScript(options?.typescript?.tsdk, params.locale)
  const typescript = selected.typescript
  project = createTypeScriptProject(
    typescript,
    selected.diagnosticMessages,
    (context) => ({
      languagePlugins: [
        createMarkscriptLanguagePlugin(typescript, {
          fileName: (uri) => context.uriConverter.asFileName(uri),
          server: {imageAssetTypes: true},
        }),
      ],
    }),
  )
  const languageServicePlugins = [
    ...withoutCompilerOwnedFeatures(
      createTypeScriptService(typescript, {
        isFormattingEnabled: () => false,
      }),
    ),
    createMarkscriptDiagnosticService({
      openDocuments: () => server.documents.all(),
      onError(error, uri) {
        connection.console.error(
          `MarkScript validation failed for ${uri}: ${errorMessage(error)}`,
        )
      },
    }),
    createMarkdownService({
      documentSelector: ['markdown'],
      fileExtensions: ['ms'],
    }),
    createMarkscriptService(),
  ]
  const result = server.initialize(params, project, languageServicePlugins)
  result.capabilities.positionEncoding = PositionEncodingKind.UTF16
  result.capabilities.documentRangeFormattingProvider = false
  result.serverInfo = {name: 'MarkScript Language Server', version: '0.1.0'}
  return result
})

connection.onInitialized(async () => {
  try {
    watchedFiles = await server.fileWatcher.watchFiles([
      '**/*.ms',
      '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
      '**/*.{bmp,gif,jpeg,jpg,png,svg}',
      '**/tsconfig*.json',
      '**/jsconfig*.json',
      '**/package.json',
    ])
  } finally {
    server.initialized()
  }
  server.workspaceFolders.onDidChange(() => {
    void server.languageFeatures.requestRefresh(true)
  })
  server.fileWatcher.onDidChangeWatchedFiles(({changes}) => {
    if (changes.some((change) => isProjectConfigurationUri(change.uri))) {
      project?.reload()
      void server.languageFeatures.requestRefresh(true)
    }
  })
})

connection.onShutdown(() => {
  watchedFiles?.dispose()
  server.shutdown()
})

function isProjectConfigurationUri(uri: string): boolean {
  const filename = uri.slice(uri.lastIndexOf('/') + 1)
  return (
    filename === 'package.json' ||
    /^(?:ts|js)config(?:\.[^/]*)?\.json$/u.test(filename)
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function loadTypeScript(
  tsdk: string | undefined,
  locale: string | undefined,
): {
  typescript: typeof bundledTypeScript
  diagnosticMessages: MapLike<string> | undefined
} {
  if (!tsdk) {
    return {typescript: bundledTypeScript, diagnosticMessages: undefined}
  }
  try {
    return loadTsdkByPath(tsdk, locale)
  } catch (error) {
    connection.console.warn(
      `Unable to load the TypeScript SDK at ${JSON.stringify(tsdk)}; using bundled TypeScript ${bundledTypeScript.version}: ${errorMessage(error)}`,
    )
    return {typescript: bundledTypeScript, diagnosticMessages: undefined}
  }
}
connection.listen()

function withoutCompilerOwnedFeatures(
  plugins: LanguageServicePlugin[],
): LanguageServicePlugin[] {
  return plugins.map((plugin) => {
    if (
      !plugin.capabilities.diagnosticProvider &&
      !plugin.capabilities.semanticTokensProvider
    ) {
      return plugin
    }
    const capabilities = {...plugin.capabilities}
    delete capabilities.semanticTokensProvider
    return {
      ...plugin,
      capabilities,
      create(context) {
        const instance = plugin.create(context)
        const provideDiagnostics = instance.provideDiagnostics
        if (provideDiagnostics) {
          instance.provideDiagnostics = (document, ...args) => {
            const uri = URI.parse(document.uri)
            const sourceUri = context.decodeEmbeddedDocumentUri(uri)?.[0] ?? uri
            if (
              context.language.scripts.get(sourceUri)?.languageId ===
              'markscript'
            ) {
              return undefined
            }
            return provideDiagnostics.call(instance, document, ...args)
          }
        }
        delete instance.provideDocumentSemanticTokens
        return instance
      },
    }
  })
}
