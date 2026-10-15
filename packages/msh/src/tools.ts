import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  analyzeFile,
  hasErrors,
  MarkScriptCompilationError,
} from '@markscript/compiler'
import {Schema} from 'effect'
import ts from 'typescript'
import type {ToolDefinition} from './types.ts'

export interface InferredTool {
  exportName: string
  origin: {module: string; name: string}
  definition: ToolDefinition
  arguments(input: unknown): unknown[]
}

export async function inferTools(
  filename: string,
  sourceOverrides?: ReadonlyMap<string, string>,
): Promise<InferredTool[]> {
  const {program, entry, diagnostics, location} = await analyzeFile(filename, {
    ...(sourceOverrides ? {sourceOverrides} : {}),
    compilerOptions: {
      paths: {
        msh: [
          fileURLToPath(import.meta.resolve('msh')).replace(
            /dist\/index\.js$/u,
            'types/index.d.ts',
          ),
        ],
        ...Object.fromEntries(
          ['core', 'agent', 'approval', 'shell'].map((name) => [
            `msh/${name}`,
            [
              path.resolve(
                fileURLToPath(import.meta.resolve('msh')),
                `../../types/${name}.d.ts`,
              ),
            ],
          ]),
        ),
        'msh/kernel': [
          fileURLToPath(import.meta.resolve('msh/kernel')).replace(
            /dist\/kernel\.js$/u,
            'types/kernel.d.ts',
          ),
        ],
        'msh/*': [
          path.resolve(fileURLToPath(import.meta.resolve('msh')), '../../*'),
        ],
      },
    },
  })
  if (hasErrors(diagnostics)) throw new MarkScriptCompilationError(diagnostics)
  const checker = program.getTypeChecker()
  const module = checker.getSymbolAtLocation(entry)
  if (!module) return []
  const cache = new Map<ts.Type, Schema.Codec<unknown>>()
  const arrayElement = (type: ts.Type): ts.Type | undefined => {
    if (checker.isArrayType(type) || type.symbol?.name === 'ReadonlyArray')
      return checker.getTypeArguments(type as ts.TypeReference)[0]
    if (
      type.flags & ts.TypeFlags.Object &&
      (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Interface
    ) {
      for (const base of checker.getBaseTypes(type as ts.InterfaceType)) {
        const element = arrayElement(base)
        if (element) return element
      }
    }
    return undefined
  }

  const convert = (type: ts.Type): Schema.Codec<unknown> => {
    const cached = cache.get(type)
    if (cached) return cached
    let resolved: Schema.Codec<unknown> | undefined
    cache.set(
      type,
      Schema.suspend(() => {
        if (!resolved)
          throw new Error(
            `Recursive type could not be resolved: ${checker.typeToString(type)}`,
          )
        return resolved
      }),
    )
    const flags = type.flags
    if (flags & ts.TypeFlags.StringLiteral)
      resolved = Schema.Literal((type as ts.StringLiteralType).value)
    else if (flags & ts.TypeFlags.NumberLiteral)
      resolved = Schema.Literal((type as ts.NumberLiteralType).value)
    else if (flags & ts.TypeFlags.BooleanLiteral)
      resolved = Schema.Literal(checker.typeToString(type) === 'true')
    else if (flags & ts.TypeFlags.String) resolved = Schema.String
    else if (flags & ts.TypeFlags.Number) resolved = Schema.Finite
    else if (flags & ts.TypeFlags.Boolean) resolved = Schema.Boolean
    else if (flags & ts.TypeFlags.Null) resolved = Schema.Null
    else if (type.isUnion()) {
      const members = type.types.filter(
        (member) => !(member.flags & ts.TypeFlags.Undefined),
      )
      if (!members.length)
        throw new Error('A tool parameter must accept JSON values')
      resolved = Schema.Union(members.map(convert))
    } else if (checker.isTupleType(type)) {
      throw new Error(
        'Use arrays or named objects instead of tuple tool parameters',
      )
    } else if (arrayElement(type)) {
      const element = arrayElement(type)
      if (!element) throw new Error('Missing array element type')
      resolved = Schema.Array(convert(element))
    } else if (flags & ts.TypeFlags.Object) {
      if (
        type.getCallSignatures().length ||
        type.getConstructSignatures().length ||
        (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Class
      ) {
        throw new Error('Tool parameters must use JSON data types')
      }
      const index = checker.getIndexTypeOfType(type, ts.IndexKind.String)
      const properties = checker.getPropertiesOfType(type)
      if (index) {
        if (properties.length)
          throw new Error(
            'Use a separate record field for indexed tool parameters',
          )
        resolved = Schema.Record(Schema.String, convert(index))
      } else {
        const fields: Record<string, Schema.Codec<unknown>> = {}
        for (const property of properties) {
          const declaration =
            property.valueDeclaration ?? property.declarations?.[0]
          if (!declaration)
            throw new Error(`Missing declaration for ${property.name}`)
          const value = convert(
            checker.getTypeOfSymbolAtLocation(property, declaration),
          )
          fields[property.name] =
            property.flags & ts.SymbolFlags.Optional
              ? Schema.optionalKey(value)
              : value
        }
        resolved = Schema.Struct(fields)
      }
    } else
      throw new Error(
        `Unsupported tool parameter type: ${checker.typeToString(type)}`,
      )
    if (!resolved)
      throw new Error(`Unsupported type: ${checker.typeToString(type)}`)
    cache.set(type, resolved)
    return resolved
  }

  const tools: InferredTool[] = []
  for (const exported of checker.getExportsOfModule(module)) {
    if (exported.name === 'default') continue
    const symbol =
      exported.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported)
        : exported
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (!declaration) continue
    const signatures = checker
      .getTypeOfSymbolAtLocation(symbol, declaration)
      .getCallSignatures()
    if (!signatures.length) continue
    try {
      if (signatures.length !== 1 || signatures[0]?.typeParameters?.length)
        throw new Error('Use one concrete tool signature')
      const signature = signatures[0]
      if (!signature) continue
      const parameters = signature.getParameters()
      let schema: Schema.Codec<unknown>
      let toArguments: (input: Record<string, unknown>) => unknown[]
      const single = parameters.length === 1 ? parameters[0] : undefined
      const singleDeclaration = single?.valueDeclaration
      const singleType =
        single && singleDeclaration
          ? checker.getTypeOfSymbolAtLocation(single, singleDeclaration)
          : undefined
      if (
        singleType &&
        singleDeclaration &&
        singleType.flags & ts.TypeFlags.Object &&
        !checker.isArrayType(singleType) &&
        !checker.isTupleType(singleType)
      ) {
        schema = convert(singleType)
        toArguments = (input) => [input]
      } else {
        const fields: Record<string, Schema.Codec<unknown>> = {}
        for (const parameter of parameters) {
          const decl = parameter.valueDeclaration
          if (
            !decl ||
            !ts.isParameter(decl) ||
            !ts.isIdentifier(decl.name) ||
            decl.dotDotDotToken
          )
            throw new Error('Use named parameters or one object parameter')
          const field = convert(
            checker.getTypeOfSymbolAtLocation(parameter, decl),
          )
          fields[parameter.name] =
            decl.questionToken || decl.initializer
              ? Schema.optionalKey(field)
              : field
        }
        schema = Schema.Struct(fields)
        toArguments = (input) =>
          parameters.map((parameter) => input[parameter.name])
      }
      const document = Schema.toJsonSchemaDocument(schema)
      const name = exported.name
      if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(name))
        throw new Error(`Invalid tool name: ${name}`)
      const jsonSchema = {
        ...document.schema,
        ...(Object.keys(document.definitions).length
          ? {$defs: document.definitions}
          : {}),
      }
      tools.push({
        exportName: exported.name,
        origin: {module: location(declaration).filename, name: symbol.name},
        definition: {
          type: 'function',
          function: {
            name,
            description: ts.displayPartsToString(
              symbol.getDocumentationComment(checker),
            ),
            parameters: parameters.length
              ? jsonSchema
              : {type: 'object', properties: {}, additionalProperties: false},
          },
        },
        arguments: (input) => {
          Schema.decodeUnknownSync(Schema.Json)(input)
          const decoded = Schema.decodeUnknownSync(schema, {
            onExcessProperty: 'error',
          })(input)
          return toArguments(decoded as Record<string, unknown>)
        },
      })
    } catch (error) {
      const point = location(declaration)
      throw new Error(
        `${point.filename}:${point.line}:${point.column}: tool ${exported.name}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return tools
}
