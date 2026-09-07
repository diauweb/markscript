import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {type CompilerOptions, check} from '@markscript/compiler'
import type {LanguageServicePlugin} from '@volar/language-service'
import {URI} from 'vscode-uri'
import {groupCompilerDiagnostics} from './protocol.ts'

interface OpenDocument {
  uri: string
  getText(): string
}

export interface MarkscriptDiagnosticServiceOptions {
  openDocuments(): readonly OpenDocument[]
  onError?(error: unknown, uri: string): void
}

export function createMarkscriptDiagnosticService(
  options: MarkscriptDiagnosticServiceOptions,
): LanguageServicePlugin {
  return {
    name: 'markscript-compiler-diagnostics',
    capabilities: {
      diagnosticProvider: {
        interFileDependencies: true,
        workspaceDiagnostics: false,
      },
    },
    create(context) {
      return {
        async provideDiagnostics(document, token) {
          if (document.languageId !== 'markscript') return undefined

          const embeddedUri = URI.parse(document.uri)
          const decoded = context.decodeEmbeddedDocumentUri(embeddedUri)
          if (decoded?.[1] !== 'markscript') return undefined

          const sourceUri = decoded[0].toString()
          const enabled =
            (await context.env.getConfiguration?.<boolean>(
              'markscript.validation.enabled',
              sourceUri,
            )) ?? true
          if (!enabled || token.isCancellationRequested) return []

          const filename = documentFilename(sourceUri)
          const compilerOptions: CompilerOptions = {
            filename,
            sourceOverrides: new Map(
              options
                .openDocuments()
                .filter((openDocument) => openDocument.uri !== sourceUri)
                .map(
                  (openDocument) =>
                    [
                      documentFilename(openDocument.uri),
                      openDocument.getText(),
                    ] as const,
                ),
            ),
          }

          try {
            const diagnostics = await check(document.getText(), compilerOptions)
            if (token.isCancellationRequested) return undefined
            return (
              groupCompilerDiagnostics(sourceUri, filename, diagnostics).get(
                sourceUri,
              ) ?? []
            )
          } catch (error) {
            if (!token.isCancellationRequested) {
              options.onError?.(error, sourceUri)
            }
            return []
          }
        },
      }
    },
  }
}

function documentFilename(uri: string): string {
  return fileUriPath(uri) ?? resolve(`untitled-${stableHash(uri)}.ms`)
}

function fileUriPath(uri: string): string | undefined {
  try {
    return uri.startsWith('file:') ? fileURLToPath(uri) : undefined
  } catch {
    return undefined
  }
}

function stableHash(value: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(16)
}
