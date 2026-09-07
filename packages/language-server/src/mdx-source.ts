import type {MarkscriptNode} from '@markscript/compiler'

/** Locate an opening MDX tag terminator after its parser-owned attributes. */
export function openingMdxTagEndOffset(
  source: string,
  node: MarkscriptNode,
): number | undefined {
  const start = node.position?.start.offset
  const limit = node.position?.end.offset
  if (start === undefined || limit === undefined) return undefined

  let cursor = start + 1
  for (const attribute of node.attributes ?? []) {
    const attributeEnd = attribute.position?.end.offset
    if (attributeEnd !== undefined) cursor = Math.max(cursor, attributeEnd)
  }
  return nextTagEndOffset(source, cursor, limit)
}

/** Closing MDX tags contain a name and whitespace but no JavaScript values. */
export function closingMdxTagEndOffset(
  source: string,
  start: number,
  limit: number,
): number | undefined {
  return nextTagEndOffset(source, start + 2, limit)
}

function nextTagEndOffset(
  source: string,
  start: number,
  limit: number,
): number | undefined {
  const end = source.indexOf('>', start)
  return end >= 0 && end < limit ? end : undefined
}
