import {SourceMapConsumer, SourceMapGenerator} from 'source-map'
import type ts from 'typescript'
import {typescriptDiagnostic} from './diagnostics.ts'
import type {Diagnostic, GeneratedSourceSpan} from './types.ts'

export function mapTypeScriptDiagnostic(
  diagnostic: ts.Diagnostic,
  tsApi: typeof ts,
  virtualFilename: string,
  originalFilename: string,
  _virtualCode: string,
  originalSource: string,
  spans: readonly GeneratedSourceSpan[],
): Diagnostic {
  const filename = diagnostic.file?.fileName ?? originalFilename
  const result = typescriptDiagnostic(
    diagnostic,
    tsApi,
    filename === virtualFilename ? originalFilename : filename,
  )

  if (
    filename !== virtualFilename ||
    diagnostic.start === undefined ||
    !diagnostic.file
  ) {
    return result
  }

  const sourceStart = mapGeneratedOffset(spans, diagnostic.start)
  const sourceEnd = mapGeneratedOffset(
    spans,
    diagnostic.start + (diagnostic.length ?? 0),
  )
  if (sourceStart === undefined) return result

  const start = offsetToPoint(originalSource, sourceStart)
  const end = offsetToPoint(originalSource, sourceEnd ?? sourceStart)
  result.line = start.line
  result.column = start.column
  result.endLine = end.line
  result.endColumn = end.column
  return result
}

export async function composeSourceMap(
  emittedMap: string,
  virtualCode: string,
  originalSource: string,
  originalFilename: string,
  spans: readonly GeneratedSourceSpan[],
): Promise<string> {
  const generator = new SourceMapGenerator({
    file: `${originalFilename.split(/[\\/]/u).at(-1) ?? 'document.ms'}.mjs`,
  })

  await SourceMapConsumer.with(emittedMap, null, (consumer) => {
    consumer.eachMapping((mapping) => {
      if (mapping.originalLine === null || mapping.originalColumn === null)
        return
      const virtualOffset = pointToOffset(
        virtualCode,
        mapping.originalLine,
        mapping.originalColumn + 1,
      )
      const sourceOffset = mapGeneratedOffset(spans, virtualOffset)
      if (sourceOffset === undefined) return
      const original = offsetToPoint(originalSource, sourceOffset)
      generator.addMapping({
        generated: {
          line: mapping.generatedLine,
          column: mapping.generatedColumn,
        },
        original: {line: original.line, column: original.column - 1},
        source: originalFilename,
        ...(mapping.name ? {name: mapping.name} : {}),
      })
    })
  })

  generator.setSourceContent(originalFilename, originalSource)
  return generator.toString()
}

export function mapGeneratedOffset(
  spans: readonly GeneratedSourceSpan[],
  generatedOffset: number,
): number | undefined {
  let low = 0
  let high = spans.length - 1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const span = spans[middle]
    if (!span) return undefined
    if (generatedOffset < span.generatedStart) {
      high = middle - 1
    } else if (generatedOffset > span.generatedEnd) {
      low = middle + 1
    } else {
      const relative = Math.min(
        generatedOffset - span.generatedStart,
        span.sourceEnd - span.sourceStart,
      )
      return span.sourceStart + relative
    }
  }

  return undefined
}

function offsetToPoint(source: string, offset: number) {
  let line = 1
  let lineStart = 0
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) {
      line += 1
      lineStart = index + 1
    }
  }
  return {line, column: offset - lineStart + 1}
}

function pointToOffset(source: string, line: number, column: number): number {
  let currentLine = 1
  let offset = 0
  while (currentLine < line && offset < source.length) {
    if (source.charCodeAt(offset) === 10) currentLine += 1
    offset += 1
  }
  return Math.min(source.length, offset + Math.max(0, column - 1))
}
