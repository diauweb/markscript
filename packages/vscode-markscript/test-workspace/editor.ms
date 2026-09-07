import {Card} from './component.tsx'
import {greet} from './utility.ts'
import documentEntry, {libraryValue} from './library.ms'

export const extensionHostValue: string = 'ready'

# Editor

<Card title={greet('MarkScript')} count={libraryValue} />

{extensionHostValue}

{documentEntry}
