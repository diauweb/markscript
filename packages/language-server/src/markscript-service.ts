import {fileURLToPath} from 'node:url'
import {
  formatMarkscript,
  type MarkscriptNode,
  parseMarkscript,
} from '@markscript/compiler'
import type {MarkscriptVirtualCode} from '@markscript/language-core'
import type {Mapper, VirtualCode} from '@volar/language-core'
import type {
  CodeAction,
  CodeActionContext,
  LocationLink,
  Range,
  TextEdit,
} from '@volar/language-server/node'
import {
  CompletionItemKind,
  CompletionItemTag,
  MarkupKind,
} from '@volar/language-server/node'
import type {
  LanguageServiceContext,
  LanguageServicePlugin,
  SemanticToken,
} from '@volar/language-service'
import ts from 'typescript'
import type {Provide as TypeScriptProvide} from 'volar-service-typescript'
import type {TextDocument} from 'vscode-languageserver-textdocument'
import {URI} from 'vscode-uri'
import {MarkscriptSyntaxService} from './markscript-syntax.ts'
import {openingMdxTagEndOffset} from './mdx-source.ts'
import {
  buildVolarSemanticTokens,
  collectMarkscriptSyntaxTokens,
  type SemanticTokenType,
  type SourceHighlightToken,
  semanticTokenModifiers,
  semanticTokenTypes,
} from './semantic-tokens.ts'

export function createMarkscriptService(): LanguageServicePlugin {
  return {
    name: 'markscript',
    capabilities: {
      completionProvider: {
        triggerCharacters: ['"', "'", '/', '<', '#', ' '],
      },
      signatureHelpProvider: {
        triggerCharacters: ['<', ' ', '='],
      },
      hoverProvider: true,
      definitionProvider: true,
      documentFormattingProvider: true,
      semanticTokensProvider: {
        legend: {
          tokenTypes: [...semanticTokenTypes],
          tokenModifiers: [...semanticTokenModifiers],
        },
      },
      codeActionProvider: {
        codeActionKinds: ['source.organizeImports'],
      },
    },
    create(context) {
      return {
        isAdditionalCompletion: true,
        provideCompletionItems(document, position) {
          const syntaxCompletion = syntax(context, document)?.completion(
            position,
          )
          const componentRequest = sourceRequest(
            context,
            document,
            position,
            'completion',
          )
          const componentCompletion = componentRequest
            ? componentPropertyCompletion(
                context,
                componentRequest.document,
                componentRequest.position,
              )
            : undefined
          if (!componentCompletion) return syntaxCompletion
          if (!syntaxCompletion) return componentCompletion
          return {
            isIncomplete:
              syntaxCompletion.isIncomplete || componentCompletion.isIncomplete,
            items: [...syntaxCompletion.items, ...componentCompletion.items],
          }
        },
        provideHover(document, position) {
          return syntax(context, document)?.hover(position)
        },
        provideSignatureHelp(document, position) {
          return componentSignatureHelp(context, document, position)
        },
        provideDefinition(document, position) {
          return componentDefinition(context, document, position)
        },
        async provideDocumentFormattingEdits(document, _range, options) {
          if (document.languageId !== 'markscript') return undefined
          const source = document.getText()
          const formatted = await formatMarkscript(source, {
            filename: sourceFilename(context, document.uri),
            insertSpaces: options.insertSpaces,
            tabSize: options.tabSize,
          })
          return formatted === source
            ? []
            : [
                {
                  range: {
                    start: {line: 0, character: 0},
                    end: document.positionAt(source.length),
                  },
                  newText: formatted,
                },
              ]
        },
        provideDocumentSemanticTokens(document, range, legend) {
          if (document.languageId !== 'markscript') return undefined
          const source = document.getText()
          const start = document.offsetAt(range.start)
          const end = document.offsetAt(range.end)
          const candidates = collectMarkscriptSyntaxTokens(
            source,
            sourceFilename(context, document.uri),
          )
          collectTypeScriptTokens(context, document, candidates)
          return buildVolarSemanticTokens(
            source,
            candidates.filter(
              (token) => token.end > start && token.start < end,
            ),
            legend,
          ) as SemanticToken[]
        },
        provideCodeActions(document, _range, actionContext) {
          return organizeImports(context, document, actionContext)
        },
      }
    },
  }
}

