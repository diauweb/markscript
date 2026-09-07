import type {Acorn, AcornOptions} from 'micromark-util-events-to-acorn'
import type {CompileContext} from 'micromark-util-types'

import {directiveHtml as html} from './lib/html.js'
import {directive as syntax} from './lib/syntax.js'

export const directiveHtml = html
export const directive = syntax

/**
 * Internal tuple representing an attribute.
 */
type AttributeTuple = [key: string, value: string]

/**
 * Directive attribute.
 */
interface Attributes {
  /**
   * Key to value.
   */
  [key: string]: string
}

/**
 * Structure representing a directive.
 */
export interface Directive {
  /**
   * Private :)
   */
  _fenceCount?: number | undefined
  /**
   * Object w/ HTML attributes.
   */
  attributes?: Attributes | undefined
  /**
   * Compiled HTML content inside container directive.
   */
  content?: string | undefined
  /**
   * Compiled HTML content that was in `[brackets]`.
   */
  label?: string | undefined
  /**
   * Name of directive.
   */
  name: string
  /**
   * Kind.
   */
  type: 'containerDirective' | 'leafDirective' | 'textDirective'
}

/**
 * Handle a directive.
 *
 * @param this
 *   Current context.
 * @param directive
 *   Directive.
 * @returns
 *   Signal whether the directive was handled.
 *
 *   Yield `false` to let the fallback (a special handle for `'*'`) handle it.
 */
export type Handle = (
  this: CompileContext,
  directive: Directive,
) => boolean | undefined

/**
 * Configuration.
 *
 * > 👉 **Note**: the special field `'*'` can be used to specify a fallback
 * > handle to handle all otherwise unhandled directives.
 */
export interface HtmlOptions {
  [name: string]: Handle
}

/**
 * Augment types.
 */
declare module 'micromark-util-types' {
  /**
   * Compile data.
   */
  interface CompileData {
    directiveAttributes?: Array<AttributeTuple>
    directiveStack?: Array<Directive>
  }

  /**
   * Token types.
   */
  interface TokenTypeMap {
    directiveContainer: 'directiveContainer'
    directiveContainerAttributes: 'directiveContainerAttributes'
    directiveContainerAttributesMarker: 'directiveContainerAttributesMarker'
    directiveContainerAttribute: 'directiveContainerAttribute'
    directiveContainerAttributeId: 'directiveContainerAttributeId'
    directiveContainerAttributeIdValue: 'directiveContainerAttributeIdValue'
    directiveContainerAttributeClass: 'directiveContainerAttributeClass'
    directiveContainerAttributeClassValue: 'directiveContainerAttributeClassValue'
    directiveContainerAttributeName: 'directiveContainerAttributeName'
    directiveContainerAttributeInitializerMarker: 'directiveContainerAttributeInitializerMarker'
    directiveContainerAttributeValueLiteral: 'directiveContainerAttributeValueLiteral'
    directiveContainerAttributeValue: 'directiveContainerAttributeValue'
    directiveContainerAttributeValueMarker: 'directiveContainerAttributeValueMarker'
    directiveContainerAttributeValueData: 'directiveContainerAttributeValueData'
    directiveContainerAttributeExpression: 'directiveContainerAttributeExpression'
    directiveContainerAttributeExpressionMarker: 'directiveContainerAttributeExpressionMarker'
    directiveContainerAttributeExpressionValue: 'directiveContainerAttributeExpressionValue'
    directiveContainerAttributeValueExpression: 'directiveContainerAttributeValueExpression'
    directiveContainerAttributeValueExpressionMarker: 'directiveContainerAttributeValueExpressionMarker'
    directiveContainerAttributeValueExpressionValue: 'directiveContainerAttributeValueExpressionValue'
    directiveContainerContent: 'directiveContainerContent'
    directiveContainerFence: 'directiveContainerFence'
    directiveContainerLabel: 'directiveContainerLabel'
    directiveContainerLabelMarker: 'directiveContainerLabelMarker'
    directiveContainerLabelString: 'directiveContainerLabelString'
    directiveContainerName: 'directiveContainerName'
    directiveContainerSequence: 'directiveContainerSequence'

