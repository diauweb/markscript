import {expect, test} from 'bun:test'
import {getManual} from '@markscript/manuals'
import type {Root} from 'mdast'
import {formatDocument, formatManualReference} from '../src/document-output.ts'

test('manual help preserves Markdown for pipes and renders any catalog page for terminals', () => {
  const manual = getManual('TUT1001')
  expect(manual).toBeDefined()
  if (manual === undefined) return

  const markdown = '<!-- generated -->\n\n# Getting started\n'
  const piped = formatManualReference(manual, markdown, {
    terminal: false,
  })
  expect(piped.startsWith(markdown)).toBe(true)
  expect(piped).not.toContain('\u001B[')

  const terminal = formatManualReference(manual, markdown, {
    terminal: true,
    color: true,
    width: 60,
  })
  expect(terminal).toContain('\u001B[')
  expect(Bun.stripANSI(terminal)).toContain(manual.title)
  expect(terminal).toContain(manual.documentationUrl)
})

test('Markdown output covers the standard extended MDAST families', () => {
  const root: Root = {
    type: 'root',
    children: [
      {type: 'yaml', value: 'title: Complete'},
      {
        type: 'paragraph',
        children: [
          {
            type: 'delete',
            children: [{type: 'text', value: 'obsolete'}],
          },
          {type: 'text', value: ' '},
          {type: 'footnoteReference', identifier: 'detail', label: 'detail'},
        ],
      },
      {
        type: 'table',
        align: [null, 'right'],
        children: [
          {
            type: 'tableRow',
            children: [
              {
                type: 'tableCell',
                children: [{type: 'text', value: 'Name'}],
              },
              {
                type: 'tableCell',
                children: [{type: 'text', value: 'Count'}],
              },
            ],
          },
          {
            type: 'tableRow',
            children: [
              {
                type: 'tableCell',
                children: [{type: 'text', value: 'Items'}],
              },
              {
                type: 'tableCell',
                children: [{type: 'text', value: '2'}],
              },
            ],
          },
        ],
      },
      {
        type: 'footnoteDefinition',
        identifier: 'detail',
        label: 'detail',
        children: [
          {
            type: 'paragraph',
            children: [{type: 'text', value: 'Final lifecycle state.'}],
          },
        ],
      },
    ],
  }

  const markdown = formatDocument(root, 'markdown')
  expect(markdown).toContain('title: Complete')
  expect(markdown).toContain('~~obsolete~~ [^detail]')
  expect(markdown).toContain('| Name')
  expect(markdown).toContain('[^detail]: Final lifecycle state.')
})
