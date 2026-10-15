import {readFile} from 'node:fs/promises'
import {isBuiltin} from 'node:module'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {
  installBunLoader,
  moduleImportTransformer,
  parseMarkscript,
  registeredModuleSources,
  registerModuleSource,
} from '@markscript/compiler'
import {documentDefinition} from '@markscript/runtime'
import {gfmToMarkdown} from 'mdast-util-gfm'
import {toMarkdown} from 'mdast-util-to-markdown'
import ts from 'typescript'
import {useContext} from './context.ts'
import type {
  Binding,
  ContextPart,
  ContextRecord,
  DocumentEntry,
  Evaluation,
  InstructionPart,
  Prepared,
} from './core-types.ts'
import {type ExtensionScope, isExtension} from './extensions.ts'
export const primitiveNames = [
  'spawn',
  'send',
  'inspect',
  'wait',
  'exec',
] as const
export function serialize(value: unknown): string {
  const ancestors: object[] = []
  return (
    JSON.stringify(value ?? null, function (this: unknown, _key, item) {
      if (typeof item === 'bigint') return String(item)
      if (typeof item === 'function')
        return `[Function ${item.name || 'anonymous'}]`
      if (typeof item === 'symbol') return String(item)
      if (typeof item === 'object' && item !== null) {
        while (ancestors.length && ancestors.at(-1) !== this) ancestors.pop()
        if (ancestors.includes(item)) return '[Circular]'
        ancestors.push(item)
      }
      return item
    }) ?? 'null'
  )
}
function syntax(source: string) {
  const parsed = parseMarkscript(source, 'emission.ms')
  const names = new Set<string>()
  let acted = false
  let hasModule = false
  const imports: string[] = []
  const walk = (node: {type: string; value?: string; children?: unknown[]}) => {
    if (node.type === 'mdxjsEsm') {
      hasModule = true
      const file = ts.createSourceFile(
        'emission.ts',
        node.value ?? '',
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      )
      const binding = (name: ts.BindingName) => {
        if (ts.isIdentifier(name)) names.add(name.text)
        else
          for (const item of name.elements)
            if (ts.isBindingElement(item)) binding(item.name)
      }
      for (const s of file.statements) {
        if (
          ((ts.isImportDeclaration(s) && !s.importClause?.isTypeOnly) ||
            (ts.isExportDeclaration(s) && !s.isTypeOnly)) &&
          s.moduleSpecifier &&
          ts.isStringLiteral(s.moduleSpecifier)
        )
          imports.push(s.moduleSpecifier.text)
        if (ts.isImportDeclaration(s) && s.importClause) {
          if (s.importClause.name) names.add(s.importClause.name.text)
          const b = s.importClause.namedBindings
          if (b && ts.isNamespaceImport(b)) names.add(b.name.text)
          else if (b) for (const e of b.elements) names.add(e.name.text)
        } else if (ts.isVariableStatement(s))
          for (const d of s.declarationList.declarations) binding(d.name)
        else if (
          (ts.isFunctionDeclaration(s) ||
            ts.isClassDeclaration(s) ||
            ts.isInterfaceDeclaration(s) ||
            ts.isTypeAliasDeclaration(s)) &&
          s.name
        )
          names.add(s.name.text)
      }
    } else {
      if (node.type.startsWith('mdx') && node.type !== 'mdxjsEsm') acted = true
      for (const child of node.children ?? [])
        walk(child as Parameters<typeof walk>[0])
    }
  }
  if (parsed.tree) walk(parsed.tree)
  return {names, acted, hasModule, imports}
}
export class Modules {
  private readonly imports: Map<string, string>
  constructor() {
    const packageRoot = path.resolve(
      fileURLToPath(import.meta.resolve('msh')),
      '../..',
    )
    const imports = new Map([
      ['msh', path.join(packageRoot, 'dist/index.js')],
      ...['core', 'kernel', 'agent', 'approval', 'shell'].map(
        (name) =>
          [`msh/${name}`, path.join(packageRoot, `dist/${name}.js`)] as [
            string,
            string,
          ],
      ),
      ['msh/', `${packageRoot}/`],
    ])
    this.imports = imports
    installBunLoader(imports)
    const key = Symbol.for('msh.package-resolver')
    const global = globalThis as unknown as Record<symbol, unknown>
    if (!global[key]) {
      Bun.plugin({
        name: 'msh-package-resolver',
        setup(build) {
          // Runtime load hooks require a result. Leave package dependencies and
          // explicit CommonJS modules to Bun's native module loader.
          build.onLoad(
            {filter: /^(?!.*\/node_modules\/).*\.m?[jt]s$/u},
            async ({path: filename}) => {
              const source = await readFile(filename, 'utf8')
              if (
                filename.startsWith(`${packageRoot}/`) ||
                !source.includes('msh')
              )
                return {
                  contents: source,
                  loader: /\.m?ts$/u.test(filename) ? 'ts' : 'js',
                }
              const result = ts.transpileModule(source, {
                fileName: filename,
                compilerOptions: {
                  target: ts.ScriptTarget.ESNext,
                  module: ts.ModuleKind.ESNext,
                  verbatimModuleSyntax: true,
                  inlineSourceMap: true,
                  inlineSources: true,
                },
                transformers: {before: [moduleImportTransformer(imports)]},
              })
              return {contents: result.outputText, loader: 'js'}
            },
          )
        },
      })
      global[key] = true
    }
  }
  resolve(specifier: string, cwd: string): string {
    const exact = this.imports.get(specifier)
    if (exact) return exact
    if (specifier.startsWith('msh/'))
      return `${this.imports.get('msh/')}${specifier.slice(4)}`
    if (specifier.startsWith('.') || path.isAbsolute(specifier))
      return path.resolve(cwd, specifier)
    return Bun.resolveSync(specifier, cwd)
  }
  async code(
    specifier: string,
    cwd: string,
    scope: ExtensionScope,
  ): Promise<{default: () => unknown}> {
    const filename = this.resolve(specifier, cwd)
    if (!/\.[cm]?[jt]sx?$/u.test(filename))
      throw new Error('Code threads require a JS/TS module')
    const source = await readFile(filename, 'utf8')
    await useContext().host.hook<Evaluation>('evaluate.before', {
      module: filename,
      source,
      resolve: this.resolve.bind(this),
    })
    useContext()
    const module = await import(pathToFileURL(filename).href)
    await this.activateImports(filename, source, scope)
    for (const value of Object.values(module))
      if (isExtension(value)) await scope.activate(value, filename)
    await useContext().host.hook<Evaluation>(
      'evaluate.ready',
      {
        module: filename,
        source,
        resolve: this.resolve.bind(this),
      },
      scope,
    )
    if (typeof module.default !== 'function')
      throw new Error('Code module must default-export its entry function')
    return module
  }
  /** Context messages are source records. Reading never imports or renders them. */
  async read(parts: ContextPart[], cwd: string): Promise<ContextRecord[]> {
    if (!Array.isArray(parts))
      throw new Error('Messages must be an array of MarkScript parts')
    return Promise.all(
      parts.map(async (part) => {
        if (typeof part === 'string')
          return {
            module: path.join(cwd, `.msh-${crypto.randomUUID()}.ms`),
            text: part,
          }
        if (typeof part === 'function') {
          const definition = documentDefinition(part)
          if (!definition)
            throw new Error('Expected an imported MarkScript document')
          return {module: definition.origin, text: definition.source}
        }
        if (!part || typeof part.module !== 'string')
          throw new Error('Invalid message module')
        if (part.input !== undefined)
          throw new Error('Inert message modules do not accept render input')
        const filename = this.resolve(part.module, cwd)
        if (!filename.endsWith('.ms'))
          throw new Error('Message modules must be MarkScript (.ms)')
        return {
          module: filename,
          text:
            registeredModuleSources().get(filename) ??
            (await readFile(filename, 'utf8')),
        }
      }),
    )
  }
  private async activateImports(
    filename: string,
    source: string,
    scope: ExtensionScope,
    visited = new Set<string>(),
  ): Promise<void> {
    if (visited.has(filename)) return
    visited.add(filename)
    const imports = filename.endsWith('.ms')
      ? syntax(source).imports
      : (() => {
          const file = ts.createSourceFile(
            filename,
            source,
            ts.ScriptTarget.Latest,
            true,
          )
          return file.statements.flatMap((s) =>
            ((ts.isImportDeclaration(s) && !s.importClause?.isTypeOnly) ||
              (ts.isExportDeclaration(s) && !s.isTypeOnly)) &&
            s.moduleSpecifier &&
            ts.isStringLiteral(s.moduleSpecifier)
              ? [s.moduleSpecifier.text]
              : [],
          )
        })()
    for (const specifier of imports) {
      if (isBuiltin(specifier)) continue
      const resolved = this.resolve(specifier, path.dirname(filename))
      if (visited.has(resolved)) continue
      const namespace = await import(pathToFileURL(resolved).href)
      for (const value of Object.values(namespace))
        if (isExtension(value)) await scope.activate(value, resolved)
      if (
        (specifier.startsWith('.') || path.isAbsolute(specifier)) &&
        /\.[cm]?[jt]sx?$|\.ms$/u.test(resolved) &&
        !resolved.includes('/node_modules/')
      ) {
        const dependency =
          registeredModuleSources().get(resolved) ??
          (await readFile(resolved, 'utf8'))
        await this.activateImports(resolved, dependency, scope, visited)
      } else visited.add(resolved)
    }
  }
  async prepare(
    parts: InstructionPart[],
    cwd: string,
    visible = new Map<string, Binding>(),
    scope?: ExtensionScope,
  ): Promise<Prepared> {
    if (!Array.isArray(parts))
      throw new Error('Context must be an array of MarkScript parts')
    const records: ContextRecord[] = []
    const bindings = new Map<string, Binding>()
    let acted = false
    for (const part of parts) {
      useContext()
      if (part && typeof part === 'object' && 'text' in part) {
        if (typeof part.text !== 'string')
          throw new Error('Prepared instruction text must be a string')
        records.push({
          module: path.join(cwd, `.msh-${crypto.randomUUID()}.ms`),
          text: part.text,
        })
        continue
      }
      let filename: string
      let entry: DocumentEntry | undefined
      let input: unknown
      if (typeof part === 'string') {
        filename = path.join(cwd, `.msh-${crypto.randomUUID()}.ms`)
        const {names, acted: executable, hasModule} = syntax(part)
        acted ||= executable
        const prelude: string[] = []
        const core =
          executable || hasModule
            ? primitiveNames.filter((name) => !names.has(name))
            : []
        if (core.length)
          prelude.push(`import {${core.join(',')}} from 'msh/kernel'`)
        for (const [name, binding] of new Map([...visible, ...bindings])) {
          if ((executable || hasModule) && !names.has(name))
            prelude.push(
              `import {${name}} from ${JSON.stringify(binding.module)}`,
            )
        }
        registerModuleSource(filename, [...prelude, part].join('\n\n'))
      } else if (typeof part === 'function') {
        const definition = documentDefinition(part)
        if (!definition)
          throw new Error(
            'Context functions must be imported MarkScript documents',
          )
        filename = definition.origin
        entry = part
      } else if (
        part &&
        typeof part === 'object' &&
        typeof part.module === 'string'
      ) {
        filename = this.resolve(part.module, cwd)
        input = part.input
      } else throw new Error('Invalid MarkScript context part')
      if (!filename.endsWith('.ms'))
        throw new Error('Context modules must be MarkScript (.ms)')
      const source =
        (entry ? documentDefinition(entry)?.source : undefined) ??
        registeredModuleSources().get(filename) ??
        (await readFile(filename, 'utf8'))
      acted ||= syntax(source).acted
      await useContext().host.hook<Evaluation>(
        'evaluate.before',
        {
          module: filename,
          source,
          ...(input === undefined ? {} : {input}),
          resolve: this.resolve.bind(this),
        },
        scope,
      )
      useContext()
      if (!entry)
        entry = (await import(pathToFileURL(filename).href))
          .default as DocumentEntry
      if (scope) await this.activateImports(filename, source, scope)
      const definition = documentDefinition(entry)
      if (!definition)
        throw new Error(`Missing document definition: ${filename}`)
      for (const value of Object.values(definition.bindings())) {
        if (scope && isExtension(value)) await scope.activate(value, filename)
      }
      await useContext().host.hook<Evaluation>(
        'evaluate.ready',
        {
          module: filename,
          source,
          ...(input === undefined ? {} : {input}),
          resolve: this.resolve.bind(this),
        },
        scope,
      )
      useContext()
      const root = await (
        entry as (input?: unknown) => ReturnType<DocumentEntry>
      )(input)
      useContext()
      for (const [name, value] of Object.entries(definition.bindings())) {
        if (name === 'default') continue
        bindings.set(name, {name, module: filename, value})
        if (scope && isExtension(value)) await scope.activate(value, filename)
      }
      records.push({
        module: filename,
        text: toMarkdown(root, {extensions: [gfmToMarkdown()]}),
        rendered: root,
        ...(input === undefined ? {} : {input: input as never}),
      })
    }
    return {records, bindings, acted}
  }
}
