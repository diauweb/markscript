import {readFile} from 'node:fs/promises'
import {isBuiltin} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseMarkscript, registeredModuleSources} from '@markscript/compiler'
import ts from 'typescript'

export interface CodeEvidence {
  modules: {module: string; source: string}[]
  imports: {from: string; specifier: string; to: string}[]
  unavailable: string[]
  inert: boolean
}
const packageRoot = path.resolve(
  fileURLToPath(import.meta.resolve('msh')),
  '../..',
)
export const guardedWorkspace = path.join(packageRoot, 'library/workspace.ms')
const trusted = (filename: string) =>
  [
    path.join(packageRoot, 'src/workspace.ts'),
    path.join(packageRoot, 'dist/index.js'),
    ...['core', 'kernel', 'agent', 'approval', 'shell'].map((name) =>
      path.join(packageRoot, `dist/${name}.js`),
    ),
  ].includes(filename)

/** Prove only a small inert subset; every other executable form goes to review. */
export async function codeEvidence(
  filename: string,
  source: string,
  resolve: (specifier: string, cwd: string) => string,
): Promise<CodeEvidence> {
  const modules = new Map<string, string>()
  const imports: CodeEvidence['imports'] = []
  const unavailable = new Set<string>()
  const safe = new Map<string, boolean>()
  let size = 0
  async function visit(file: string, text: string): Promise<boolean> {
    if (safe.has(file)) return safe.get(file) ?? false
    safe.set(file, false)
    modules.set(file, text)
    size += text.length
    if (modules.size > 24 || size > 64_000) {
      unavailable.add('Source graph exceeds the review limit')
      return false
    }
    const isMarkscript = file.endsWith('.ms')
    const tree = isMarkscript ? parseMarkscript(text, file).tree : undefined
    const blocks: string[] = []
    const expressions: string[] = []
    let inert = true
    if (isMarkscript) {
      if (!tree) return false
      const walk = (node: {
        type: string
        value?: string
        children?: unknown[]
      }) => {
        if (node.type === 'mdxjsEsm') blocks.push(node.value ?? '')
        else if (
          node.type === 'mdxFlowExpression' ||
          node.type === 'mdxTextExpression'
        )
          expressions.push(node.value ?? '')
        else if (node.type.startsWith('mdx')) inert = false
        else
          for (const child of node.children ?? [])
            walk(child as Parameters<typeof walk>[0])
      }
      walk(tree)
    } else blocks.push(text)
    const files = blocks.map((block) =>
      ts.createSourceFile(
        file,
        block,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      ),
    )
    const documents = new Set<string>()
    for (const ast of files) {
      for (const statement of ast.statements) {
        if (
          !ts.isImportDeclaration(statement) &&
          !ts.isExportDeclaration(statement)
        )
          continue
        if (
          !statement.moduleSpecifier ||
          !ts.isStringLiteral(statement.moduleSpecifier)
        )
          continue
        if (
          (ts.isImportDeclaration(statement) &&
            statement.importClause?.isTypeOnly) ||
          (ts.isExportDeclaration(statement) && statement.isTypeOnly)
        )
          continue
        const specifier = statement.moduleSpecifier.text
        if (isBuiltin(specifier)) continue
        try {
          const target = resolve(specifier, path.dirname(file))
          imports.push({from: file, specifier, to: target})
          if (trusted(target)) continue
          const source =
            registeredModuleSources().get(target) ??
            (await readFile(target, 'utf8'))
          const pure = await visit(target, source)
          inert &&= pure
          if (
            pure &&
            target.endsWith('.ms') &&
            ts.isImportDeclaration(statement) &&
            statement.importClause?.name
          )
            documents.add(statement.importClause.name.text)
        } catch {
          unavailable.add(specifier)
          inert = false
        }
      }
    }
    const expression = (node: ts.Expression): boolean => {
      if (
        ts.isLiteralExpression(node) ||
        [
          ts.SyntaxKind.TrueKeyword,
          ts.SyntaxKind.FalseKeyword,
          ts.SyntaxKind.NullKeyword,
        ].includes(node.kind)
      )
        return true
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true
      if (
        ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node) ||
        ts.isTypeAssertionExpression(node)
      )
        return expression(node.expression)
      if (ts.isArrayLiteralExpression(node))
        return node.elements.every(
          (element) => !ts.isSpreadElement(element) && expression(element),
        )
      if (ts.isObjectLiteralExpression(node))
        return node.properties.every(
          (p) =>
            ts.isPropertyAssignment(p) &&
            !ts.isComputedPropertyName(p.name) &&
            expression(p.initializer),
        )
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        documents.has(node.expression.text) &&
        !node.arguments.length
      )
        return true
      return false
    }
    for (const ast of files) {
      for (const statement of ast.statements) {
        if (
          ts.isImportDeclaration(statement) ||
          ts.isExportDeclaration(statement) ||
          ts.isFunctionDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isEmptyStatement(statement)
        )
          continue
        if (ts.isVariableStatement(statement)) {
          inert &&= statement.declarationList.declarations.every(
            (d) =>
              ts.isIdentifier(d.name) &&
              (!d.initializer || expression(d.initializer)),
          )
        } else if (ts.isExportAssignment(statement))
          inert &&= expression(statement.expression)
        else inert = false
      }
    }
    for (const value of expressions) {
      const ast = ts.createSourceFile(
        'expression.ts',
        `(${value})`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      )
      const statement = ast.statements[0]
      inert &&= Boolean(
        statement &&
          ts.isExpressionStatement(statement) &&
          expression(statement.expression),
      )
    }
    safe.set(file, inert)
    return inert
  }
  const inert = await visit(filename, source)
  return {
    modules: [...modules].map(([module, source]) => ({module, source})),
    imports,
    unavailable: [...unavailable],
    inert,
  }
}

export async function verifySources(evidence: CodeEvidence) {
  for (const entry of evidence.modules) {
    const current =
      registeredModuleSources().get(entry.module) ??
      (await readFile(entry.module, 'utf8'))
    if (current !== entry.source)
      throw new Error(
        `Source changed during approval: ${entry.module}. Retry to review its current contents.`,
      )
  }
}
