import {describe, expect, test} from 'bun:test'
import {TextDocument} from 'vscode-languageserver-textdocument'
import {MarkscriptSyntaxService} from '../src/markscript-syntax.ts'

describe('MarkScript syntax service', () => {
  test('completes intrinsic tags and attributes', () => {
    const tags = document('<h')
    const tagCompletion = new MarkscriptSyntaxService(
      tags,
      '/report.ms',
    ).completion(tags.positionAt(tags.getText().length))
    expect(tagCompletion?.items.map((item) => item.label)).toContain('h1')

    const attributes = document('<img s')
    const attributeCompletion = new MarkscriptSyntaxService(
      attributes,
      '/report.ms',
    ).completion(attributes.positionAt(attributes.getText().length))
    expect(attributeCompletion?.items.map((item) => item.label)).toContain(
      'src',
    )
  })

  test('describes MarkScript intrinsic tags', () => {
    const source = document('<strong>body</strong>')
    const hover = new MarkscriptSyntaxService(source, '/report.ms').hover({
      line: 0,
      character: 2,
    })
    expect(hover?.contents).toMatchObject({
      value: expect.stringContaining('Strong Markdown phrasing'),
    })
  })
})

function document(source: string): TextDocument {
  return TextDocument.create('file:///report.ms', 'markscript', 1, source)
}
