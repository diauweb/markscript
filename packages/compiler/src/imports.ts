import ts from 'typescript'
/** Bind runtime module identities without evaluating the source or its dependencies. */
export function moduleImportTransformer(
  imports: ReadonlyMap<string, string>,
): ts.TransformerFactory<ts.SourceFile> {
  const literal = (
    node: ts.Expression | undefined,
  ): ts.Expression | undefined => {
    if (!node || !ts.isStringLiteral(node)) return node
    let target = imports.get(node.text)
    if (!target)
      for (const [prefix, value] of imports) {
        if (prefix.endsWith('/') && node.text.startsWith(prefix)) {
          target = value + node.text.slice(prefix.length)
          break
        }
      }
    return target
      ? ts.setTextRange(ts.factory.createStringLiteral(target), node)
      : node
  }
  return (context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isImportDeclaration(node))
        return ts.factory.updateImportDeclaration(
          node,
          node.modifiers,
          node.importClause,
          literal(node.moduleSpecifier) as ts.Expression,
          node.attributes,
        )
      if (ts.isExportDeclaration(node))
        return ts.factory.updateExportDeclaration(
          node,
          node.modifiers,
          node.isTypeOnly,
          node.exportClause,
          literal(node.moduleSpecifier),
          node.attributes,
        )
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      )
        return ts.factory.updateCallExpression(
          node,
          node.expression,
          node.typeArguments,
          node.arguments.map((arg, i) =>
            i === 0 ? (literal(arg) as ts.Expression) : arg,
          ),
        )
      return ts.visitEachChild(node, visit, context)
    }
    return (file) => ts.visitNode(file, visit) as ts.SourceFile
  }
}
