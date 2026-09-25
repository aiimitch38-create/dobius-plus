#!/usr/bin/env node
// BUILD-048 (#108 #116): the release and agent docs drifted from the code
// (V1 paths, npm, a retired installer, wrong flags) because nothing checked
// them. This checks every command, path, installer flag, installer exit code
// and DOBIUS_* variable those docs name against the repo.
//
// Usage: node config/scripts/check-docs-references.mjs
//   exit 0  every reference resolves
//   exit 1  findings printed, one per line
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const defaultRepoRoot = path.resolve(import.meta.dirname, '../../..')
export const CANONICAL_REPO = '~/Projects (Code)/Dobius/dobius-plus'
const INSTALLER = 'scripts/install-dobius-gated.sh'

// firstSectionOnly: the rest of dobius/AGENTS.md is style guidance whose file
// names are examples, not references.
export const DOC_TARGETS = [
  { file: 'RELEASING.md', installerExitTable: true, requireText: [INSTALLER] },
  { file: 'CLAUDE.md', requireText: [CANONICAL_REPO, INSTALLER] },
  { file: '.claude/CLAUDE.md', requireText: [CANONICAL_REPO, INSTALLER] },
  { file: 'dobius/AGENTS.md', firstSectionOnly: true, requireText: [CANONICAL_REPO, INSTALLER] }
]

const BANNED = [
  [/\bnpm (?:run|version|install)\b/, 'uses npm; this repo uses pnpm'],
  [/\brm -rf\b/, 'advises rm -rf'],
  [/\.\/build-and-install\.sh/, 'runs the retired build-and-install.sh'],
  [/~\/DobiusPlus\b/, 'names ~/DobiusPlus, which does not exist'],
  [/\/Users\//, 'hard-codes a user home path; use ~ or $HOME'],
  [/pkill -9/, 'advises pkill -9'],
  [
    /(?:pkill|killall)\b.*(?:\.|\[\.\])app/,
    'kills by bundle path, which also kills the terminal daemon'
  ]
]
const RETIRED_SCRIPTS = /\b(?:build-and-install|install-dobius-v2)\.sh\b/
const PNPM_BUILTINS = new Set(['install', 'i', 'add', 'exec', 'dlx', 'rebuild', 'remove', 'update'])
const PATH_EXTENSIONS = /\.(?:md|sh|py|mjs|cjs|js|ts|tsx|json|jsonc|yml|yaml|plist|css)$/
// Build outputs, paths inside an app bundle and the untracked local notes
// folder do not exist in a fresh checkout.
const EXEMPT_PREFIXES = [
  'dist/',
  'out/',
  'dobius/dist/',
  'dobius/out/',
  'Contents/',
  'app.asar',
  '.dobius/'
]
const NOT_PATHS = new Set(['statusdigitalmarketing/dobius-plus'])

function firstSection(markdown) {
  const headings = [...markdown.matchAll(/^## /gm)]
  return headings.length > 1 ? markdown.slice(0, headings[1].index) : markdown
}

// Code is where docs name commands and paths: fenced blocks and inline spans.
export function extractCode(markdown) {
  const segments = []
  let fenced = false
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced
      continue
    }
    if (fenced) {
      segments.push({ text: line, fenced: true })
      continue
    }
    for (const span of line.matchAll(/`([^`]+)`/g)) {
      segments.push({ text: span[1], fenced: false })
    }
  }
  return segments
}

function pathCandidates(text) {
  const out = []
  // Home-anchored paths are outside the repo and may contain spaces.
  if (/^(?:~|\$|"\$)/.test(text.trim())) {
    return out
  }
  for (const raw of text.replace(/"(?:~|\$)[^"]*"/g, ' ').split(/\s+/)) {
    let token = raw.replace(/^["'`]+|["'`,.;:]+$/g, '')
    if (!token || /[<>*{}=$|()'\\…]/.test(token) || /^(?:~|\/|-|@|http)/.test(token)) {
      continue
    }
    token = token.replace(/^\.\//, '')
    if (!token.includes('/') && !PATH_EXTENSIONS.test(token)) {
      continue
    }
    if (NOT_PATHS.has(token) || EXEMPT_PREFIXES.some((prefix) => `${token}/`.startsWith(prefix))) {
      continue
    }
    out.push(token.replace(/\/$/, ''))
  }
  return out
}

function readScripts(repoRoot, dir) {
  const file = path.join(repoRoot, dir, 'package.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).scripts ?? {}) : null
}

export function installerOptions(installerText) {
  return new Set([...installerText.matchAll(/^\s*(--[a-z][a-z-]*)\)/gm)].map((m) => m[1]))
}

export function installerExitCodes(installerText) {
  const code = installerText
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
  return new Set([...code.matchAll(/\bexit (\d+)\b/g)].map((m) => Number(m[1])))
}

function documentedExitCodes(markdown) {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => /^#+ .*exit codes/i.test(line))
  if (start === -1) {
    return null
  }
  const codes = new Set()
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) {
      break
    }
    const row = /^\|\s*(\d+)\s*\|/.exec(line)
    if (row) {
      codes.add(Number(row[1]))
    }
  }
  return codes
}

function envCorpus(repoRoot) {
  const files = [path.join(repoRoot, 'dobius/package.json')]
  const walk = (dir, recursive, pattern) => {
    if (!existsSync(dir)) {
      return
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory() && recursive && entry.name !== 'node_modules') {
        walk(full, recursive, pattern)
      } else if (entry.isFile() && pattern.test(entry.name)) {
        files.push(full)
      }
    }
  }
  walk(path.join(repoRoot, 'scripts'), false, /\.(?:sh|py)$/)
  walk(path.join(repoRoot, 'dobius/config'), true, /\.(?:cjs|mjs|ts)$/)
  walk(path.join(repoRoot, 'dobius/src/main'), false, /\.ts$/)
  return files.filter((file) => existsSync(file)).map((file) => readFileSync(file, 'utf8'))
}

