import type {Position} from 'unist'

export interface MarkscriptNode {
  type: string
  value?: string
  name?: string | null
  depth?: number
  ordered?: boolean
  start?: number | null
  spread?: boolean
  checked?: boolean | null
  url?: string
  title?: string | null
  alt?: string
  lang?: string | null
  meta?: string | null
  identifier?: string
  label?: string | null
  referenceType?: 'shortcut' | 'collapsed' | 'full'
  attributes?: MarkscriptAttribute[]
  directiveAttributes?: MarkscriptAttribute[]
  children?: MarkscriptNode[]
  position?: Position
  data?: Record<string, unknown>
  [key: string]: unknown
}

export interface MdxAttribute {
  type: 'mdxJsxAttribute'
  name: string
  value: string | null | MdxExpressionValue
  position?: Position
}

export interface MdxSpreadAttribute {
  type: 'mdxJsxExpressionAttribute'
  value: string
  position?: Position
}

export interface MdxExpressionValue {
  type: 'mdxJsxAttributeValueExpression'
  value: string
  data?: Record<string, unknown>
}

export type MarkscriptAttribute = MdxAttribute | MdxSpreadAttribute
