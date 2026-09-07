#!/usr/bin/env bun

import {constants} from 'node:fs'
import {access, lstat, stat} from 'node:fs/promises'
import {isIP} from 'node:net'
import path from 'node:path'
import {domainToASCII} from 'node:url'
import {
  type ArgsDef,
  type CommandDef,
  defineCommand,
  runCommand,
  showUsage,
} from 'citty'
import type {BuiltSite} from './site.ts'

const VERSION = '0.1.0'

const sourceArgument = {
  type: 'positional',
  description: 'MarkScript page or JavaScript/TypeScript site module',
  valueHint: 'page.ms|msdocs.config.ts',
  required: true,
} as const

const outputArgument = {
  type: 'string',
  alias: 'o',
  description: 'Static site output directory',
  valueHint: 'directory',
  default: 'site',
} as const

const titleArgument = {
  type: 'string',
  description: 'Site title',
  valueHint: 'title',
} as const

const projectArgument = {
  type: 'string',
  alias: 'p',
  description: 'Use this tsconfig.json for a .ms page',
  valueHint: 'tsconfig.json',
} as const

const transpileOnlyArgument = {
  type: 'boolean',
  description: 'Skip semantic TypeScript checking for a .ms page',
  default: false,
} as const

interface CliOption {
  readonly name: string
  readonly kind: 'boolean' | 'string'
  readonly alias?: string
}

const buildOptions: readonly CliOption[] = [
  {name: 'out-dir', kind: 'string', alias: 'o'},
  {name: 'title', kind: 'string'},
  {name: 'project', kind: 'string', alias: 'p'},
  {name: 'transpile-only', kind: 'boolean'},
]

const serveOptions: readonly CliOption[] = [
  ...buildOptions,
  {name: 'host', kind: 'string'},
  {name: 'port', kind: 'string'},
]

const helpOption: CliOption = {
  name: 'help',
  kind: 'boolean',
  alias: 'h',
}

export const buildCommand = defineCommand({
  meta: {
    name: 'build',
    description:
      'Build a static site from MarkScript or a SiteDefinition module',
  },
  args: {
    source: sourceArgument,
    'out-dir': outputArgument,
    title: titleArgument,
    project: projectArgument,
    'transpile-only': transpileOnlyArgument,
  },
  setup({rawArgs}) {
    validateCommandLine(rawArgs, buildOptions)
  },
  async run({args}) {
    const target = await prepareBuildTarget(args)
    const built = await buildTarget(target)
    console.error(
      `Built ${built.pages} page${built.pages === 1 ? '' : 's'} in ${built.directory}`,
    )
  },
})

export const serveCommand = defineCommand({
  meta: {
    name: 'serve',
    description: 'Build and preview the site with Bun',
  },
  args: {
    source: sourceArgument,
    'out-dir': outputArgument,
    title: titleArgument,
    project: projectArgument,
    'transpile-only': transpileOnlyArgument,
    host: {
      type: 'string',
      description: 'Address to bind',
      valueHint: 'address',
      default: '127.0.0.1',
    },
    port: {
      type: 'string',
      description: 'TCP port',
      valueHint: 'port',
      default: '8000',
    },
  },
  setup({rawArgs}) {
    validateCommandLine(rawArgs, serveOptions)
  },
  async run({args}) {
    const prepared = await prepareServeTarget(args)
    const built = await buildTarget(prepared.target)
    const {serveSite} = await import('./server.ts')
    const server = await serveSite({
      directory: built.directory,
      hostname: prepared.hostname,
      port: prepared.port,
    })
    console.error(
      `Serving ${built.pages} page${built.pages === 1 ? '' : 's'} at ${server.url}`,
    )
    await new Promise<never>(() => undefined)
  },
})

export const mainCommand = defineCommand({
  meta: {
    name: 'msdocs',
    version: VERSION,
    description: 'Generate static sites from MarkScript and MDAST',
  },
  subCommands: {
    build: buildCommand,
    serve: serveCommand,
  },
})

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      if (argv[0] === 'build') {
        validateCommandLine(argv.slice(1), [...buildOptions, helpOption])
        await showSubcommandUsage(buildCommand)
      } else if (argv[0] === 'serve') {
        validateCommandLine(argv.slice(1), [...serveOptions, helpOption])
        await showSubcommandUsage(serveCommand)
      } else {
        validateRootHelp(argv)
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
      return 1
    }
    const commandName = argv[0]
    if (commandName === undefined) throw new Error('No command specified')
    if (commandName !== 'build' && commandName !== 'serve') {
      if (commandName.startsWith('-')) {
        throw new Error(`Unknown option: ${commandName}`)
      }
      throw new Error(`Unknown command: ${commandName}`)
    }
    await runCommand(mainCommand, {rawArgs: argv})
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

