import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {chromium, expect} from 'playwright/test'
import {defaultContext} from '../src/presets.ts'
import {Shell} from '../src/shell.ts'
import type {Completion} from '../src/types.ts'
import {createWebServer} from '../src/webui.ts'
import {renderingSource} from './rendering-fixture.ts'

const directory = await mkdtemp(
  path.join(process.cwd(), '.markscript-v1-browser-'),
)
const policy = path.join(directory, 'approval.ms')
await writeFile(
  policy,
  `export async function beforeAction(action: any, services: any) {
  if (action.kind !== 'tool') {services.approve('Browser fixture preparation'); return}
  const accepted = await services.ask('Review fixture action.', {
    title:'Browser approval', body:{type:'root',children:[{type:'paragraph',children:[{type:'strong',children:[{type:'text',value:'Policy document'}]}]}]},
    choices:[{label:'Deny fixture',value:'deny'},{label:'Approve fixture',value:'approve'}]
  })
  if (!accepted) services.deny('Declined fixture')
  services.approve('Accepted fixture')
}`,
)
const answer = (content: string): Completion => ({
  message: {
    role: 'assistant',
    content,
    reasoning_content: 'Browser reasoning.',
  },
  finishReason: 'stop',
})
const host = new Shell({
  cwd: directory,
  context: defaultContext(),
  approval: {policy},
  provider: {
    identity: {model: 'browser-fixture'},
    async complete(request, signal, emit) {
      const last = request.messages.at(-1)
      if (last?.role === 'user' && last.content === 'render markscript') {
        const source = renderingSource(path.join(directory, 'rendered-once'))
        emit(source)
        await new Promise((resolve) => setTimeout(resolve, 100))
        return answer(source)
      }
      if (last?.role === 'user' && last.content?.includes('approval'))
        return {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'browser-call',
                type: 'function',
                function: {name: 'inspect', arguments: '{}'},
              },
            ],
          },
          finishReason: 'tool_calls',
        }
      if (last?.role === 'user' && last.content?.includes('wait for stop')) {
        emit('Waiting for interruption…')
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          })
        })
      }
      emit('Hello **browser**.')
      await new Promise((resolve) => setTimeout(resolve, 40))
      return answer(
        '## Browser reply\n\nHello **browser**.\n\n```ts\nconst value = 42\n```',
      )
    },
  },
})
const ui = await createWebServer(host)
await host.initialize()
const browser = await chromium.launch({
  executablePath:
    process.env.MSH_BROWSER ??
    Bun.which('chromium') ??
    chromium.executablePath(),
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage({viewport: {width: 1440, height: 1000}})
const errors: string[] = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(ui.url)
  await expect(page.getByText('Local session', {exact: true})).toBeVisible({
    timeout: 20000,
  })
  const composer = page.getByRole('textbox', {name: 'Message', exact: true})
  await composer.fill(
    '## Thread input\n\nLiteral **input** <script>window.BAD=true</script>',
  )
  await composer.press('Shift+Enter')
  await composer.press('Control+j')
  await expect(composer).toHaveValue(
    '## Thread input\n\nLiteral **input** <script>window.BAD=true</script>\n\n',
  )
  await composer.press('Enter')
  await expect(page.getByRole('heading', {name: 'Browser reply'})).toBeVisible()
  await expect(
    page.getByRole('button', {name: 'You', exact: true}),
  ).toHaveCount(0)
  await page.setViewportSize({width: 884, height: 871})
  const spacing = await page.locator('.message').evaluateAll((messages) =>
    messages.map((message, index) => {
      const heading = message.querySelector('.message-heading')
      const body = message.querySelector(':scope > .prose, :scope > .literal')
      const previous = messages[index - 1]
      return {
        gap: previous
          ? message.getBoundingClientRect().top -
            previous.getBoundingClientRect().bottom
          : undefined,
        bodyGap:
          heading && body
            ? body.getBoundingClientRect().top -
              heading.getBoundingClientRect().bottom
            : undefined,
      }
    }),
  )
  for (const row of spacing) {
    if (row.gap !== undefined) assert.equal(row.gap, 24)
    if (row.bodyGap !== undefined) assert.equal(row.bodyGap, 8)
  }
  await page.screenshot({path: '/tmp/msh-webui-spacing.png'})
  await page.setViewportSize({width: 1440, height: 1000})
  await composer.fill('render markscript')
  await composer.press('Enter')
  const computed = page
    .locator('.message')
    .filter({has: page.getByRole('button', {name: 'Assistant', exact: true})})
    .getByRole('heading', {name: 'Computed 42', exact: true})
  await expect(computed).toBeVisible({timeout: 60000})
  const rendered = computed.locator('..')
  await expect(rendered.locator('blockquote')).toContainText(
    'Component value 42',
  )
  await expect(rendered.locator('table')).toContainText('Computed')
  await expect(rendered.getByRole('checkbox', {checked: true})).toHaveCount(1)
  await expect(rendered).toContainText('Transformed document')
  const feedback = page
    .locator('.message')
    .filter({
      has: page.getByRole('button', {name: 'Runtime feedback', exact: true}),
    })
    .first()
  await expect(
    feedback.getByRole('heading', {name: 'Exported abilities'}),
  ).toBeVisible()
  await expect(feedback.locator('.prose')).not.toContainText('"parameters"')
  await expect(rendered).not.toContainText('export const')
  const footnote = rendered.locator('a[data-footnote-ref]')
  const target = await footnote.getAttribute('href')
  assert(target)
  assert(
    await page.evaluate(
      (href) => !!globalThis.document.getElementById(href.slice(1)),
      target,
    ),
  )
  assert.equal(
    await readFile(path.join(directory, 'rendered-once'), 'utf8'),
    'component;ready;',
  )
  const input = page
    .locator('.message')
    .filter({
      has: page.locator('.message-heading').getByText('You', {exact: true}),
    })
    .first()
  await expect(input.getByRole('heading', {name: 'Thread input'})).toBeVisible()
  await expect(input.locator('strong').last()).toHaveText('input')
  await expect(input.locator('code')).toContainText(
    '<script>window.BAD=true</script>',
  )
  assert.equal(
    await page.evaluate(() => (window as unknown as {BAD?: boolean}).BAD),
    undefined,
  )
  await expect(
    page
      .getByRole('heading', {name: 'Browser reply'})
      .first()
      .locator('..')
      .locator('strong'),
  ).toHaveText('browser')
  await page
    .getByRole('button', {name: 'Reasoning', exact: true})
    .first()
    .click()
  await expect(
    page.getByText('Browser reasoning.', {exact: true}),
  ).toBeVisible()
  await composer.fill('Main draft')
  await page.getByRole('button', {name: 'New thread', exact: true}).click()
  await expect(
    page.getByRole('heading', {name: 'Thread 1', exact: true}),
  ).toBeVisible()
  await composer.fill('Child draft')
  await page.getByRole('button', {name: /^Main Ready/}).click()
  await expect(composer).toHaveValue('Main draft')
  await expect(
    page.getByText('Browser reasoning.', {exact: true}),
  ).toBeVisible()
  await page.getByRole('button', {name: /^Thread 1 Ready/}).click()
  await expect(composer).toHaveValue('Child draft')
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('textbox', {name: 'Filter commands'}).fill('Context')
  await page.getByRole('button', {name: /^Context Instructions/}).click()
  await expect(
    page.getByRole('complementary', {name: 'Context', exact: true}),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', {name: 'Instructions', exact: true}),
  ).toBeVisible()
  await page.getByRole('button', {name: 'Close inspector', exact: true}).click()
  await page.keyboard.press('F1')
  await expect(
    page.getByRole('complementary', {name: 'Keyboard & help'}),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('complementary', {name: 'Keyboard & help'}),
  ).toHaveCount(0)
  await composer.fill('request approval')
  await composer.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(
    page.getByRole('heading', {name: 'Browser approval'}),
  ).toBeVisible()
  await expect(page.getByText('Policy document', {exact: true})).toBeVisible()
  await expect(
    page.getByRole('button', {name: 'Deny fixture', exact: true}),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByRole('button', {name: 'Review', exact: true}),
  ).toBeVisible()
  await page.getByRole('button', {name: 'Review', exact: true}).click()
  await expect(
    page.getByRole('button', {name: 'Deny fixture', exact: true}),
  ).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('button', {name: 'Approve fixture', exact: true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByRole('button', {name: 'inspect · Complete', exact: true}),
  ).toBeVisible()
  await composer.fill('/export conversation.md')
  await composer.press('Enter')
  await expect(
    page.getByRole('status').filter({hasText: 'Exported'}),
  ).toBeVisible()
  assert.match(
    await readFile(path.join(directory, 'conversation.md'), 'utf8'),
    /request approval/,
  )
  await composer.fill('wait for stop')
  await composer.press('Enter')
  await expect(page.getByRole('button', {name: 'Stop turn'})).toBeVisible()
  await composer.fill('queued input')
  await expect(
    page.getByRole('button', {name: 'Queue', exact: true}),
  ).toBeVisible()
  await page.getByRole('button', {name: 'Stop turn'}).click()
  await expect(page.getByRole('button', {name: 'Stop turn'})).toHaveCount(0)
  await page.getByRole('button', {name: 'Commands', exact: false}).click()
  await page.getByRole('textbox', {name: 'Filter commands'}).fill('Abilities')
  await expect(
    page.getByRole('button', {name: /^Abilities Native/}),
  ).toBeVisible()
  await page.getByRole('textbox', {name: 'Filter commands'}).press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(
    page.getByRole('button', {name: /^Abilities Native/}),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', {name: 'Fixed native tools'}),
  ).toBeVisible()
  await page.getByRole('button', {name: 'Close inspector'}).click()
  await composer.fill('')
  await page.screenshot({path: '/tmp/msh-webui-desktop.png', fullPage: true})
  await page.setViewportSize({width: 390, height: 844})
  await page.getByRole('button', {name: 'Toggle threads'}).click()
  await expect(composer).toBeVisible()
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  )
  await page.screenshot({path: '/tmp/msh-webui-mobile.png', fullPage: true})
  await page.reload()
  await expect(composer).toBeEnabled({timeout: 20000})
  await page.getByRole('button', {name: 'Toggle threads'}).click()
  await page.getByRole('button', {name: /^Thread 1 Ready/}).click()
  await expect(
    page.getByRole('button', {name: 'inspect · Complete', exact: true}),
  ).toBeVisible()
  assert.deepEqual(errors, [])
  console.log(
    'Browser checks passed: document inputs, runtime feedback, finalized MarkScript, multiline composer, drafts, disclosure state, keyboard commands, inspectors, approvals, export, interruption, responsive layout, and reconnection.',
  )
} catch (error) {
  await page.screenshot({path: '/tmp/msh-webui-failure.png', fullPage: true})
  console.error('Browser page errors:', errors)
  throw error
} finally {
  await browser.close()
  await host.close()
  ui.close()
  await rm(directory, {recursive: true, force: true})
}
