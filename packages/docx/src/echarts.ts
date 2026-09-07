import type {EChartsOption, SetOptionOpts} from 'echarts'
import type {Root} from 'mdast'
import {fenceOptions, transformFences} from './fences.ts'
import {renderSvgPng, svgImage} from './media.ts'
import {isRecord} from './tree.ts'

export interface EchartsTransformOptions {
  theme?: string | object
  setOption?: SetOptionOpts
  /** Explicit fonts used to rasterize the deterministic SVG fallback. */
  fontFiles?: readonly string[]
}

export async function transformEcharts(
  root: Root,
  options: EchartsTransformOptions = {},
): Promise<void> {
  let echarts: typeof import('echarts') | undefined
  await transformFences(root, 'echarts', async (node, parent, path) => {
    const sourcePath = withLocation(path, node)
    const attributes = fenceOptions(node)
    const width = dimension(attributes.width, 'width', sourcePath)
    const height = dimension(attributes.height, 'height', sourcePath)
    const alt = requiredText(attributes.alt, 'alt', sourcePath)
    const chartOptions =
      attributes.option ?? parseChartOptions(node.value, sourcePath)
    if (!isRecord(chartOptions)) {
      throw new TypeError(`${sourcePath}: echarts options must be an object`)
    }
    let chart: ReturnType<typeof import('echarts')['init']> | undefined
    try {
      echarts ??= await import('echarts')
      const requestedTheme = attributes.theme ?? options.theme
      if (
        requestedTheme !== undefined &&
        typeof requestedTheme !== 'string' &&
        typeof requestedTheme !== 'object'
      ) {
        throw new TypeError('theme must be a string or theme object')
      }
      chart = echarts.init(null, requestedTheme, {
        renderer: 'svg',
        ssr: true,
        width,
        height,
      })
      chart.setOption(chartOptions as EChartsOption, options.setOption)
      const svg = sanitizeSvg(chart.renderToSVGString())
      return svgImage(parent, svg, {
        width,
        height,
        alt,
        ...(options.fontFiles === undefined
          ? {}
          : {fallback: renderSvgPng(svg, {fontFiles: options.fontFiles})}),
      })
    } catch (error) {
      throw new Error(`${sourcePath}: failed to render echarts fence`, {
        cause: error,
      })
    } finally {
      chart?.dispose()
    }
  })
}

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<style\b[\s\S]*?<\/style>/gu, '')
    .replace(/\sclass="[^"]*"/gu, '')
    .replace(/\secmeta_[a-z_]+="[^"]*"/gu, '')
    .replace(/\spointer-events="[^"]*"/gu, '')
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
  const numeric =
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (
    typeof numeric !== 'number' ||
    !Number.isFinite(numeric) ||
    numeric <= 0
  ) {
    throw new TypeError(
      `${path}: echarts fence ${name} must be a positive finite number`,
    )
  }
  return numeric
}

function requiredText(value: unknown, name: string, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(
      `${path}: echarts fence ${name} must be a non-empty string`,
    )
  }
  return value
}

function parseChartOptions(value: string, path: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch (error) {
    throw new SyntaxError(`${path}: echarts fence must contain JSON`, {
      cause: error,
    })
  }
}