export function checkDoc({ repoRoot, file, text, target = {} }) {
  const findings = []
  const report = (message) => findings.push(`${file}: ${message}`)
  const body = target.firstSectionOnly ? firstSection(text) : text
  const docDir = path.dirname(path.join(repoRoot, file))
  const bases = [docDir, repoRoot, path.join(repoRoot, 'dobius')]

  for (const [pattern, reason] of BANNED) {
    const hit = body.split('\n').find((line) => pattern.test(line))
    if (hit) {
      report(`${reason}: "${hit.trim()}"`)
    }
  }
  for (const needle of target.requireText ?? []) {
    if (!body.includes(needle)) {
      report(`must mention ${needle}`)
    }
  }

  const segments = extractCode(body)
  for (const segment of segments) {
    if (segment.fenced && RETIRED_SCRIPTS.test(segment.text)) {
      report(`runs a retired installer: "${segment.text.trim()}"`)
    }
    for (const m of segment.text.matchAll(
      /\bpnpm\s+(?:--dir\s+(\S+)\s+)?(?:run\s+)?([a-z][\w:.-]*)/g
    )) {
      const [, dir = 'dobius', script] = m
      if (PNPM_BUILTINS.has(script)) {
        continue
      }
      const scripts = readScripts(repoRoot, dir)
      if (!scripts) {
        report(`pnpm --dir ${dir}: no package.json there`)
      } else if (!(script in scripts)) {
        report(`pnpm script "${script}" is not in ${dir}/package.json`)
      }
    }
    for (const candidate of pathCandidates(segment.text)) {
      if (!bases.some((base) => existsSync(path.join(base, candidate)))) {
        report(`path "${candidate}" does not exist in the repo`)
      }
    }
  }

  const installerPath = path.join(repoRoot, INSTALLER)
  const installerText = existsSync(installerPath) ? readFileSync(installerPath, 'utf8') : ''
  const options = installerOptions(installerText)
  for (const line of body.split('\n').filter((l) => l.includes('install-dobius-gated.sh'))) {
    // Only the flags passed to the installer: after its name, up to the end of
    // the code span.
    const args = line.slice(line.indexOf('install-dobius-gated.sh')).split('`')[0]
    for (const flag of args.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)) {
      if (!options.has(flag[0])) {
        report(`installer option ${flag[0]} is not accepted by ${INSTALLER}`)
      }
    }
  }
  if (target.installerExitTable) {
    const documented = documentedExitCodes(body)
    if (!documented) {
      report('has no "exit codes" section for the installer')
    } else {
      const actual = installerExitCodes(installerText)
      for (const code of actual) {
        if (!documented.has(code)) {
          report(`installer exit ${code} is not documented`)
        }
      }
      for (const code of documented) {
        if (!actual.has(code)) {
          report(`documents installer exit ${code}, which ${INSTALLER} never uses`)
        }
      }
    }
  }

  const envNames = new Set([...body.matchAll(/\bDOBIUS_[A-Z0-9_]+\b/g)].map((m) => m[0]))
  if (envNames.size > 0) {
    const corpus = envCorpus(repoRoot)
    for (const name of envNames) {
      if (!corpus.some((source) => source.includes(name))) {
        report(`${name} is not used by the installer, dobius/config or dobius/src/main`)
      }
    }
  }
  return findings
}

export function checkRepoDocs(repoRoot = defaultRepoRoot, readDoc = undefined) {
  const read = readDoc ?? ((file) => readFileSync(path.join(repoRoot, file), 'utf8'))
  return DOC_TARGETS.flatMap((target) => {
    const full = path.join(repoRoot, target.file)
    if (!readDoc && !existsSync(full)) {
      return [`${target.file}: missing`]
    }
    return checkDoc({ repoRoot, file: target.file, text: read(target.file), target })
  })
}

export function main(repoRoot = defaultRepoRoot) {
  const findings = checkRepoDocs(repoRoot)
  for (const finding of findings) {
    console.error(finding)
  }
  if (findings.length === 0) {
    console.log(`Docs references: ${DOC_TARGETS.length} docs checked, all resolve.`)
  }
  return findings.length === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
