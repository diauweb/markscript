/**
 * @import {DirectiveExpression, Directives, LeafDirective, TextDirective, ToMarkdownOptions} from '../index.js'
 * @import {
 *   CompileContext,
 *   Extension as FromMarkdownExtension,
 *   Handle as FromMarkdownHandle,
 *   Token
 * } from 'mdast-util-from-markdown'
 * @import {
 *   ConstructName,
 *   Handle as ToMarkdownHandle,
 *   Options as ToMarkdownExtension,
 *   State
 * } from 'mdast-util-to-markdown'
 * @import {Point} from 'unist'
 * @import {Nodes, Paragraph} from 'mdast'
 */

import {ccount} from 'ccount'
import {ok as assert} from 'devlop'
import {parseEntities} from 'parse-entities'
import {stringifyEntitiesLight} from 'stringify-entities'
import {visitParents} from 'unist-util-visit-parents'

const own = {}.hasOwnProperty

/** @type {Readonly<ToMarkdownOptions>} */
const emptyOptions = {}

const shortcut = /^[^\t\n\r "#'.<=>`}]+$/
const unquoted = /^[^\t\n\r "'<=>`}]+$/

/**
 * Create an extension for `mdast-util-from-markdown` to enable directives in
 * markdown.
 *
 * @returns {FromMarkdownExtension}
 *   Extension for `mdast-util-from-markdown` to enable directives.
 */
export function directiveFromMarkdown() {
  return {
    canContainEols: ['textDirective'],
    enter: {
      directiveContainer: enterContainer,
      directiveContainerAttributeExpression: enterAttributeExpression,
      directiveContainerAttributeValueExpression: enterAttributeValueExpression,
      directiveContainerAttributes: enterAttributes,
      directiveContainerLabel: enterContainerLabel,

      directiveLeaf: enterLeaf,
      directiveLeafAttributeExpression: enterAttributeExpression,
      directiveLeafAttributeValueExpression: enterAttributeValueExpression,
      directiveLeafAttributes: enterAttributes,

      directiveText: enterText,
      directiveTextAttributeExpression: enterAttributeExpression,
      directiveTextAttributeValueExpression: enterAttributeValueExpression,
      directiveTextAttributes: enterAttributes,
    },
    exit: {
      directiveContainer: exit,
      directiveContainerAttributeClassValue: exitAttributeClassValue,
      directiveContainerAttributeIdValue: exitAttributeIdValue,
      directiveContainerAttributeName: exitAttributeName,
      directiveContainerAttributeExpression: exitAttributeExpression,
      directiveContainerAttributeExpressionValue: data,
      directiveContainerAttributeValueExpression: exitAttributeValueExpression,
      directiveContainerAttributeValueExpressionValue: data,
      directiveContainerAttributeValue: exitAttributeValue,
      directiveContainerAttributes: exitAttributes,
      directiveContainerLabel: exitContainerLabel,
      directiveContainerName: exitName,

      directiveLeaf: exit,
      directiveLeafAttributeClassValue: exitAttributeClassValue,
      directiveLeafAttributeIdValue: exitAttributeIdValue,
      directiveLeafAttributeName: exitAttributeName,
      directiveLeafAttributeExpression: exitAttributeExpression,
      directiveLeafAttributeExpressionValue: data,
      directiveLeafAttributeValueExpression: exitAttributeValueExpression,
      directiveLeafAttributeValueExpressionValue: data,
      directiveLeafAttributeValue: exitAttributeValue,
      directiveLeafAttributes: exitAttributes,
      directiveLeafName: exitName,

      directiveText: exit,
      directiveTextAttributeClassValue: exitAttributeClassValue,
      directiveTextAttributeIdValue: exitAttributeIdValue,
      directiveTextAttributeName: exitAttributeName,
      directiveTextAttributeExpression: exitAttributeExpression,
      directiveTextAttributeExpressionValue: data,
      directiveTextAttributeValueExpression: exitAttributeValueExpression,
      directiveTextAttributeValueExpressionValue: data,
      directiveTextAttributeValue: exitAttributeValue,
      directiveTextAttributes: exitAttributes,
      directiveTextName: exitName,
    },
  }
}

/**
 * Create an extension for `mdast-util-to-markdown` to enable directives in
 * markdown.
 *
 * @param {Readonly<ToMarkdownOptions> | null | undefined} [options]
 *   Configuration (optional).
 * @returns {ToMarkdownExtension}
 *   Extension for `mdast-util-to-markdown` to enable directives.
 */
export function directiveToMarkdown(options) {
  const settings = options || emptyOptions

  if (
    settings.quote !== '"' &&
    settings.quote !== "'" &&
    settings.quote !== null &&
    settings.quote !== undefined
  ) {
    throw new Error(
      `Invalid quote \`${settings.quote}\`, expected \`'\` or \`"\``,
    )
  }

  handleDirective.peek = peekDirective

  return {
    handlers: {
      containerDirective: handleDirective,
      leafDirective: handleDirective,
      textDirective: handleDirective,
    },
    unsafe: [
      {
        character: '\r',
        inConstruct: ['leafDirectiveLabel', 'containerDirectiveLabel'],
      },
      {
        character: '\n',
        inConstruct: ['leafDirectiveLabel', 'containerDirectiveLabel'],
      },
      {
        before: '[^:]',
        character: ':',
        after: '[A-Za-z]',
        inConstruct: ['phrasing'],
      },
      {atBreak: true, character: ':', after: ':'},
    ],
  }

  /**
   * @type {ToMarkdownHandle}
   * @param {Directives} node
   */
  function handleDirective(node, _, state, info) {
    const tracker = state.createTracker(info)
    const sequence = fence(node)
    const exit = state.enter(node.type)
    let value = tracker.move(sequence + (node.name || ''))
    /** @type {LeafDirective | Paragraph | TextDirective | undefined} */
    let label

    if (node.type === 'containerDirective') {
      const head = (node.children || [])[0]
      label = inlineDirectiveLabel(head) ? head : undefined
    } else {
      label = node
    }

    if (label?.children && label.children.length > 0) {
      const exit = state.enter('label')
      /** @type {ConstructName} */
      const labelType = `${node.type}Label`
      const subexit = state.enter(labelType)
      value += tracker.move('[')
      value += tracker.move(
        state.containerPhrasing(label, {
          ...tracker.current(),
          before: value,
          after: ']',
        }),
      )
      value += tracker.move(']')
      subexit()
      exit()
    }

    value += tracker.move(attributes(node, state))

    if (node.type === 'containerDirective') {
      const head = (node.children || [])[0]
      let shallow = node

      if (inlineDirectiveLabel(head)) {
        shallow = Object.assign({}, node, {children: node.children.slice(1)})
      }

      if (shallow?.children && shallow.children.length > 0) {
        value += tracker.move('\n')
        value += tracker.move(state.containerFlow(shallow, tracker.current()))
      }

      value += tracker.move(`\n${sequence}`)
    }

    exit()
    return value
  }

  /**
   * @param {Directives} node
   * @param {State} state
   * @returns {string}
   */
  function attributes(node, state) {
    if (node.directiveAttributes) {
      const serialized = node.directiveAttributes.map((attribute) => {
        if (attribute.type === 'mdxJsxExpressionAttribute') {
          return `{${attribute.value}}`
        }
        if (attribute.value === null) return attribute.name
        if (typeof attribute.value === 'string') {
          return quoted(attribute.name, attribute.value, node, state)
        }
        return `${attribute.name}={${attribute.value.value}}`
      })
      return serialized.length === 0 ? '' : `{${serialized.join(' ')}}`
    }
    const attributes = node.attributes || {}
    /** @type {Array<string>} */
    const values = []
    /** @type {string | undefined} */
    let classesFull
    /** @type {string | undefined} */
    let classes
    /** @type {string | undefined} */
    let id
    /** @type {string} */
    let key

    for (key in attributes) {
      if (
        own.call(attributes, key) &&
        attributes[key] !== undefined &&
        attributes[key] !== null
      ) {
        const value = String(attributes[key])

        // To do: next major:
        // Do not reorder `id` and `class` attributes when they do not turn into
        // shortcuts.
        // Additionally, join shortcuts: `#a .b.c d="e"` -> `#a.b.c d="e"`
        if (key === 'id') {
          id =
            settings.preferShortcut !== false && shortcut.test(value)
              ? `#${value}`
              : quoted('id', value, node, state)
        } else if (key === 'class') {
          const list = value.split(/[\t\n\r ]+/g)
          /** @type {Array<string>} */
          const classesFullList = []
          /** @type {Array<string>} */
          const classesList = []
          let index = -1

          while (++index < list.length) {
            ;(settings.preferShortcut !== false && shortcut.test(list[index])
              ? classesList
              : classesFullList
            ).push(list[index])
          }

          classesFull =
            classesFullList.length > 0
              ? quoted('class', classesFullList.join(' '), node, state)
              : ''
          classes = classesList.length > 0 ? `.${classesList.join('.')}` : ''
        } else {
          values.push(quoted(key, value, node, state))
        }
      }
    }

    if (classesFull) {
      values.unshift(classesFull)
    }

    if (classes) {
      values.unshift(classes)
    }

    if (id) {
      values.unshift(id)
    }

    return values.length > 0 ? `{${values.join(' ')}}` : ''
  }

  /**
   * @param {string} key
   * @param {string} value
   * @param {Directives} node
   * @param {State} state
   * @returns {string}
   */
  function quoted(key, value, node, state) {
    if (settings.collapseEmptyAttributes !== false && !value) return key

    if (settings.preferUnquoted && unquoted.test(value)) {
      return `${key}=${value}`
    }

    // If the alternative is less common than `quote`, switch.
    const preferred = settings.quote || state.options.quote || '"'
    const alternative = preferred === '"' ? "'" : '"'
    // If the alternative is less common than `quote`, switch.
    const appliedQuote =
      settings.quoteSmart &&
      ccount(value, preferred) > ccount(value, alternative)
        ? alternative
        : preferred
    const subset =
      node.type === 'textDirective'
        ? [appliedQuote]
        : [appliedQuote, '\n', '\r']

    return (
      key +
      '=' +
      appliedQuote +
      stringifyEntitiesLight(value, {subset}) +
      appliedQuote
    )
  }
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterContainer(token) {
  enter.call(this, 'containerDirective', token)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterLeaf(token) {
  enter.call(this, 'leafDirective', token)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterText(token) {
  enter.call(this, 'textDirective', token)
}

/**
 * @this {CompileContext}
 * @param {Directives['type']} type
 * @param {Token} token
 */
function enter(type, token) {
  this.enter({type, name: '', attributes: {}, children: []}, token)
}

/**
 * @this {CompileContext}
 * @param {Token} token
 */
function exitName(token) {
  const node = this.stack[this.stack.length - 1]
  assert(
    node.type === 'containerDirective' ||
      node.type === 'leafDirective' ||
      node.type === 'textDirective',
  )
  node.name = this.sliceSerialize(token)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterContainerLabel(token) {
  this.enter(
    {type: 'paragraph', data: {directiveLabel: true}, children: []},
    token,
  )
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitContainerLabel(token) {
  this.exit(token)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterAttributes() {
  this.data.directiveAttributes = []
  this.data.markscriptDirectiveAttributes = []
  this.buffer() // Capture EOLs
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterAttributeExpression(token) {
  const list = this.data.markscriptDirectiveAttributes
  assert(list, 'expected `markscriptDirectiveAttributes`')
  list.push({
    type: 'mdxJsxExpressionAttribute',
    value: '',
    position: {start: point(token.start), end: point(token.end)},
  })
  this.buffer()
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitAttributeExpression(token) {
  const list = this.data.markscriptDirectiveAttributes
  assert(list, 'expected `markscriptDirectiveAttributes`')
  const attribute = list[list.length - 1]
  assert(attribute && attribute.type === 'mdxJsxExpressionAttribute')
  attribute.value = this.resume()
  assert(attribute.position, 'expected attribute position')
  attribute.position.end = point(token.end)
  if ('estree' in token && token.estree) attribute.data = {estree: token.estree}
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterAttributeValueExpression() {
  this.buffer()
}

/**
 * Forward expression chunks to the active mdast text buffer.
 *
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function data(token) {
  this.config.enter.data.call(this, token)
  this.config.exit.data.call(this, token)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitAttributeValueExpression(token) {
  const tuples = this.data.directiveAttributes
  const list = this.data.markscriptDirectiveAttributes
  assert(tuples, 'expected `directiveAttributes`')
  assert(list, 'expected `markscriptDirectiveAttributes`')
  const tuple = tuples[tuples.length - 1]
  const attribute = list[list.length - 1]
  assert(tuple, 'expected directive attribute tuple')
  assert(attribute && attribute.type === 'mdxJsxAttribute')
  tuple[2] = true
  /** @type {DirectiveExpression} */
  const value = {
    type: 'mdxJsxAttributeValueExpression',
    value: this.resume(),
  }
  if ('estree' in token && token.estree) value.data = {estree: token.estree}
  attribute.value = value
  assert(attribute.position, 'expected attribute position')
  attribute.position.end = point(token.end)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitAttributeIdValue(token) {
  const list = this.data.directiveAttributes
  assert(list, 'expected `directiveAttributes`')
  list.push([
    'id',
    parseEntities(this.sliceSerialize(token), {attribute: true}),
  ])
  const attributes = this.data.markscriptDirectiveAttributes
  assert(attributes, 'expected `markscriptDirectiveAttributes`')
  attributes.push({
    type: 'mdxJsxAttribute',
    name: 'id',
    value: parseEntities(this.sliceSerialize(token), {attribute: true}),
    position: {start: point(token.start), end: point(token.end)},
  })
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitAttributeClassValue(token) {
  const value = parseEntities(this.sliceSerialize(token), {attribute: true})
  const list = this.data.directiveAttributes
  assert(list, 'expected `directiveAttributes`')
  list.push(['class', value])
  const attributes = this.data.markscriptDirectiveAttributes
  assert(attributes, 'expected `markscriptDirectiveAttributes`')
  const previous = attributes[attributes.length - 1]
  if (
    previous &&
    previous.type === 'mdxJsxAttribute' &&
    previous.name === 'class' &&
    typeof previous.value === 'string'
  ) {
    previous.value += ` ${value}`
    assert(previous.position)
    previous.position.end = point(token.end)
  } else {
    attributes.push({
      type: 'mdxJsxAttribute',
      name: 'class',
      value,
      position: {start: point(token.start), end: point(token.end)},
    })
  }
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitAttributeValue(token) {
  const list = this.data.directiveAttributes
  assert(list, 'expected `directiveAttributes`')
  list[list.length - 1][1] = parseEntities(this.sliceSerialize(token), {
    attribute: true,
  })
  const attributes = this.data.markscriptDirectiveAttributes
  assert(attributes, 'expected `markscriptDirectiveAttributes`')
  const attribute = attributes[attributes.length - 1]
  assert(attribute && attribute.type === 'mdxJsxAttribute')
  attribute.value = list[list.length - 1][1]
  assert(attribute.position, 'expected attribute position')
  attribute.position.end = point(token.end)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitAttributeName(token) {
  const list = this.data.directiveAttributes
  assert(list, 'expected `directiveAttributes`')

  // Attribute names in CommonMark are significantly limited, so character
  // references can’t exist.
  list.push([this.sliceSerialize(token), ''])
  const attributes = this.data.markscriptDirectiveAttributes
  assert(attributes, 'expected `markscriptDirectiveAttributes`')
  attributes.push({
    type: 'mdxJsxAttribute',
    name: this.sliceSerialize(token),
    value: null,
    position: {start: point(token.start), end: point(token.end)},
  })
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitAttributes() {
  const list = this.data.directiveAttributes
  const attributeNodes = this.data.markscriptDirectiveAttributes
  assert(list, 'expected `directiveAttributes`')
  assert(attributeNodes, 'expected `markscriptDirectiveAttributes`')
  /** @type {Record<string, string>} */
  const cleaned = {}
  let index = -1

  while (++index < list.length) {
    const attribute = list[index]

    if (attribute[0] === 'class' && cleaned.class) {
      cleaned.class += ` ${attribute[1]}`
    } else {
      if (!attribute[2]) cleaned[attribute[0]] = attribute[1]
    }
  }

  this.data.directiveAttributes = undefined
  this.data.markscriptDirectiveAttributes = undefined
  this.resume() // Drop EOLs
  const node = this.stack[this.stack.length - 1]
  assert(
    node.type === 'containerDirective' ||
      node.type === 'leafDirective' ||
      node.type === 'textDirective',
  )
  node.attributes = cleaned
  node.directiveAttributes = attributeNodes
}

/** @param {Point} value */
function point(value) {
  return {line: value.line, column: value.column, offset: value.offset}
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exit(token) {
  this.exit(token)
}

/** @type {ToMarkdownHandle} */
function peekDirective() {
  return ':'
}

/**
 * @param {Nodes} node
 * @returns {node is Paragraph & {data: {directiveLabel: true}}}
 */
function inlineDirectiveLabel(node) {
  return Boolean(node && node.type === 'paragraph' && node.data?.directiveLabel)
}

/**
 * @param {Directives} node
 * @returns {string}
 */
function fence(node) {
  let size = 0

  if (node.type === 'containerDirective') {
    visitParents(node, (node, parents) => {
      if (node.type === 'containerDirective') {
        let index = parents.length
        let nesting = 0

        while (index--) {
          if (parents[index].type === 'containerDirective') {
            nesting++
          }
        }

        if (nesting > size) size = nesting
      }
    })
    size += 3
  } else if (node.type === 'leafDirective') {
    size = 2
  } else {
    size = 1
  }

  return ':'.repeat(size)
}
