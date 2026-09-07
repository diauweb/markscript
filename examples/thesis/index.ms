import {Buffer} from 'node:buffer'
import {hookDocx, writeDocx} from '@markscript/docx'
import {onReady, onTransform} from '@markscript/markscript'
import {thesisReferences} from './references.ts'
import Backmatter from './sections/backmatter.ms'
import Body from './sections/body.ms'
import Frontmatter from './sections/frontmatter.ms'
import {
  finishThesisFormatting,
  prepareThesisFormatting,
  thesisDefaultSection,
  thesisDocument,
  thesisSections,
} from './theme.ts'
import {loadThesisFonts} from './visuals/shared.tsx'

export const thesisFonts = loadThesisFonts()

export const thesisOutput =
  process.env.MARKSCRIPT_THESIS_OUTPUT ?? 'examples/thesis/thesis.docx'

{
  onTransform(({root}) => {
    prepareThesisFormatting(root)
  })
}

{hookDocx({
  document: thesisDocument,
  sections: thesisSections,
  defaultSection: thesisDefaultSection,
  bibliography: thesisReferences,
  formatBibliographyEntry(record, number) {
    return `[${number}]${record.title}`
  },
  echarts: {fontFiles: thesisFonts.map((font) => font.sourcePath)},
  satori: {
    fonts: thesisFonts.map(({data, sourcePath: _sourcePath, ...font}) => ({
      ...font,
      data: Buffer.from(data),
    })),
  },
})}

{
  onTransform(({root}) => {
    finishThesisFormatting(root)
  })
}

<Frontmatter />

<Body />

<Backmatter />

{
  onReady(({root}) =>
    writeDocx(root, thesisOutput),
  )
}