function collectTypeScriptTokens(
  context: LanguageServiceContext,
  document: TextDocument,
  tokens: SourceHighlightToken[],
): void {
  const documentUri = URI.parse(document.uri)
  const sourceUri = sourceDocumentUri(context, documentUri)
  const script = context.language.scripts.get(sourceUri)
  const root = script?.generated?.root as MarkscriptVirtualCode | undefined
  const code = root?.embeddedCodes.find(
    (embedded) => embedded.id === 'typescript',
  )
  const languageService = context.inject<
    TypeScriptProvide,
    'typescript/languageService'
  >('typescript/languageService')
  const fileName = context.inject<
    TypeScriptProvide,
    'typescript/documentFileName'
  >('typescript/documentFileName', sourceUri)
  if (!script || !code || !languageService || !fileName) return

  const generated = code.snapshot.getText(0, code.snapshot.getLength())
  const span = {start: 0, length: generated.length}
  const map = context.language.maps.get(code, script)
  collectClassifications(
    tokens,
    map,
    generated,
    languageService.getEncodedSyntacticClassifications(fileName, span).spans,
    syntacticTokenType,
    260,
  )
  collectClassifications(
    tokens,
    map,
    generated,
    languageService.getEncodedSemanticClassifications(
      fileName,
      span,
      ts.SemanticClassificationFormat.TwentyTwenty,
    ).spans,
    semanticTokenType,
    300,
  )
}

function collectClassifications(
  tokens: SourceHighlightToken[],
  map: ReturnType<LanguageServiceContext['language']['maps']['get']>,
  generated: string,
  classifications: readonly number[],
  classify: (
    classification: number,
    text: string,
  ) => {type: SemanticTokenType; modifiers?: number} | undefined,
  priority: number,
): void {
  for (let index = 0; index < classifications.length; index += 3) {
    const generatedStart = classifications[index]
    const length = classifications[index + 1]
    const classification = classifications[index + 2]
    if (
      generatedStart === undefined ||
      length === undefined ||
      classification === undefined ||
      length <= 0
    ) {
      continue
    }
    const sourceRange = [
      ...map.toSourceRange(
        generatedStart,
        generatedStart + length,
        false,
        (information) => Boolean(information.semantic),
      ),
    ][0]
    const token = classify(
      classification,
      generated.slice(generatedStart, generatedStart + length),
    )
    if (!sourceRange || !token || sourceRange[1] <= sourceRange[0]) continue
    tokens.push({
      start: sourceRange[0],
      end: sourceRange[1],
      ...token,
      priority,
    })
  }
}

function semanticTokenType(
  classification: number,
  _text: string,
): {type: SemanticTokenType; modifiers: number} | undefined {
  const type = semanticTokenTypes[(classification >> 8) - 1]
  return type ? {type, modifiers: classification & 0xff} : undefined
}

