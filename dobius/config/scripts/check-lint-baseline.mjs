import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import {
  compareToBaseline,
  countByFileAndRule,
  readBaseline,
  reportComparison,
  shrinkSection,
  toRepoRelative,
  writeBaselineSection
} from './lint-baseline/lint-baseline.mjs'

const SWITCH_EXHAUSTIVENESS_DIRS = [
  'src/main',
  'src/preload',
  'src/shared',
  'src/relay',
  'src/cli',
  'src/renderer/src',
  'config',
  'tests'
]

export const LINT_TOOLS = {
  oxlint: (files) => ['--format', 'json', ...files],
  'switch-exhaustiveness': (files) => [
    '--type-aware',
    '--config',
    'config/oxlint-switch-exhaustiveness.json',
    ...(files.length > 0 ? files : SWITCH_EXHAUSTIVENESS_DIRS),
    '--quiet',
    '--format',
    'json'
  ]
}

export function parseArgs(argv) {
  const [tool, ...rest] = argv
  if (!Object.hasOwn(LINT_TOOLS, tool ?? '')) {
    throw new Error(
      `Unknown lint tool "${tool}". Use one of: ${Object.keys(LINT_TOOLS).join(', ')}`
    )
  }
  const options = { tool, update: false, files: null }
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (arg === '--update') {
      options.update = true
    } else if (arg === '--files') {
      options.files = rest.slice(index + 1)
      break
    } else {
      throw new Error(`Unknown argument "${arg}"`)
    }
  }
  return options
}

// Only errors count: warnings never fail `oxlint`, so they stay out of the baseline.
export function diagnosticsToEntries(root, stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    throw new Error(`oxlint did not return JSON output: ${error.message}`, { cause: error })
  }
  if (!Array.isArray(parsed?.diagnostics)) {
    throw new Error('oxlint JSON output has no diagnostics array')
  }
  return parsed.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => ({
      file: toRepoRelative(root, diagnostic.filename),
      rule: diagnostic.code
    }))
}

function runOxlint(root, args) {
  const bin = path.join(root, 'node_modules', '.bin', 'oxlint')
  const result = spawnSync(bin, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === 'win32'
  })
  if (result.error) {
    throw result.error
  }
  return result.stdout
}

export async function main(root = process.cwd(), argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const scopeFiles = options.files?.map((file) => toRepoRelative(root, file)) ?? null
  if (scopeFiles && scopeFiles.length === 0) {
    return 0
  }
  const stdout = runOxlint(root, LINT_TOOLS[options.tool](scopeFiles ?? []))
  const counts = countByFileAndRule(diagnosticsToEntries(root, stdout))
  const section = readBaseline(root)[options.tool]

  if (options.update) {
    writeBaselineSection(root, options.tool, shrinkSection(section, counts, scopeFiles))
  }
  const current = options.update ? readBaseline(root)[options.tool] : section
  return reportComparison(options.tool, compareToBaseline(counts, current, scopeFiles))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}