interface BuildTargetArguments {
  readonly source?: string
  readonly 'out-dir': string
  readonly title?: string
  readonly project?: string
  readonly 'transpile-only': boolean
}

interface ServeTargetArguments extends BuildTargetArguments {
  readonly host: string
  readonly port: string
}

interface PreparedBuildTarget {
  readonly source: string
  readonly sourceKind: 'markscript' | 'site-module'
  readonly outDir: string
  readonly title?: string
  readonly project?: string
  readonly check: boolean
}

interface PreparedServeTarget {
  readonly target: PreparedBuildTarget
  readonly hostname: string
  readonly port: number
}

async function prepareBuildTarget(
  args: BuildTargetArguments,
): Promise<PreparedBuildTarget> {
  const outDirValue = requiredString(args['out-dir'], '--out-dir')
  const outDir = await validateOutputDirectory(outDirValue)
  const title = optionalTitle(args.title)
  const source = await validateSource(requiredString(args.source, 'SOURCE'))
  const project = optionalString(args.project, '--project')
  const transpileOnly = requiredBoolean(
    args['transpile-only'],
    '--transpile-only',
  )

  if (source.kind === 'site-module' && project !== undefined) {
    throw new Error('--project is only available for a MarkScript .ms input')
  }
  if (source.kind === 'site-module' && transpileOnly) {
    throw new Error(
      '--transpile-only is only available for a MarkScript .ms input',
    )
  }

  const projectPath =
    project === undefined ? undefined : await validateProject(project)
  return {
    source: source.filename,
    sourceKind: source.kind,
    outDir,
    check: !transpileOnly,
    ...(title === undefined ? {} : {title}),
    ...(projectPath === undefined ? {} : {project: projectPath}),
  }
}

async function prepareServeTarget(
  args: ServeTargetArguments,
): Promise<PreparedServeTarget> {
  const hostname = parseHostname(requiredString(args.host, '--host'))
  const port = parsePort(requiredString(args.port, '--port'))
  const target = await prepareBuildTarget(args)
  return {target, hostname, port}
}

async function buildTarget(target: PreparedBuildTarget): Promise<BuiltSite> {
  const {buildMarkScriptSite, buildSiteModule} = await import('./site.ts')
  if (target.sourceKind === 'site-module') {
    return buildSiteModule(target.source, {
      outDir: target.outDir,
      ...(target.title === undefined ? {} : {title: target.title}),
    })
  }
  return buildMarkScriptSite(target.source, {
    outDir: target.outDir,
    check: target.check,
    ...(target.title === undefined ? {} : {title: target.title}),
    ...(target.project === undefined ? {} : {project: target.project}),
  })
}

function parsePort(value: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new Error(
      `Invalid port ${JSON.stringify(value)}; expected 1 through 65535`,
    )
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `Invalid port ${JSON.stringify(value)}; expected 1 through 65535`,
    )
  }
  return port
}

function parseHostname(value: string): string {
  if (value !== value.trim() || containsControl(value)) {
    throw new Error(`Invalid host ${JSON.stringify(value)}`)
  }
  if (isIP(value) !== 0) return value
  if (value.includes(':') || /^[0-9.]+$/u.test(value))
    throw new Error(`Invalid host ${JSON.stringify(value)}`)

  const withoutFinalDot = value.endsWith('.') ? value.slice(0, -1) : value
  const ascii = domainToASCII(withoutFinalDot)
  if (
    ascii === '' ||
    ascii.length > 253 ||
    ascii
      .split('.')
      .some(
        (label) =>
          label.length === 0 ||
          label.length > 63 ||
          !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label),
      )
  ) {
    throw new Error(`Invalid host ${JSON.stringify(value)}`)
  }
  return value
}

async function validateSource(value: string): Promise<{
  filename: string
  kind: 'markscript' | 'site-module'
}> {
  assertPathText(value, 'SOURCE')
  const extension = path.extname(value)
  const kind =
    extension === '.ms'
      ? 'markscript'
      : ['.ts', '.mts', '.js', '.mjs'].includes(extension)
        ? 'site-module'
        : undefined
  if (kind === undefined) {
    throw new Error(
      `msdocs input must be a .ms page or .ts/.mts/.js/.mjs site module: ${value}`,
    )
  }
  const filename = path.resolve(value)
  const metadata = await pathMetadata(filename, 'msdocs input')
  if (!metadata.isFile()) {
    throw new Error(`msdocs input must be a regular file: ${filename}`)
  }
  return {filename, kind}
}

async function validateProject(value: string): Promise<string> {
  assertPathText(value, '--project')
  const requested = path.resolve(value)
  const metadata = await pathMetadata(requested, 'TypeScript project')
  if (metadata.isFile()) return requested
  if (!metadata.isDirectory()) {
    throw new Error(
      `TypeScript project must be a file or directory: ${requested}`,
    )
  }

  const config = path.join(requested, 'tsconfig.json')
  const configMetadata = await pathMetadata(config, 'TypeScript project')
  if (!configMetadata.isFile()) {
    throw new Error(`TypeScript project must be a regular file: ${config}`)
  }
  return requested
}

