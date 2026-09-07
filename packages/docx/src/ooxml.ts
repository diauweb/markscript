import {XMLParser, XMLValidator} from 'fast-xml-parser'
import type {Root} from 'mdast'
import {fenceOptions, transformFences} from './fences.ts'

export interface OoxmlTransformOptions {
  validate?: (xml: string, context: 'block' | 'inline') => void
}

export async function transformOoxml(
  root: Root,
  options: OoxmlTransformOptions = {},
): Promise<void> {
  await transformFences(root, 'ooxml', (node, _parent, path) => {
    const sourcePath = withLocation(path, node)
    const requested = fenceOptions(node).context ?? 'block'
    if (requested !== 'block') {
      throw new TypeError(`${sourcePath}: ooxml fences are block content`)
    }
    const xml = node.value.trim()
    const rootName = validateXml(xml, sourcePath)
    if (requested === 'block' && rootName === 'w:r') {
      throw new TypeError(`${sourcePath}: w:r is inline OOXML, not block OOXML`)
    }
    try {
      options.validate?.(xml, requested)
    } catch (error) {
      throw new Error(`${sourcePath}: custom ooxml validation failed`, {
        cause: error,
      })
    }
    return {
      type: 'html',
      value: xml,
      position: node.position,
      data: {docx: {rawXml: {context: requested, xml}}},
    }
  })
}

function validateXml(xml: string, path: string): string {
  if (xml.length === 0) throw new SyntaxError(`${path}: ooxml fence is empty`)
  if (/<!DOCTYPE|<!ENTITY|<\?/iu.test(xml)) {
    throw new SyntaxError(
      `${path}: ooxml declarations and entities are forbidden`,
    )
  }
  const validation = XMLValidator.validate(`<markscript>${xml}</markscript>`)
  if (validation !== true) {
    throw new SyntaxError(
      `${path}: invalid ooxml: ${validation.err.msg} at line ${validation.err.line}`,
    )
  }

  const parsed = new XMLParser({preserveOrder: true}).parse(
    `<markscript>${xml}</markscript>`,
  ) as unknown
  const wrapper = Array.isArray(parsed) ? parsed[0] : undefined
  const children =
    wrapper !== undefined && typeof wrapper === 'object' && wrapper !== null
      ? (wrapper as Record<string, unknown>).markscript
      : undefined
  if (!Array.isArray(children)) {
    throw new SyntaxError(`${path}: ooxml must contain exactly one XML root`)
  }
  const elements = children.filter((child) => {
    if (typeof child !== 'object' || child === null) return false
    return Object.keys(child).some(
      (key) => key !== '#text' && key !== '#comment',
    )
  })
  const outerText = children.some((child) => {
    if (typeof child !== 'object' || child === null) return false
    const text = (child as Record<string, unknown>)['#text']
    return typeof text === 'string' && text.trim().length > 0
  })
  if (elements.length !== 1 || outerText) {
    throw new SyntaxError(
      `${path}: ooxml must contain exactly one XML root and no outer text`,
    )
  }
  const element = elements[0] as Record<string, unknown>
  const rootName = Object.keys(element).find(
    (key) => key !== '#text' && key !== '#comment' && key !== ':@',
  )
  if (rootName === undefined) {
    throw new SyntaxError(`${path}: ooxml must contain exactly one XML root`)
  }
  return rootName
}

function withLocation(
  path: string,
  node: {position?: Root['position']},
): string {
  const start = node.position?.start
  return start === undefined
    ? path
    : `${path} (source ${start.line}:${start.column})`
}
