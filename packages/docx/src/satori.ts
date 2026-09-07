import type {Root} from 'mdast'
import satori, {type SatoriOptions} from 'satori'
import {createElement, Fragment} from 'satori/jsx'
import {fenceOptions, transformFences} from './fences.ts'
import {rasterizedSvgImage, svgImage} from './media.ts'

export type SatoriTransformOptions = Omit<
  SatoriOptions,
  'width' | 'height' | 'fonts'
> & {
  fonts?: SatoriOptions['fonts']
}

const transpiler = new Bun.Transpiler({
  loader: 'tsx',
  target: 'bun',
  tsconfig: {
    compilerOptions: {
      jsx: 'react',
      jsxFactory: 'createElement',
      jsxFragmentFactory: 'Fragment',
    },
  },
})

export async function transformSatori(
  root: Root,
  options: SatoriTransformOptions = {},
): Promise<void> {
  await transformFences(root, 'satori', async (node, parent, path) => {
    const sourcePath = withLocation(path, node)
    const attributes = fenceOptions(node)
    const width = dimension(attributes.width, 'width', sourcePath)
    const height = dimension(attributes.height, 'height', sourcePath)
    const alt = requiredText(attributes.alt, 'alt', sourcePath)
    const format = imageFormat(attributes.format, sourcePath)
    const pixelRatio = positiveNumber(
      attributes.pixelRatio ?? 1,
      'pixelRatio',
      sourcePath,
    )
    if (options.fonts === undefined || options.fonts.length === 0) {
      throw new TypeError(
        `${sourcePath}: satori fence requires at least one explicit font`,
      )
    }
    const element = evaluateSatoriJsx(node.value, sourcePath)
    const {fonts, ...satoriOptions} = options
    let svg: string
    try {
      svg = await satori(element as Parameters<typeof satori>[0], {
        ...satoriOptions,
        width,
        height,
        fonts,
      })
    } catch (error) {
      throw new Error(`${sourcePath}: failed to render satori fence`, {
        cause: error,
      })
    }
    return format === 'png'
      ? rasterizedSvgImage(parent, svg, {width, height, alt, pixelRatio})
      : svgImage(parent, svg, {width, height, alt})
  })
}

function evaluateSatoriJsx(source: string, path: string): unknown {
  let result: unknown
  try {
    const program = transpiler.transformSync(
      `const __value = (<>${source}</>); __capture(__value)`,
    )
    const execute = new Function(
      'createElement',
      'Fragment',
      '__capture',
      `"use strict";\n${program}`,
    )
    execute(createElement, Fragment, (value: unknown) => {
      result = value
    })
  } catch (error) {
    throw new Error(`${path}: failed to evaluate satori fence`, {
      cause: error,
    })
  }
  return result
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

function dimension(value: unknown, name: string, path: string): number {
  return positiveNumber(value, name, path)
}

function positiveNumber(value: unknown, name: string, path: string): number {
  const numeric =
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (
    typeof numeric !== 'number' ||
    !Number.isFinite(numeric) ||
    numeric <= 0
  ) {
    throw new TypeError(
      `${path}: satori fence ${name} must be a positive finite number`,
    )
  }
  return numeric
}

function imageFormat(value: unknown, path: string): 'svg' | 'png' {
  if (value === undefined || value === 'svg') return 'svg'
  if (value === 'png') return 'png'
  throw new TypeError(`${path}: satori fence format must be svg or png`)
}

function requiredText(value: unknown, name: string, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(
      `${path}: satori fence ${name} must be a non-empty string`,
    )
  }
  return value
}
