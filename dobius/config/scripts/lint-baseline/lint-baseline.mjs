import fs from 'node:fs'
import path from 'node:path'

// Why: the repo carried thousands of pre-existing lint errors (#115), so a
// plain `oxlint` run failed on every commit. The baseline records the
// remaining debt per file + rule; checks fail only when a count grows, and
// updates may only shrink it.
export const BASELINE_RELATIVE_PATH = path.join('config', 'lint-baseline.json')
export const BASELINE_SECTIONS = ['oxlint', 'switch-exhaustiveness', 'styled-scrollbars']

export function toRepoRelative(root, filePath) {
  return path.relative(root, path.resolve(root, filePath)).split(path.sep).join('/')
}

// entries: [{ file, rule }] -> { [file]: { [rule]: count } }
export function countByFileAndRule(entries) {
  const counts = {}
  for (const { file, rule } of entries) {
    const rules = (counts[file] ??= {})
    rules[rule] = (rules[rule] ?? 0) + 1
  }
  return counts
}

function filesInScope(counts, section, scopeFiles) {
  if (scopeFiles) {
    return [...new Set(scopeFiles)]
  }
  return [...new Set([...Object.keys(counts), ...Object.keys(section)])]
}

export function compareToBaseline(counts, section, scopeFiles = null) {
  const grown = []
  const shrunk = []
  for (const file of filesInScope(counts, section, scopeFiles)) {
    const actualRules = counts[file] ?? {}
    const allowedRules = section[file] ?? {}
    const rules = new Set([...Object.keys(actualRules), ...Object.keys(allowedRules)])
    for (const rule of rules) {
      const count = actualRules[rule] ?? 0
      const allowed = allowedRules[rule] ?? 0
      if (count > allowed) {
        grown.push({ file, rule, count, allowed })
      } else if (count < allowed) {
        shrunk.push({ file, rule, count, allowed })
      }
    }
  }
  return { grown, shrunk }
}

// Never raises a count or adds an entry: the baseline can only get smaller.
export function shrinkSection(section, counts, scopeFiles = null) {
  const scope = scopeFiles ? new Set(scopeFiles) : null
  const next = {}
  for (const [file, rules] of Object.entries(section)) {
    const inScope = !scope || scope.has(file)
    for (const [rule, allowed] of Object.entries(rules)) {
      const kept = inScope ? Math.min(allowed, counts[file]?.[rule] ?? 0) : allowed
      if (kept > 0) {
        ;(next[file] ??= {})[rule] = kept
      }
    }
  }
  return sortSection(next)
}

export function sortSection(section) {
  const sorted = {}
  for (const file of Object.keys(section).sort()) {
    sorted[file] = {}
    for (const rule of Object.keys(section[file]).sort()) {
      sorted[file][rule] = section[file][rule]
    }
  }
  return sorted
}

export function totalCount(section) {
  let total = 0
  for (const rules of Object.values(section)) {
    for (const count of Object.values(rules)) {
      total += count
    }
  }
  return total
}

export function readBaseline(root) {
  const raw = fs.readFileSync(path.join(root, BASELINE_RELATIVE_PATH), 'utf8')
  const baseline = JSON.parse(raw)
  for (const name of BASELINE_SECTIONS) {
    if (!baseline[name] || typeof baseline[name] !== 'object') {
      throw new Error(`${BASELINE_RELATIVE_PATH} is missing the "${name}" section`)
    }
  }
  return baseline
}

export function writeBaselineSection(root, name, section) {
  const baseline = readBaseline(root)
  baseline[name] = sortSection(section)
  fs.writeFileSync(
    path.join(root, BASELINE_RELATIVE_PATH),
    `${JSON.stringify(baseline, null, 2)}\n`
  )
}

function formatEntry({ file, rule, count, allowed }) {
  return `${file}  ${rule}  ${count} (baseline ${allowed})`
}

// Returns the process exit code: 1 when any count grew, else 0.
export function reportComparison(name, { grown, shrunk }, log = console) {
  if (grown.length > 0) {
    log.error(`Lint baseline "${name}": ${grown.length} file/rule count(s) grew.`)
    log.error('Fix the new errors. Do not add them to config/lint-baseline.json.')
    log.error('')
    log.error(grown.map(formatEntry).join('\n'))
    return 1
  }
  if (shrunk.length > 0) {
    log.log(
      `Lint baseline "${name}": ${shrunk.length} entr${shrunk.length === 1 ? 'y' : 'ies'} can shrink. ` +
        'Run `pnpm run lint:baseline:update` to record the progress.'
    )
  }
  return 0
}
