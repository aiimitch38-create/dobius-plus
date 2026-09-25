import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

import {
  compareToBaseline,
  countByFileAndRule,
  readBaseline,
  shrinkSection,
  writeBaselineSection
} from './lint-baseline/lint-baseline.mjs'
import { reportUnstyledScrollbars } from './styled-scrollbars/styled-scrollbar-jsx-check.mjs'
export {
  plainClassName,
  reportUnstyledScrollbars
} from './styled-scrollbars/styled-scrollbar-jsx-check.mjs'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'])
const SKIP_PATH_PARTS = new Set(['node_modules', 'dist', 'out', '.git', '__snapshots__'])
const BASELINE_SECTION = 'styled-scrollbars'
const BASELINE_RULE = 'styled-scrollbar'

export function normalizePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function isSkippedFile(root, filePath) {
  const relative = normalizePath(root, filePath)
  if (relative.includes('.test.') || relative.includes('.spec.')) {
    return true
  }
  return relative.split('/').some((part) => SKIP_PATH_PARTS.has(part))
}

async function collectSourceFiles(root, dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_PATH_PARTS.has(entry.name)) {
        files.push(...(await collectSourceFiles(root, fullPath)))
      }
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      !isSkippedFile(root, fullPath)
    ) {
      files.push(fullPath)
    }
  }

  return files
}

async function collectUnstyledScrollbarReports(root) {
  const sourceRoot = path.join(root, 'src', 'renderer', 'src')
  const files = await collectSourceFiles(root, sourceRoot)
  const reports = []

  for (const filePath of files) {
    const sourceText = await fs.readFile(filePath, 'utf8')
    reports.push(...reportUnstyledScrollbars(filePath, sourceText))
  }

  return reports
}

function formatReports(root, reports) {
  return reports
    .map(
      (report) =>
        `${normalizePath(root, report.filePath)}:${report.line}:${report.column} ${report.text.replace(/\s+/g, ' ')}`
    )
    .join('\n')
}

function countReports(root, reports) {
  return countByFileAndRule(
    reports.map((report) => ({ file: normalizePath(root, report.filePath), rule: BASELINE_RULE }))
  )
}

// Why: pre-existing unstyled containers live in config/lint-baseline.json
// (#115); only files whose count grows past their baseline fail the check.
export function reportsOverBaseline(root, reports, section) {
  const counts = countReports(root, reports)
  const grownFiles = new Set(compareToBaseline(counts, section).grown.map((entry) => entry.file))
  return reports.filter((report) => grownFiles.has(normalizePath(root, report.filePath)))
}

export async function main(root = process.cwd(), argv = process.argv.slice(2)) {
  const allReports = await collectUnstyledScrollbarReports(root)
  if (argv.includes('--update')) {
    const counts = countReports(root, allReports)
    const section = readBaseline(root)[BASELINE_SECTION]
    writeBaselineSection(root, BASELINE_SECTION, shrinkSection(section, counts))
  }
  const reports = reportsOverBaseline(root, allReports, readBaseline(root)[BASELINE_SECTION])
  if (reports.length === 0) {
    return 0
  }

  console.error('Renderer vertical scroll containers must use an Dobius scrollbar style.')
  console.error('Put the scrollbar class in the same class literal as the vertical overflow class.')
  console.error('Use scrollbar-sleek, scrollbar-editor, or worktree-sidebar-scrollbar.')
  console.error('')
  console.error(formatReports(root, reports))
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}