async function validateOutputDirectory(value: string): Promise<string> {
  assertPathText(value, '--out-dir')
  const directory = path.resolve(value)
  if (directory === path.parse(directory).root) {
    throw new Error(
      `Refusing to use a filesystem root as --out-dir: ${directory}`,
    )
  }

  let existing = directory
  while (true) {
    try {
      const metadata = await lstat(existing)
      if (existing === directory && metadata.isSymbolicLink()) {
        throw new Error(`msdocs output path is a symbolic link: ${directory}`)
      }
      if (!metadata.isDirectory()) {
        throw new Error(`msdocs output path must be a directory: ${existing}`)
      }
      await access(existing, constants.W_OK | constants.X_OK)
      return directory
    } catch (error) {
      if (!isMissingPathError(error)) {
        if (
          error instanceof Error &&
          error.message.startsWith('msdocs output path')
        ) {
          throw error
        }
        throw new Error(
          `msdocs output directory is inaccessible: ${directory}`,
          {
            cause: error,
          },
        )
      }
      const parent = path.dirname(existing)
      if (parent === existing) {
        throw new Error(
          `msdocs output directory resolution failed: ${directory}`,
        )
      }
      existing = parent
    }
  }
}

async function pathMetadata(filename: string, label: string) {
  try {
    return await stat(filename)
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(`${label} is missing: ${filename}`)
    }
    throw new Error(`${label} inspection failed: ${filename}`, {
      cause: error,
    })
  }
}

function validateCommandLine(
  rawArgs: readonly string[],
  options: readonly CliOption[],
): void {
  const longOptions = new Map(options.map((option) => [option.name, option]))
  const shortOptions = new Map(
    options.flatMap((option) =>
      option.alias === undefined ? [] : [[option.alias, option] as const],
    ),
  )
  const seen = new Set<string>()
  const positionals: string[] = []
  let afterSeparator = false

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index]
    if (argument === undefined) continue
    if (afterSeparator) {
      positionals.push(argument)
      continue
    }
    if (argument === '--') {
      afterSeparator = true
      continue
    }
    if (argument === '-' || !argument.startsWith('-')) {
      positionals.push(argument)
      continue
    }

    const long = argument.startsWith('--')
    const prefixLength = long ? 2 : 1
    const equals = argument.indexOf('=', prefixLength)
    const name = argument.slice(
      prefixLength,
      equals === -1 ? undefined : equals,
    )
    const option = long ? longOptions.get(name) : shortOptions.get(name)
    if (option === undefined || (!long && name.length !== 1)) {
      throw new Error(`Unknown option: ${argument}`)
    }
    if (seen.has(option.name)) {
      throw new Error(`Option --${option.name} may only be specified once`)
    }
    seen.add(option.name)

    if (option.kind === 'boolean') {
      if (equals !== -1) {
        throw new Error(`Option --${option.name} uses flag syntax`)
      }
      continue
    }

    if (equals !== -1) {
      if (argument.slice(equals + 1) === '') {
        throw new Error(`Option --${option.name} requires a value`)
      }
      continue
    }
    const value = rawArgs[index + 1]
    if (value === undefined || value === '--' || value.startsWith('-')) {
      throw new Error(`Option --${option.name} requires a value`)
    }
    index += 1
  }

  if (positionals.length > 1) {
    throw new Error(`Only one source file is supported: ${positionals[1]}`)
  }
}

function validateRootHelp(argv: readonly string[]): void {
  const [help, extra] = argv
  if (help !== '--help' && help !== '-h') {
    if (help?.startsWith('-')) throw new Error(`Unknown option: ${help}`)
    throw new Error(`Unknown command: ${help ?? ''}`)
  }
  if (extra !== undefined) {
    if (extra.startsWith('-')) throw new Error(`Unknown option: ${extra}`)
    throw new Error(`Unexpected argument: ${extra}`)
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} requires a non-empty value`)
  }
  return value
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, label)
}

function optionalTitle(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const title = requiredString(value, '--title')
  if (containsControl(title)) {
    throw new Error('--title must be a single line without control characters')
  }
  return title
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean flag`)
  }
  return value
}

function assertPathText(value: string, label: string): void {
  if (value.trim() === '' || value.includes('\0')) {
    throw new Error(`${label} requires a valid non-empty path`)
  }
}

function containsControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true
    }
  }
  return false
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

function showSubcommandUsage<Arguments extends ArgsDef>(
  command: CommandDef<Arguments>,
): Promise<void> {
  return showUsage(command, mainCommand as unknown as CommandDef<Arguments>)
}

if (import.meta.main) {
  const exitCode = await main()
  if (exitCode !== 0) process.exitCode = exitCode
}
