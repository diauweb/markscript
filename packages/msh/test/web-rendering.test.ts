import {expect, test} from 'bun:test'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import type {Root} from 'mdast'
import {gfmToMarkdown} from 'mdast-util-gfm'
import {toMarkdown} from 'mdast-util-to-markdown'
import {renderToStaticMarkup} from 'react-dom/server'
import {inputDocument} from '../src/input-document.ts'
import {HistoryWriter, historyMessages, readHistory} from '../src/journal.ts'
import {SessionStore} from '../src/sessions.ts'
import {conversationCards} from '../src/web-content.ts'
import {
  createWebServer,
  type SavedConversation,
  type WebSnapshot,
} from '../src/webui.ts'
import {renderDocument} from '../web/src/document.tsx'
import {createHarness} from './harness.ts'
import {renderingSource} from './rendering-fixture.ts'

test('WebUI retains finalized MarkScript output and saved rendering without repeating execution', async () => {
  const cwd = await mkdtemp(
    path.join(process.cwd(), '.markscript-v1-rendering-'),
  )
  const marker = path.join(cwd, 'evaluations')
  const sessions = new SessionStore(path.join(cwd, 'sessions'))
  const session = await sessions.allocate({
    title: 'Rendered session',
    cwd,
    profile: 'fixture',
    model: 'fixture',
    contextBudget: 32000,
    maxOutputTokens: 4096,
    maxTurns: 4,
  })
  await sessions.save(session)
  const journal = sessions.journal(session.id)
  let calls = 0
  const source = renderingSource(marker)
  const inputMarker = path.join(cwd, 'input-executed')
  const input = `## Thread input\n\n:::notice{tone="info"}\n**Formatted input**\n:::\n\n<p>Static <em>JSX</em>.</p>\n\n{await Bun.write(${JSON.stringify(inputMarker)}, 'bad')}`
  const policy = path.join(cwd, 'policy.ms')
  await writeFile(
    policy,
    `export function beforeAction(_action: any, services: any) {services.approve('Authorized rendering fixture.')}`,
  )
  const host = await createHarness({
    cwd,
    approval: {policy},
    provider: {
      async complete() {
        return {
          message: {
            role: 'assistant',
            content: calls++ === 0 ? source : 'Finished.',
          },
          finishReason: 'stop',
        }
      },
    },
  })
  const writer = new HistoryWriter(journal, host)
  const ui = await createWebServer(host, {
    sessions,
    flush: () => writer.flush(),
  })
  try {
    await host.turn(input)
    const state = host.inspect(host.root, 0)
    const message = state.messages.find((m) =>
      m.content?.includes('export const answer'),
    )
    expect(message?.renderError).toBeUndefined()
    expect(message?.rendered).toBeDefined()
    const root = message?.rendered as Root
    expect(toMarkdown(root, {extensions: [gfmToMarkdown()]})).toContain(
      '## Computed 42',
    )
    const html = renderToStaticMarkup(renderDocument(root, 'test-'))
    expect(html).toContain('<h2>Computed 42</h2>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('Component value 42')
    expect(html).toContain('<strong>content</strong>')
    expect(html).toContain('<table>')
    expect(html).toContain('checked=""')
    expect(html).toContain('Final document footnote.')
    expect(html).toContain('Transformed document')
    expect(html).not.toContain('export const')
    expect(html).not.toContain(':::callout')
    const cards = conversationCards(state, '', {}, inputDocument)
    expect(cards.find((card) => card.rendered === root)?.details).toContain(
      source.trim(),
    )
    for (let i = 0; i < 2; i++) {
      const snapshot = (await (
        await fetch(new URL('/api/state', ui.url), {
          headers: {'x-msh-token': ui.token},
        })
      ).json()) as WebSnapshot
      expect(
        snapshot.threads[0]?.messages.find((m) => m.id === message?.id)
          ?.rendered,
      ).toEqual(root)
      const inputCard = snapshot.cards[host.root]?.find(
        (card) => card.title === 'You',
      )
      const inputHtml = renderToStaticMarkup(
        renderDocument(inputCard?.rendered as Root, 'input-'),
      )
      expect(inputHtml).toContain('<h2>Thread input</h2>')
      expect(inputHtml).toContain('<strong>Formatted input</strong>')
      expect(inputHtml).toContain('<em>JSX</em>')
      expect(inputCard?.rendered?.children[1]?.data?.notice).toEqual({
        tone: 'info',
      })
      expect(inputHtml).not.toContain(':::notice')
      const runtimeCard = snapshot.cards[host.root]?.find(
        (card) => card.title === 'Runtime feedback',
      )
      const runtimeHtml = renderToStaticMarkup(
        renderDocument(runtimeCard?.rendered as Root, 'runtime-'),
      )
      expect(runtimeHtml).toContain('<h3>Exported abilities</h3>')
      expect(runtimeHtml).toContain('<code>Summary</code>')
      expect(runtimeHtml).not.toContain('"parameters"')
    }
    await writer.flush()
    const saved = historyMessages(await readHistory(journal))
    expect(
      saved.find(({message: m}) => m.id === message?.id)?.message.rendered,
    ).toEqual(root)
    const restored = (await (
      await fetch(new URL(`/api/saved?id=${session.id}`, ui.url), {
        headers: {'x-msh-token': ui.token},
      })
    ).json()) as SavedConversation
    expect(
      restored.cards?.find((card) =>
        card.details?.includes('export const answer'),
      )?.rendered,
    ).toEqual(root)
    expect(await readFile(marker, 'utf8')).toBe('component;ready;')
    expect(await Bun.file(inputMarker).exists()).toBe(false)
    expect(state.messages[0]?.content).toBe(input)
    expect(
      restored.cards?.find((card) => card.title.endsWith(' · You'))?.rendered,
    ).toEqual(inputDocument(input))
    expect(calls).toBe(2)
  } finally {
    await host.close()
    await writer.close()
    ui.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 90000)

test('failed MarkScript displays a diagnostic and retains source for inspection', async () => {
  let calls = 0
  const source = '{Promise.reject(new Error("render failed"))}'
  const host = await createHarness({
    provider: {
      async complete() {
        return {
          message: {
            role: 'assistant',
            content: calls++ === 0 ? source : 'Recovered.',
          },
          finishReason: 'stop',
        }
      },
    },
  })
  try {
    await host.turn('Render')
    const cards = conversationCards(
      host.inspect(host.root, 0),
      '',
      {},
      inputDocument,
    )
    const failed = cards.find((card) => card.tone === 'error')
    expect(failed?.text).toContain('render failed')
    expect(failed?.rendered).toBeUndefined()
    expect(failed?.details).toContain(source.trim())
    expect(cards.some((card) => card.rendered?.children.length)).toBe(true)
  } finally {
    await host.close()
  }
}, 30000)

test('document renderer scopes footnotes and sanitizes browser markup while retaining ordinary nodes', () => {
  const root: Root = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'link',
            url: 'javascript:alert(1)',
            children: [{type: 'text', value: 'Unsafe link'}],
          },
          {type: 'image', url: 'javascript:alert(1)', alt: 'Unsafe image'},
          {type: 'footnoteReference', identifier: 'note'},
          {type: 'delete', children: [{type: 'text', value: 'Removed'}]},
        ],
      },
      {
        type: 'footnoteDefinition',
        identifier: 'note',
        children: [
          {
            type: 'paragraph',
            children: [{type: 'text', value: 'Footnote body'}],
          },
        ],
      },
      {type: 'html', value: '<script>alert(1)</script>'},
      {
        type: 'paragraph',
        data: {hName: 'script'},
        children: [{type: 'text', value: 'Dangerous override'}],
      },
      {
        type: 'paragraph',
        data: {hProperties: {onClick: 'alert(1)', id: 'anchor'}},
        children: [{type: 'text', value: 'Safe paragraph'}],
      },
      {
        type: 'paragraph',
        children: [
          {
            type: 'link',
            url: '#anchor',
            children: [{type: 'text', value: 'Jump'}],
          },
        ],
      },
      {
        type: 'custom',
        value: 'Unknown content',
      } as unknown as Root['children'][number],
    ],
  }
  const first = renderToStaticMarkup(renderDocument(root, 'first-'))
  const second = renderToStaticMarkup(renderDocument(root, 'second-'))
  expect(first).toContain('id="first-fn-note"')
  expect(first).toContain('href="#first-fn-note"')
  expect(first).toContain('href="#first-fnref-note"')
  expect(second).toContain('href="#second-fn-note"')
  expect(first).toContain('<del>Removed</del>')
  expect(first).toContain('id="first-anchor"')
  expect(first).toContain('href="#first-anchor"')
  expect(first).toContain('Safe paragraph')
  expect(first).not.toContain('javascript:')
  expect(first).not.toContain('<script')
  expect(first).not.toContain('onClick')
  expect(first).not.toContain('Dangerous override')
  expect(first).not.toContain('Unknown content')
})
