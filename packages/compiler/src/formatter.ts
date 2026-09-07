import {format as prettierFormat, resolveConfig} from 'prettier'
import {parseMarkscript} from './parser.ts'
import markscriptPlugin from './prettier.ts'

export interface MarkscriptFormatOptions {
  filename?: string
  insertSpaces?: boolean
  printWidth?: number
  tabSize?: number
}

/** Format MarkScript without evaluating the module or document entry. */
export async function formatMarkscript(
  source: string,
  options: MarkscriptFormatOptions = {},
): Promise<string> {
  const filename = options.filename ?? 'document.ms'
  const parsed = parseMarkscript(source, filename)
  if (!parsed.tree)
    throw new MarkscriptFormatError(parsed.diagnostics[0]?.message)

  const projectOptions = options.filename
    ? await resolveConfig(options.filename)
    : null
  const prettierOptions = {
    ...projectOptions,
    filepath: filename,
    parser: 'markscript',
    plugins: [...(projectOptions?.plugins ?? []), markscriptPlugin],
    semi: projectOptions?.semi ?? false,
    singleQuote: projectOptions?.singleQuote ?? true,
    tabWidth: options.tabSize ?? projectOptions?.tabWidth ?? 2,
    useTabs:
      options.insertSpaces === undefined
        ? (projectOptions?.useTabs ?? false)
        : !options.insertSpaces,
    ...(options.printWidth ? {printWidth: options.printWidth} : {}),
  }
  const formatted = await prettierFormat(source, prettierOptions)

  const verified = parseMarkscript(formatted, filename)
  if (!verified.tree) {
    throw new MarkscriptFormatError(
      verified.diagnostics[0]?.message ??
        'Formatting produced invalid MarkScript source.',
    )
  }
  return formatted
}

export class MarkscriptFormatError extends Error {
  constructor(message = 'Formatting requires valid MarkScript source.') {
    super(message)
    this.name = 'MarkscriptFormatError'
  }
}
