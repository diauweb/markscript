#!/usr/bin/env bun

import {mkdir} from 'node:fs/promises'
import path from 'node:path'
import {
  bundleFile,
  type CompilerOptions,
  checkFile,
  type Diagnostic,
  formatDiagnostic,
  formatMarkscript,
  hasErrors,
  MarkScriptCompilationError,
  type RunOptions,
  runFile,
} from '@markscript/compiler'
import {
  type DiagnosticManualPage,
  getManual,
  lookupManual,
  type ManualDocument,
  type ManualLookupResult,
} from '@markscript/manuals'
import {
  type ArgsDef,
  type CommandDef,
  defineCommand,
  runCommand,
  showUsage,
} from 'citty'
import {
  formatDocument,
  formatManualReference,
  parseDocumentOutputFormat,
} from './document-output.ts'

let commandExitCode = 0
let programmaticRun = false
const VERSION = '0.1.0'

const fileArgument = {
  type: 'positional',
  description: 'MarkScript source file',
  valueHint: 'file.ms',
  required: true,
} as const

const projectArgument = {
  type: 'string',
  alias: 'p',
  description: 'Use this tsconfig.json',
  valueHint: 'tsconfig.json',
} as const

const transpileOnlyArgument = {
  type: 'boolean',
  description: 'Skip semantic TypeScript checking',
  default: false,
} as const

export const checkCommand = defineCommand({
  meta: {
    name: 'check',
    description:
      'Parse and type-check a MarkScript module without executing it',
  },
  args: {
    file: fileArgument,
    project: projectArgument,
  },
  setup({rawArgs, args}) {
    validateParsedArguments(rawArgs, args._, ['project'], ['p'])
  },
  async run({args}) {
    assertMarkscriptFile(args.file)
    const diagnostics = await checkFile(
      args.file,
      compilerOptions(args.project),
    )
    printDiagnostics(diagnostics)
    if (hasErrors(diagnostics)) markCommandFailed()
  },
})

export const compileCommand = defineCommand({
  meta: {
    name: 'compile',
    description:
      'Compile a MarkScript module to callable ESM without executing it',
  },
  args: {
    file: fileArgument,
    output: {
      type: 'string',
      alias: 'o',
      description: 'Output ESM file',
      valueHint: 'file.mjs',
    },
    project: projectArgument,
    'source-map': {
      type: 'boolean',
      description: 'Write a linked source map',
      default: false,
    },
    'transpile-only': transpileOnlyArgument,
  },
  setup({rawArgs, args}) {
    validateParsedArguments(
      rawArgs,
      args._,
      ['output', 'project', 'source-map', 'transpile-only'],
      ['o', 'p'],
    )
  },
  async run({args}) {
    assertMarkscriptFile(args.file)
    const source = path.resolve(args.file)
    const output = path.resolve(
      args.output || `${args.file.replace(/\.ms$/u, '')}.mjs`,
    )
    assertSafeCompileOutput(source, output)
    const options = compilerOptions(
      args.project,
      !args['transpile-only'],
      args['source-map'],
    )
    const result = await bundleFile(args.file, options)
    printDiagnostics(result.diagnostics)
    if (hasErrors(result.diagnostics)) {
      markCommandFailed()
      return
    }

    await mkdir(path.dirname(output), {recursive: true})
    let code = result.code
    if (result.map) {
      const mapPath = `${output}.map`
      const sourceMap = JSON.parse(result.map) as {file?: string}
      sourceMap.file = path.basename(output)
      await Bun.write(mapPath, `${JSON.stringify(sourceMap)}\n`)
      code += `//# sourceMappingURL=${path.basename(mapPath)}\n`
    }
    await Bun.write(output, code)
    console.error(`Compiled ${args.file} -> ${output}`)
  },
})