    directiveLeaf: 'directiveLeaf'
    directiveLeafAttributes: 'directiveLeafAttributes'
    directiveLeafAttributesMarker: 'directiveLeafAttributesMarker'
    directiveLeafAttribute: 'directiveLeafAttribute'
    directiveLeafAttributeId: 'directiveLeafAttributeId'
    directiveLeafAttributeIdValue: 'directiveLeafAttributeIdValue'
    directiveLeafAttributeClass: 'directiveLeafAttributeClass'
    directiveLeafAttributeClassValue: 'directiveLeafAttributeClassValue'
    directiveLeafAttributeName: 'directiveLeafAttributeName'
    directiveLeafAttributeInitializerMarker: 'directiveLeafAttributeInitializerMarker'
    directiveLeafAttributeValueLiteral: 'directiveLeafAttributeValueLiteral'
    directiveLeafAttributeValue: 'directiveLeafAttributeValue'
    directiveLeafAttributeValueMarker: 'directiveLeafAttributeValueMarker'
    directiveLeafAttributeValueData: 'directiveLeafAttributeValueData'
    directiveLeafAttributeExpression: 'directiveLeafAttributeExpression'
    directiveLeafAttributeExpressionMarker: 'directiveLeafAttributeExpressionMarker'
    directiveLeafAttributeExpressionValue: 'directiveLeafAttributeExpressionValue'
    directiveLeafAttributeValueExpression: 'directiveLeafAttributeValueExpression'
    directiveLeafAttributeValueExpressionMarker: 'directiveLeafAttributeValueExpressionMarker'
    directiveLeafAttributeValueExpressionValue: 'directiveLeafAttributeValueExpressionValue'
    directiveLeafLabel: 'directiveLeafLabel'
    directiveLeafLabelMarker: 'directiveLeafLabelMarker'
    directiveLeafLabelString: 'directiveLeafLabelString'
    directiveLeafName: 'directiveLeafName'
    directiveLeafSequence: 'directiveLeafSequence'

    directiveText: 'directiveText'
    directiveTextAttributes: 'directiveTextAttributes'
    directiveTextAttributesMarker: 'directiveTextAttributesMarker'
    directiveTextAttribute: 'directiveTextAttribute'
    directiveTextAttributeId: 'directiveTextAttributeId'
    directiveTextAttributeIdValue: 'directiveTextAttributeIdValue'
    directiveTextAttributeClass: 'directiveTextAttributeClass'
    directiveTextAttributeClassValue: 'directiveTextAttributeClassValue'
    directiveTextAttributeName: 'directiveTextAttributeName'
    directiveTextAttributeInitializerMarker: 'directiveTextAttributeInitializerMarker'
    directiveTextAttributeValueLiteral: 'directiveTextAttributeValueLiteral'
    directiveTextAttributeValue: 'directiveTextAttributeValue'
    directiveTextAttributeValueMarker: 'directiveTextAttributeValueMarker'
    directiveTextAttributeValueData: 'directiveTextAttributeValueData'
    directiveTextAttributeExpression: 'directiveTextAttributeExpression'
    directiveTextAttributeExpressionMarker: 'directiveTextAttributeExpressionMarker'
    directiveTextAttributeExpressionValue: 'directiveTextAttributeExpressionValue'
    directiveTextAttributeValueExpression: 'directiveTextAttributeValueExpression'
    directiveTextAttributeValueExpressionMarker: 'directiveTextAttributeValueExpressionMarker'
    directiveTextAttributeValueExpressionValue: 'directiveTextAttributeValueExpressionValue'
    directiveTextLabel: 'directiveTextLabel'
    directiveTextLabelMarker: 'directiveTextLabelMarker'
    directiveTextLabelString: 'directiveTextLabelString'
    directiveTextMarker: 'directiveTextMarker'
    directiveTextName: 'directiveTextName'
  }
}
export interface Options {
  acorn?: Acorn | null | undefined
  acornOptions?: AcornOptions | null | undefined
  addResult?: boolean | null | undefined
}
