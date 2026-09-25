import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { diagnosticsToEntries, parseArgs } from '../check-lint-baseline.mjs'
import { reportsOverBaseline } from '../check-styled-scrollbars.mjs'
import {
  BASELINE_RELATIVE_PATH,
  BASELINE_SECTIONS,
  compareToBaseline,
  countByFileAndRule,
  reportComparison,
  shrinkSection,
  totalCount
} from './lint-baseline.mjs'

const dobiusRoot = path.resolve(import.meta.dirname, '..', '..', '..')

// Why: the baseline may only shrink (#115). Lower these when it does; raising
// one means new lint debt was hidden in config/lint-baseline.json.
const BASELINE_CEILINGS = {
  oxlint: 290,
  'switch-exhaustiveness': 17,
  'styled-scrollbars': 129
}
const LOCALIZATION_ALLOWLIST_CEILING = 4247

const silentLog = { log: () => undefined, error: () => undefined }

describe('compareToBaseline', () => {
  const section = { 'a.ts': { curly: 2 } }

  it('passes when counts match the baseline', () => {
    const counts = countByFileAndRule([
      { file: 'a.ts', rule: 'curly' },
      { file: 'a.ts', rule: 'curly' }
    ])
    expect(compareToBaseline(counts, section)).toEqual({ grown: [], shrunk: [] })
  })

  it('flags a count that grew past its baseline', () => {
    const counts = { 'a.ts': { curly: 3 } }
    expect(compareToBaseline(counts, section).grown).toEqual([
      { file: 'a.ts', rule: 'curly', count: 3, allowed: 2 }
    ])
  })

  it('flags a new rule in a baselined file and a new file', () => {
    const counts = { 'a.ts': { curly: 2, 'max-lines': 1 }, 'b.ts': { curly: 1 } }
    const { grown } = compareToBaseline(counts, section)
    expect(grown.map((entry) => `${entry.file}:${entry.rule}`).sort()).toEqual([
      'a.ts:max-lines',
      'b.ts:curly'
    ])
  })

  it('reports shrinkage, including files that no longer have errors', () => {
    const { grown, shrunk } = compareToBaseline({}, section)
    expect(grown).toEqual([])
    expect(shrunk).toEqual([{ file: 'a.ts', rule: 'curly', count: 0, allowed: 2 }])
  })

  it('only compares the scoped files', () => {
    const counts = { 'a.ts': { curly: 2 }, 'b.ts': { curly: 5 } }
    expect(compareToBaseline(counts, section, ['a.ts']).grown).toEqual([])
    expect(compareToBaseline(counts, section, ['b.ts']).grown).toHaveLength(1)
  })
})

describe('shrinkSection', () => {
  it('lowers counts and drops cleared entries but never adds or raises', () => {
    const section = { 'a.ts': { curly: 2, any: 1 }, 'b.ts': { curly: 1 } }
    const counts = { 'a.ts': { curly: 5, any: 0 }, 'c.ts': { curly: 4 } }
    expect(shrinkSection(section, counts)).toEqual({ 'a.ts': { curly: 2 } })
  })

  it('leaves out-of-scope files untouched', () => {
    const section = { 'a.ts': { curly: 2 }, 'b.ts': { curly: 1 } }
    expect(shrinkSection(section, {}, ['a.ts'])).toEqual({ 'b.ts': { curly: 1 } })
  })
})

describe('reportComparison', () => {
  it('fails only when something grew', () => {
    const entry = { file: 'a.ts', rule: 'curly', count: 1, allowed: 0 }
    expect(reportComparison('oxlint', { grown: [entry], shrunk: [] }, silentLog)).toBe(1)
    expect(reportComparison('oxlint', { grown: [], shrunk: [entry] }, silentLog)).toBe(0)
  })
})

describe('check-lint-baseline CLI parsing', () => {
  it('counts only errors and makes paths repo-relative', () => {
    const stdout = JSON.stringify({
      diagnostics: [
        { severity: 'error', code: 'eslint(curly)', filename: path.join(dobiusRoot, 'src/a.ts') },
        { severity: 'warning', code: 'eslint(no-unused-vars)', filename: 'src/a.ts' }
      ]
    })
    expect(diagnosticsToEntries(dobiusRoot, stdout)).toEqual([
      { file: 'src/a.ts', rule: 'eslint(curly)' }
    ])
  })

  it('fails closed when oxlint output is not JSON', () => {
    expect(() => diagnosticsToEntries(dobiusRoot, 'oxlint crashed')).toThrow(/JSON/)
    expect(() => diagnosticsToEntries(dobiusRoot, '{}')).toThrow(/diagnostics/)
  })

  it('parses the tool, --update and trailing --files', () => {
    expect(parseArgs(['oxlint', '--files', 'a.ts', 'b.ts'])).toEqual({
      tool: 'oxlint',
      update: false,
      files: ['a.ts', 'b.ts']
    })
    expect(parseArgs(['switch-exhaustiveness', '--update']).update).toBe(true)
    expect(() => parseArgs(['eslint'])).toThrow(/Unknown lint tool/)
  })
})

describe('styled scrollbar baseline', () => {
  const report = (filePath) => ({ filePath, line: 1, column: 1, text: 'overflow-y-auto' })

  it('reports only files whose unstyled count grew past the baseline', () => {
    const reports = [report('/r/src/a.tsx'), report('/r/src/a.tsx'), report('/r/src/b.tsx')]
    const section = {
      'src/a.tsx': { 'styled-scrollbar': 1 },
      'src/b.tsx': { 'styled-scrollbar': 1 }
    }
    expect(reportsOverBaseline('/r', reports, section).map((entry) => entry.filePath)).toEqual([
      '/r/src/a.tsx',
      '/r/src/a.tsx'
    ])
  })
})

describe('checked-in lint baseline', () => {
  const baseline = JSON.parse(
    fs.readFileSync(path.join(dobiusRoot, BASELINE_RELATIVE_PATH), 'utf8')
  )

  it('only holds positive integer counts', () => {
    for (const name of BASELINE_SECTIONS) {
      for (const rules of Object.values(baseline[name])) {
        for (const count of Object.values(rules)) {
          expect(Number.isInteger(count) && count > 0).toBe(true)
        }
      }
    }
  })

  it('never grows past its recorded ceilings', () => {
    for (const name of BASELINE_SECTIONS) {
      expect(totalCount(baseline[name]), name).toBeLessThanOrEqual(BASELINE_CEILINGS[name])
    }
  })

  it('keeps the localization allowlist from growing', () => {
    const allowlist = JSON.parse(
      fs.readFileSync(
        path.join(dobiusRoot, 'config', 'localization-coverage-allowlist.json'),
        'utf8'
      )
    )
    const total = allowlist.reduce((sum, entry) => sum + entry.count, 0)
    expect(total).toBeLessThanOrEqual(LOCALIZATION_ALLOWLIST_CEILING)
  })
})