export const executeCommand = defineCommand({
  meta: {
    name: 'run',
    description:
      'Execute a trusted MarkScript module and its full document lifetime',
  },
  args: {
    file: fileArgument,
    project: projectArgument,
    format: {
      type: 'string',
      alias: 'f',
      description: 'Final document output: markdown, mdast, or pretty',
      valueHint: 'markdown',
      default: 'markdown',
    },
    'transpile-only': transpileOnlyArgument,
  },
  setup({rawArgs, args}) {
    validateParsedArguments(
      rawArgs,
      args._,
      ['project', 'format', 'transpile-only'],
      ['p', 'f'],
    )
  },
  async run({args}) {
    assertMarkscriptFile(args.file)
    const options: Omit<RunOptions, 'filename'> = {
      check: !args['transpile-only'],
    }
    if (args.project) options.tsconfig = args.project
    const format = parseDocumentOutputFormat(args.format)
    const root = await runFile(args.file, options)
    console.log(formatDocument(root, format))
  },
})

export const formatSourceCommand = defineCommand({
  meta: {
    name: 'format',
    description: 'Format MarkScript source without executing it',
  },
  args: {
    file: fileArgument,
    write: {
      type: 'boolean',
      alias: 'w',
      description: 'Write formatted source back to the input file',
      default: false,
    },
    check: {
      type: 'boolean',
      description: 'Exit unsuccessfully when the input requires formatting',
      default: false,
    },
  },
  setup({rawArgs, args}) {
    validateParsedArguments(rawArgs, args._, ['write', 'check'], ['w'])
    if (args.write && args.check) {
      throw new Error('--write and --check are mutually exclusive.')
    }
  },
  async run({args}) {
    assertMarkscriptFile(args.file)
    const filename = path.resolve(args.file)
    const source = await Bun.file(filename).text()
    const formatted = await formatMarkscript(source, {filename})
    if (args.check) {
      if (formatted !== source) {
        console.error(`${args.file} requires formatting`)
        markCommandFailed()
      }
      return
    }
    if (args.write) {
      if (formatted !== source) await Bun.write(filename, formatted)
      console.error(`Formatted ${args.file}`)
      return
    }
    process.stdout.write(formatted)
  },
})

export const helpCommand = defineCommand({
  meta: {
    name: 'help',
    description: 'Read a MarkScript manual page or category index',
  },
  args: {
    selector: {
      type: 'positional',
      description: 'Manual code or category',
      valueHint: 'TUT1001',
      required: false,
    },
  },
  setup({rawArgs, args}) {
    validateParsedArguments(rawArgs, args._, [], [])
  },
  async run({args}) {
    const result = lookupManual(args.selector ?? '')
    if (!result.found) {
      console.error(manualLookupFailureMessage(result))
      markCommandFailed()
      return
    }
    await printManualReference(result.manual)
  },
})

export const mainCommand = defineCommand({
  meta: {
    name: 'markscript',
    version: VERSION,
    description:
      'Markdown-first document programming with TypeScript and MDAST',
  },
  subCommands: {
    check: checkCommand,
    compile: compileCommand,
    format: formatSourceCommand,
    run: executeCommand,
    help: helpCommand,
  },
})

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const previousProgrammaticRun = programmaticRun
  programmaticRun = true
  commandExitCode = 0
  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      const subcommandName = argv.find((argument) => !argument.startsWith('-'))
      if (subcommandName === 'check') {
        await showSubcommandUsage(checkCommand)
      } else if (subcommandName === 'compile') {
        await showSubcommandUsage(compileCommand)
      } else if (subcommandName === 'run') {
        await showSubcommandUsage(executeCommand)
      } else if (subcommandName === 'format') {
        await showSubcommandUsage(formatSourceCommand)
      } else if (subcommandName === 'help') {
        await showSubcommandUsage(helpCommand)
      } else {
        await showUsage(mainCommand)
      }
      return 0
    }
    if (argv.length === 1 && argv[0] === '--version') {
      console.log(VERSION)
      return 0
    }
    if (argv.length === 0) {
      await showUsage(mainCommand)
      return 2
    }
    await runCommand(mainCommand, {rawArgs: argv})
    return commandExitCode
  } catch (error) {
    if (error instanceof MarkScriptCompilationError) {
      printDiagnostics(error.diagnostics)
      return 1
    }
    console.error(error instanceof Error ? error.message : String(error))
    const code = errorCode(error)
    const manual = code === undefined ? undefined : diagnosticManual(code)
    if (manual !== undefined) printDiagnosticHelp(manual)
    return 2
  } finally {
    programmaticRun = previousProgrammaticRun
  }
}

