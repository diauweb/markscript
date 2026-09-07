import {onTransform} from '@markscript/runtime'
import {
  type CodeHighlightOptions,
  transformCodeHighlight,
} from './code-highlight.ts'
import {type EchartsTransformOptions, transformEcharts} from './echarts.ts'
import {type OoxmlTransformOptions, transformOoxml} from './ooxml.ts'
import {resolveDocx} from './resolve.ts'
import {type SatoriTransformOptions, transformSatori} from './satori.ts'
import type {DocxDocumentConfig} from './types.ts'

export interface HookDocxOptions extends DocxDocumentConfig {
  satori?: SatoriTransformOptions
  echarts?: EchartsTransformOptions
  ooxml?: OoxmlTransformOptions
  code?: CodeHighlightOptions
}

/** Registers the package's one whole-document transform during rendering. */
export function hookDocx(options: HookDocxOptions = {}): void {
  onTransform(async ({root}) => {
    await transformSatori(root, options.satori)
    await transformEcharts(root, options.echarts)
    await transformOoxml(root, options.ooxml)
    await transformCodeHighlight(root, options.code)
    await resolveDocx(root, options)
  })
}