function syntacticTokenType(
  classification: number,
  text: string,
): {type: SemanticTokenType} | undefined {
  switch (classification) {
    case ts.ClassificationType.comment:
      return {type: 'comment'}
    case ts.ClassificationType.identifier:
      return {type: 'variable'}
    case ts.ClassificationType.keyword:
    case ts.ClassificationType.docCommentTagName:
      return {type: 'keyword'}
    case ts.ClassificationType.numericLiteral:
    case ts.ClassificationType.bigintLiteral:
      return {type: 'number'}
    case ts.ClassificationType.operator:
      return {type: 'operator'}
    case ts.ClassificationType.stringLiteral:
      return /^\/(?![/*])/u.test(text) ? {type: 'regexp'} : {type: 'string'}
    case ts.ClassificationType.jsxAttributeStringLiteralValue:
      return {type: 'string'}
    case ts.ClassificationType.regularExpressionLiteral:
      return {type: 'regexp'}
    case ts.ClassificationType.punctuation:
      return {type: 'typescriptPunctuation'}
    case ts.ClassificationType.className:
      return {type: 'class'}
    case ts.ClassificationType.enumName:
      return {type: 'enum'}
    case ts.ClassificationType.interfaceName:
      return {type: 'interface'}
    case ts.ClassificationType.moduleName:
      return {type: 'namespace'}
    case ts.ClassificationType.typeParameterName:
      return {type: 'typeParameter'}
    case ts.ClassificationType.typeAliasName:
      return {type: 'type'}
    case ts.ClassificationType.parameterName:
      return {type: 'parameter'}
    case ts.ClassificationType.jsxOpenTagName:
    case ts.ClassificationType.jsxCloseTagName:
    case ts.ClassificationType.jsxSelfClosingTagName:
      return {type: 'mdxTag'}
    case ts.ClassificationType.jsxAttribute:
      return {type: 'mdxAttribute'}
    default:
      return undefined
  }
}

function syntax(context: LanguageServiceContext, document: TextDocument) {
  return document.languageId === 'markscript'
    ? new MarkscriptSyntaxService(
        document,
        sourceFilename(context, document.uri),
      )
    : undefined
}

function sourceRequest(
  context: LanguageServiceContext,
  document: TextDocument,
  position: {line: number; character: number},
  feature: 'completion' | 'navigation',
):
  | {
      document: TextDocument
      position: {line: number; character: number}
    }
  | undefined {
  const uri = URI.parse(document.uri)
  const decoded = context.decodeEmbeddedDocumentUri(uri)
  if (!decoded) return {document, position}

  const script = context.language.scripts.get(decoded[0])
  const code = script?.generated?.embeddedCodes.get(decoded[1])
  if (!script || !code) return undefined
  const sourceOffset = [
    ...context.language.maps
      .get(code, script)
      .toSourceLocation(document.offsetAt(position), (information) =>
        Boolean(information[feature]),
      ),
  ][0]?.[0]
  if (sourceOffset === undefined) return undefined
  const sourceDocument = context.documents.get(
    script.id,
    script.languageId,
    script.snapshot,
  )
  return {
    document: sourceDocument,
    position: sourceDocument.positionAt(sourceOffset),
  }
}

function organizeImports(
  context: LanguageServiceContext,
  document: TextDocument,
  actionContext: CodeActionContext,
): CodeAction[] | undefined {
  if (
    document.languageId !== 'markscript' ||
    !actionContext.only?.some((kind) =>
      'source.organizeImports'.startsWith(kind),
    )
  ) {
    return undefined
  }

  const documentUri = URI.parse(document.uri)
  const sourceUri = sourceDocumentUri(context, documentUri)
  const script = context.language.scripts.get(sourceUri)
  const root = script?.generated?.root as MarkscriptVirtualCode | undefined
  const code = root?.embeddedCodes.find(
    (embedded) => embedded.id === 'typescript',
  )
  if (!script || !code) return undefined

  const languageService = context.inject<
    TypeScriptProvide,
    'typescript/languageService'
  >('typescript/languageService')
  const fileName = context.inject<
    TypeScriptProvide,
    'typescript/documentFileName'
  >('typescript/documentFileName', sourceUri)
  if (!languageService || !fileName) return undefined

  const map = context.language.maps.get(code, script)
  const edits: TextEdit[] = []
  for (const fileChange of languageService.organizeImports(
    {type: 'file', fileName},
    {},
    {},
  )) {
    if (fileChange.fileName !== fileName) return undefined
    for (const change of fileChange.textChanges) {
      const sourceRange = [
        ...map.toSourceRange(
          change.span.start,
          change.span.start + change.span.length,
          true,
          (information) => Boolean(information.verification),
        ),
      ][0]
      if (!sourceRange) continue
      edits.push({
        range: offsetsToRange(document, sourceRange[0], sourceRange[1]),
        newText: change.newText,
      })
    }
  }

  return [
    {
      title: 'Organize Imports',
      kind: 'source.organizeImports',
      edit: {changes: {[sourceUri.toString()]: edits}},
    },
  ]
}

function componentSignatureHelp(
  context: LanguageServiceContext,
  document: TextDocument,
  position: {line: number; character: number},
) {
  if (document.languageId !== 'markscript') return undefined
  const source = document.getText()
  const component = componentAtOffset(
    source,
    sourceFilename(context, document.uri),
    document.offsetAt(position),
  )
  if (!component) return undefined

  const documentUri = URI.parse(document.uri)
  const sourceUri = sourceDocumentUri(context, documentUri)
  const script = context.language.scripts.get(sourceUri)
  const root = script?.generated?.root as MarkscriptVirtualCode | undefined
  const code = root?.embeddedCodes.find(
    (embedded) => embedded.id === 'typescript',
  )
  if (!script || !code) return undefined
  const map = context.language.maps.get(code, script)
  const generatedOffset = componentGeneratedOffset(
    map,
    code,
    component,
    'completion',
  )
  if (generatedOffset === undefined) return undefined

  const languageService = context.inject<
    TypeScriptProvide,
    'typescript/languageService'
  >('typescript/languageService')
  const fileName = context.inject<
    TypeScriptProvide,
    'typescript/documentFileName'
  >('typescript/documentFileName', sourceUri)
  const program = languageService?.getProgram()
  const sourceFile = fileName ? program?.getSourceFile(fileName) : undefined
  if (!program || !sourceFile) return undefined
  const node = nodeAtOffset(sourceFile, generatedOffset)
  const checker = program.getTypeChecker()
  const signatures = checker.getTypeAtLocation(node).getCallSignatures()
  if (signatures.length === 0) return undefined

  return {
    signatures: signatures.map((signature) => {
      const documentation = ts.displayPartsToString(
        signature.getDocumentationComment(checker),
      )
      return {
        label: `${component.name}${checker.signatureToString(signature)}`,
        parameters: signature.parameters.map((parameter) => {
          const declaration =
            parameter.valueDeclaration ?? parameter.declarations?.[0] ?? node
          return {
            label: `${parameter.getName()}: ${checker.typeToString(
              checker.getTypeOfSymbolAtLocation(parameter, declaration),
            )}`,
            documentation: ts.displayPartsToString(
              parameter.getDocumentationComment(checker),
            ),
          }
        }),
        activeParameter: 0,
        ...(documentation ? {documentation} : {}),
      }
    }),
    activeSignature: 0,
    activeParameter: 0,
  }
}

function componentPropertyCompletion(
  context: LanguageServiceContext,
  document: TextDocument,
  position: {line: number; character: number},
) {
  const target = componentTypeTarget(context, document, position)
  if (!target) return undefined
  const {checker, node} = target
  const properties = new Map<string, ts.Symbol>()
  for (const signature of checker.getTypeAtLocation(node).getCallSignatures()) {
    const parameter = signature.parameters[0]
    if (!parameter) continue
    for (const property of checker
      .getTypeOfSymbolAtLocation(parameter, node)
      .getProperties()) {
      properties.set(property.getName(), property)
    }
  }
  if (properties.size === 0) return undefined

  return {
    isIncomplete: false,
    items: [...properties.values()].map((property) => {
      const declaration =
        property.valueDeclaration ?? property.declarations?.[0] ?? node
      const detail = checker.typeToString(
        checker.getTypeOfSymbolAtLocation(property, declaration),
      )
      const documentation = ts.displayPartsToString(
        property.getDocumentationComment(checker),
      )
      const deprecated = property
        .getJsDocTags(checker)
        .some((tag) => tag.name === 'deprecated')
      return {
        label: property.getName(),
        kind: CompletionItemKind.Property,
        detail,
        labelDetails: {detail: `: ${detail}`},
        ...(documentation
          ? {
              documentation: {
                kind: MarkupKind.Markdown,
                value: documentation,
              },
            }
          : {}),
        ...(deprecated
          ? {
              tags: [CompletionItemTag.Deprecated] as [
                typeof CompletionItemTag.Deprecated,
              ],
            }
          : {}),
      }
    }),
  }
}

function componentTypeTarget(
  context: LanguageServiceContext,
  document: TextDocument,
  position: {line: number; character: number},
): {checker: ts.TypeChecker; node: ts.Node} | undefined {
  if (document.languageId !== 'markscript') return undefined
  const source = document.getText()
  const component = componentAtOffset(
    source,
    sourceFilename(context, document.uri),
    document.offsetAt(position),
  )
  if (!component) return undefined

  const sourceUri = sourceDocumentUri(context, URI.parse(document.uri))
  const script = context.language.scripts.get(sourceUri)
  const root = script?.generated?.root as MarkscriptVirtualCode | undefined
  const code = root?.embeddedCodes.find(
    (embedded) => embedded.id === 'typescript',
  )
  if (!script || !code) return undefined
  const generatedOffset = componentGeneratedOffset(
    context.language.maps.get(code, script),
    code,
    component,
    'completion',
  )
  if (generatedOffset === undefined) return undefined

  const languageService = context.inject<
    TypeScriptProvide,
    'typescript/languageService'
  >('typescript/languageService')
  const fileName = context.inject<
    TypeScriptProvide,
    'typescript/documentFileName'
  >('typescript/documentFileName', sourceUri)
  const program = languageService?.getProgram()
  const sourceFile = fileName ? program?.getSourceFile(fileName) : undefined
  if (!program || !sourceFile) return undefined
  return {
    checker: program.getTypeChecker(),
    node: nodeAtOffset(sourceFile, generatedOffset),
  }
}

function componentDefinition(
  context: LanguageServiceContext,
  document: TextDocument,
  position: {line: number; character: number},
): LocationLink[] | undefined {
  if (document.languageId !== 'markscript') return undefined
  const source = document.getText()
  const component = componentAtOffset(
    source,
    sourceFilename(context, document.uri),
    document.offsetAt(position),
  )
  if (!component) return undefined

  const sourceUri = sourceDocumentUri(context, URI.parse(document.uri))
  const script = context.language.scripts.get(sourceUri)
  const root = script?.generated?.root as MarkscriptVirtualCode | undefined
  const code = root?.embeddedCodes.find(
    (embedded) => embedded.id === 'typescript',
  )
  if (!script || !code) return undefined
  const map = context.language.maps.get(code, script)
  const generatedOffset = componentGeneratedOffset(
    map,
    code,
    component,
    'navigation',
  )
  if (generatedOffset === undefined) return undefined

  const languageService = context.inject<
    TypeScriptProvide,
    'typescript/languageService'
  >('typescript/languageService')
  const fileName = context.inject<
    TypeScriptProvide,
    'typescript/documentFileName'
  >('typescript/documentFileName', sourceUri)
  const program = languageService?.getProgram()
  const sourceFile = fileName ? program?.getSourceFile(fileName) : undefined
  if (!program || !sourceFile) return undefined
  const checker = program.getTypeChecker()
  const node = nodeAtOffset(sourceFile, generatedOffset)
  let symbol = checker.getSymbolAtLocation(node)
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol)
  }
  if (!symbol) return undefined

  const originSelectionRange = offsetsToRange(
    document,
    component.nameStart,
    component.nameStart + component.name.length,
  )
  return (symbol.declarations ?? []).flatMap((declaration) => {
    const targetNode = (declaration as ts.NamedDeclaration).name ?? declaration
    const target = definitionTarget(context, {
      fileName: targetNode.getSourceFile().fileName,
      textSpan: {
        start: targetNode.getStart(),
        length: targetNode.getWidth(),
      },
    })
    return target ? [{originSelectionRange, ...target}] : []
  })
}

function definitionTarget(
  context: LanguageServiceContext,
  definition: Pick<ts.DefinitionInfo, 'fileName' | 'textSpan'>,
): Omit<LocationLink, 'originSelectionRange'> | undefined {
  const uri = context.inject<TypeScriptProvide, 'typescript/documentUri'>(
    'typescript/documentUri',
    definition.fileName,
  )
  if (!uri) return undefined
  const script = context.language.scripts.get(uri, true)
  if (!script) return undefined

  let start = definition.textSpan.start
  let end = start + definition.textSpan.length
  if (script.generated) {
    const code = script.generated.root.embeddedCodes?.find(
      (embedded) => embedded.id === 'typescript',
    )
    if (!code) return undefined
    const mapped = [
      ...context.language.maps
        .get(code, script)
        .toSourceRange(start, end, true, (information) =>
          Boolean(information.navigation),
        ),
    ][0]
    if (!mapped) return undefined
    start = mapped[0]
    end = mapped[1]
  }

  const targetDocument = context.documents.get(
    uri,
    script.languageId,
    script.snapshot,
  )
  const range = offsetsToRange(targetDocument, start, end)
  return {
    targetUri: uri.toString(),
    targetRange: range,
    targetSelectionRange: range,
  }
}

function componentGeneratedOffset(
  map: Mapper,
  code: VirtualCode,
  component: {name: string; nameStart: number},
  feature: 'completion' | 'navigation',
): number | undefined {
  const generated = code.snapshot.getText(0, code.snapshot.getLength())
  for (const mapping of code.mappings) {
    if (!mapping.data[feature]) continue
    for (let index = 0; index < mapping.sourceOffsets.length; index += 1) {
      const sourceStart = mapping.sourceOffsets[index]
      const generatedStart = mapping.generatedOffsets[index]
      const length = mapping.lengths[index]
      if (
        sourceStart === undefined ||
        generatedStart === undefined ||
        length === undefined ||
        component.nameStart < sourceStart ||
        component.nameStart + component.name.length > sourceStart + length
      ) {
        continue
      }
      const candidate = generatedStart + component.nameStart - sourceStart
      if (
        generated.slice(candidate, candidate + component.name.length) ===
        component.name
      ) {
        return candidate + Math.min(1, component.name.length - 1)
      }
    }
  }

  const mappedOffsets = [
    ...map.toGeneratedLocation(
      component.nameStart + Math.min(1, component.name.length - 1),
      (information) => Boolean(information[feature]),
    ),
  ].map(([offset]) => offset)
  let nearest: {distance: number; offset: number} | undefined
  for (const mapped of mappedOffsets) {
    const searchStart = Math.max(0, mapped - 128)
    const searchEnd = Math.min(generated.length, mapped + 128)
    let identifier = generated.indexOf(component.name, searchStart)
    while (identifier >= 0 && identifier <= searchEnd) {
      const before = generated[identifier - 1]
      const after = generated[identifier + component.name.length]
      if (!isIdentifierCharacter(before) && !isIdentifierCharacter(after)) {
        const distance =
          mapped < identifier
            ? identifier - mapped
            : mapped > identifier + component.name.length
              ? mapped - identifier - component.name.length
              : 0
        if (!nearest || distance < nearest.distance) {
          nearest = {distance, offset: identifier}
        }
      }
      identifier = generated.indexOf(component.name, identifier + 1)
    }
  }
  return nearest
    ? nearest.offset + Math.min(1, component.name.length - 1)
    : undefined
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[$\p{ID_Continue}]/u.test(character)
}

function componentAtOffset(
  source: string,
  filename: string,
  offset: number,
): {name: string; nameStart: number} | undefined {
  const tree = parseMarkscript(source, filename).tree
  if (!tree) return undefined
  let result: {name: string; nameStart: number} | undefined
  visit(tree, (node) => {
    if (result) return false
    if (
      node.type !== 'mdxJsxFlowElement' &&
      node.type !== 'mdxJsxTextElement'
    ) {
      return true
    }
    const name = node.name
    const start = node.position?.start.offset
    if (
      typeof name !== 'string' ||
      !/^[A-Z_$]/u.test(name) ||
      start === undefined
    ) {
      return true
    }
    const openingEnd = openingMdxTagEndOffset(source, node)
    if (openingEnd === undefined || offset < start || offset > openingEnd) {
      return true
    }
    const relative = source.slice(start, openingEnd).indexOf(name)
    if (relative >= 0) result = {name, nameStart: start + relative}
    return true
  })
  return result
}

function visit(
  node: MarkscriptNode,
  run: (node: MarkscriptNode) => boolean,
): void {
  if (!run(node)) return
  for (const child of node.children ?? []) visit(child, run)
}

function nodeAtOffset(sourceFile: ts.SourceFile, offset: number): ts.Node {
  let result: ts.Node = sourceFile
  const visitNode = (node: ts.Node): void => {
    if (offset < node.getFullStart() || offset > node.getEnd()) return
    result = node
    node.forEachChild(visitNode)
  }
  sourceFile.forEachChild(visitNode)
  return result
}

function sourceDocumentUri(context: LanguageServiceContext, uri: URI): URI {
  return context.decodeEmbeddedDocumentUri(uri)?.[0] ?? uri
}

function sourceFilename(
  context: LanguageServiceContext,
  documentUri: string,
): string {
  const uri = sourceDocumentUri(context, URI.parse(documentUri))
  try {
    return uri.scheme === 'file'
      ? fileURLToPath(uri.toString())
      : uri.toString()
  } catch {
    return uri.toString()
  }
}

function offsetsToRange(
  document: TextDocument,
  start: number,
  end: number,
): Range {
  return {start: document.positionAt(start), end: document.positionAt(end)}
}
