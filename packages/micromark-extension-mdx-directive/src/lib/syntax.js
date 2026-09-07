/**
 * @import {Options} from '../index.js'
 * @import {AcornOptions} from 'micromark-util-events-to-acorn'
 * @import {Extension} from 'micromark-util-types'
 */

import {codes} from 'micromark-util-symbol'
import {directiveContainer} from './directive-container.js'
import {directiveLeaf} from './directive-leaf.js'
import {directiveText} from './directive-text.js'

/**
 * Create an extension for `micromark` to enable directive syntax.
 *
 * @param {Options | null | undefined} [options]
 * @returns {Extension}
 *   Extension for `micromark` that can be passed in `extensions`, to
 *   enable directive syntax.
 */
export function directive(options) {
  const settings = options || {}
  const acorn = settings.acorn
  /** @type {AcornOptions | undefined} */
  let acornOptions
  if (acorn) {
    if (!acorn.parse || !acorn.parseExpressionAt) {
      throw new Error(
        'Expected a proper `acorn` instance passed in as `options.acorn`',
      )
    }
    acornOptions = Object.assign(
      {ecmaVersion: 2024, sourceType: 'module'},
      settings.acornOptions,
      {locations: true},
    )
  } else if (settings.acornOptions || settings.addResult) {
    throw new Error('Expected an `acorn` instance passed in as `options.acorn`')
  }
  const expressionOptions = {
    acorn,
    acornOptions,
    addResult: settings.addResult || undefined,
  }
  return {
    text: {
      [codes.colon]: directiveText(expressionOptions),
    },
    flow: {
      [codes.colon]: [
        directiveContainer(expressionOptions),
        directiveLeaf(expressionOptions),
      ],
    },
  }
}
