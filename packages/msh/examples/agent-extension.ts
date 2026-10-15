import {agent} from 'msh/agent'
import {demoProvider} from '../src/demo.ts'

export const extension = agent(() => ({provider: demoProvider()}))