function showSubcommandUsage<Arguments extends ArgsDef>(
  command: CommandDef<Arguments>,
): Promise<void> {
  // Citty's parent parameter unnecessarily requires the parent and child to
  // share the same argument schema while command trees remain distinct.
  return showUsage(command, mainCommand as unknown as CommandDef<Arguments>)
}

function markCommandFailed(): void {
  commandExitCode = 1
  if (!programmaticRun) process.exitCode = 1
}

function assertSafeCompileOutput(source: string, output: string): void {
  if (output === source) {
    throw new Error(`Refusing to overwrite MarkScript source: ${source}`)
  }
}

function compilerOptions(
  project: string | undefined,
  typeCheck = true,
  sourceMap = false,
): Omit<CompilerOptions, 'filename'> {
  const options: Omit<CompilerOptions, 'filename'> = {typeCheck, sourceMap}
  if (project) options.tsconfig = project
  return options
}

function assertMarkscriptFile(filename: string): void {
  if (!filename.endsWith('.ms')) {
    throw new Error(
      `MarkScript source files must use the .ms extension: ${filename}`,
    )
  }
}

function validateParsedArguments(
  rawArgs: readonly string[],
  positional: readonly string[],
  longOptions: readonly string[],
  shortOptions: readonly string[],
): void {
  const allowedLong = new Set(longOptions)
  const allowedShort = new Set(shortOptions)
  let afterSeparator = false

  for (const argument of rawArgs) {
    if (argument === '--') {
      afterSeparator = true
      continue
    }
    if (afterSeparator || argument === '-') continue
    if (argument.startsWith('--')) {
      const name = argument.slice(2).split('=', 1)[0]
      if (name && !allowedLong.has(name)) {
        throw new Error(`Unknown option: --${name}`)
      }
    } else if (argument.startsWith('-')) {
      const name = argument.slice(1).split('=', 1)[0]
      if (name?.length !== 1 || !allowedShort.has(name)) {
        throw new Error(`Unknown option: -${name}`)
      }
    }
  }

  if (positional.length > 1) {
    throw new Error(`Only one input file is supported: ${positional[1]}`)
  }
}

function printDiagnostics(diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    console.error(formatDiagnostic(diagnostic))
    const help = diagnosticManual(String(diagnostic.code))
    if (help !== undefined) printDiagnosticHelp(help)
  }
}

async function printManualReference(manual: ManualDocument): Promise<void> {
  const markdown = formatDocument(manual.root, 'markdown')
  console.log(formatManualReference(manual, markdown))
}

function printDiagnosticHelp(diagnostic: DiagnosticManualPage): void {
  if (diagnostic.problem !== undefined) {
    console.error(`  Problem: ${diagnostic.problem}`)
  }
  console.error(`  Help: markscript help ${diagnostic.code}`)
  console.error(`  Docs: ${diagnostic.documentationUrl}`)
}

function manualLookupFailureMessage(
  result: Exclude<ManualLookupResult, {found: true}>,
): string {
  if (result.reason === 'invalid-selector') {
    return `Invalid manual selector ${JSON.stringify(result.requested)}. Use a manual code (SYN####, ERR####, SUG####, TUT####, or HBK####) or a category (diagnostics, tutorials, or handbooks).`
  }
  const suggestion =
    result.category === undefined
      ? ' Run `markscript help` for the manual index.'
      : ` Run \`markscript help ${result.category}\` for that category index.`
  return `No manual found for ${JSON.stringify(result.normalized)}.${suggestion}`
}

function diagnosticManual(requested: string): DiagnosticManualPage | undefined {
  const manual = getManual(requested)
  return manual?.kind === 'page' && manual.category === 'diagnostics'
    ? manual
    : undefined
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }
  const {code} = error as {code?: unknown}
  return typeof code === 'string' || typeof code === 'number'
    ? String(code)
    : undefined
}

if (import.meta.main) {
  const exitCode = await main()
  if (exitCode !== 0) process.exitCode = exitCode
}
