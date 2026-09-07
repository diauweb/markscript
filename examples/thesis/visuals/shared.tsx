import {existsSync, readFileSync} from 'node:fs'

export interface ThesisFigureSize {
  readonly width: number
  readonly height: number
}

export interface ThesisFontPaths {
  readonly timesNewRoman?: string
  readonly simSun?: string
  readonly simSunFaceIndex?: number
  readonly python?: string
}

export interface ThesisSatoriFont {
  readonly name: string
  readonly data: Buffer<ArrayBufferLike>
  readonly sourcePath: string
  readonly weight: 400
  readonly style: 'normal'
}

const WINDOWS_TIMES_PATHS = [
  '/mnt/c/Windows/Fonts/times.ttf',
  'C:\\Windows\\Fonts\\times.ttf',
] as const
const WINDOWS_SIMSUN_PATHS = [
  '/mnt/c/Windows/Fonts/simsun.ttc',
  'C:\\Windows\\Fonts\\simsun.ttc',
] as const

const cssPixelsPerInch = 96
const millimetersPerInch = 25.4
const extractCollectionFace = `
from fontTools.ttLib import TTCollection
from io import BytesIO
import sys

collection = TTCollection(sys.argv[1])
output = BytesIO()
collection.fonts[int(sys.argv[2])].save(output)
sys.stdout.buffer.write(output.getvalue())
`

export const mm = (value: number) =>
  (value * cssPixelsPerInch) / millimetersPerInch
export const cm = (value: number) => mm(value * 10)

function resolveFontPath(
  label: string,
  explicitPath: string | undefined,
  environmentPath: string | undefined,
  defaults: readonly string[],
): string {
  const candidates = [explicitPath, environmentPath, ...defaults].filter(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.length > 0,
  )
  const resolved = candidates.find((candidate) => existsSync(candidate))
  if (resolved !== undefined) return resolved
  throw new Error(
    `Missing ${label} font. Pass its installed file to loadThesisFonts(), ` +
      `or set the corresponding MARKSCRIPT_THESIS_*_FONT variable. Checked: ${candidates.join(', ')}`,
  )
}

function readFontFace(
  path: string,
  label: string,
  index: number,
  python?: string,
): Buffer<ArrayBufferLike> {
  if (!/\.(?:otc|ttc)$/iu.test(path)) return readFileSync(path)
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new TypeError(
      `${label} collection face index must be a non-negative integer`,
    )
  }

  const executables = [
    python,
    process.env.MARKSCRIPT_THESIS_PYTHON,
    'python3',
    'python',
  ].filter(
    (candidate, candidateIndex, candidates): candidate is string =>
      typeof candidate === 'string' &&
      candidate.length > 0 &&
      candidates.indexOf(candidate) === candidateIndex,
  )
  const failures: string[] = []
  for (const executable of executables) {
    try {
      const result = Bun.spawnSync({
        cmd: [executable, '-c', extractCollectionFace, path, String(index)],
        stdout: 'pipe',
        stderr: 'pipe',
      })
      if (result.exitCode === 0 && result.stdout.byteLength > 0) {
        return Buffer.from(result.stdout)
      }
      failures.push(
        `${executable}: ${new TextDecoder().decode(result.stderr).trim() || `exit ${result.exitCode}`}`,
      )
    } catch (error) {
      failures.push(
        `${executable}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  throw new Error(
    `Could not extract ${label} face ${index} from ${path}. ` +
      `Install Python fontTools or provide a standalone TTF/OTF file. ${failures.join('; ')}`,
  )
}

/** Loads the two user-installed fonts used by the template diagrams. */
export function loadThesisFonts(
  paths: ThesisFontPaths = {},
): ThesisSatoriFont[] {
  const timesNewRoman = resolveFontPath(
    'Times New Roman',
    paths.timesNewRoman,
    process.env.MARKSCRIPT_THESIS_TIMES_FONT,
    WINDOWS_TIMES_PATHS,
  )
  const simSun = resolveFontPath(
    'SimSun',
    paths.simSun,
    process.env.MARKSCRIPT_THESIS_SIMSUN_FONT,
    WINDOWS_SIMSUN_PATHS,
  )
  return [
    {
      name: 'Times New Roman',
      data: readFontFace(timesNewRoman, 'Times New Roman', 0, paths.python),
      sourcePath: timesNewRoman,
      weight: 400,
      style: 'normal',
    },
    {
      name: 'SimSun',
      data: readFontFace(
        simSun,
        'SimSun',
        paths.simSunFaceIndex ?? 0,
        paths.python,
      ),
      sourcePath: simSun,
      weight: 400,
      style: 'normal',
    },
  ]
}
