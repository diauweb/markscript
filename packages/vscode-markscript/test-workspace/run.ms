import {writeFile} from 'node:fs/promises'
import {onReady} from '@markscript/runtime'

# Run

{
  onReady(async () => {
    const marker = process.env.MARKSCRIPT_EXTENSION_TEST_MARKER
    if (!marker) throw new Error('Missing extension-test marker')
    await writeFile(marker, 'ran', 'utf8')
  })
}
