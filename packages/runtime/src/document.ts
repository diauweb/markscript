/** Metadata carried by callable documents, independently of any harness. */
export const DOCUMENT = Symbol.for('markscript.document')
export interface DocumentDefinition {
  readonly origin: string
  readonly source: string
  readonly bindings: () => Record<string, unknown>
}
export function defineDocument<T extends (...args: never[]) => unknown>(
  entry: T,
  definition: DocumentDefinition,
): T & {readonly [DOCUMENT]: DocumentDefinition} {
  return Object.defineProperty(entry, DOCUMENT, {
    value: Object.freeze(definition),
  }) as T & {readonly [DOCUMENT]: DocumentDefinition}
}
export function documentDefinition(
  value: unknown,
): DocumentDefinition | undefined {
  return typeof value === 'function' && DOCUMENT in value
    ? (value as unknown as {[DOCUMENT]: DocumentDefinition})[DOCUMENT]
    : undefined
}
