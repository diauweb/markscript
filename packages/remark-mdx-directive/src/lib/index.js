/**
 * @import {} from '@markscript/mdast-util-mdx-directive'
 * @import {Options} from '@markscript/micromark-extension-mdx-directive'
 * @import {} from 'remark-parse'
 * @import {Data, Processor} from 'unified'
 */

import {
  directiveFromMarkdown,
  directiveToMarkdown,
} from '@markscript/mdast-util-mdx-directive'
import {directive} from '@markscript/micromark-extension-mdx-directive'

/**
 * Add support for generic directives.
 *
 * ###### Notes
 *
 * Doesn’t handle the directives: create your own plugin to do that.
 *
 * @this {Processor}
 * @param {Options | undefined} [options]
 * @returns {undefined}
 *   Nothing.
 */
export default function remarkDirective(options) {
  /** @type {Data & {toMarkdownExtensions?: Array<import('mdast-util-to-markdown').Options>}} */
  const data = this.data()

  data.micromarkExtensions ??= []
  data.fromMarkdownExtensions ??= []
  data.toMarkdownExtensions ??= []
  const micromarkExtensions = data.micromarkExtensions
  const fromMarkdownExtensions = data.fromMarkdownExtensions
  const toMarkdownExtensions = data.toMarkdownExtensions

  micromarkExtensions.push(directive(options))
  fromMarkdownExtensions.push(directiveFromMarkdown())
  toMarkdownExtensions.push(directiveToMarkdown())
}
