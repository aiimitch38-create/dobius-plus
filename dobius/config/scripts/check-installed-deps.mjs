#!/usr/bin/env node
// Port of Line A #20 (2.2.33's release was bumped and pushed, then died in the
// bundle step: a dependency merged from another worktree was never installed
// in this checkout's node_modules). Package scripts run this BEFORE building,
// so a node_modules that does not match package.json + pnpm-lock.yaml refuses
// up front instead of shipping or failing late.
//
// Read straight from disk, not `pnpm ls`: inherited config (NODE_ENV, --prod,
// offline flags) changes what a package manager listing checks. For every
// direct dependency and devDependency in package.json:
//   - pnpm-lock.yaml's root importer must record it with the same specifier
//     (else the lockfile is out of date for package.json), and
//   - node_modules/<name>/package.json must be installed at the locked version
//     (link: and file: dependencies need only be installed).
// optionalDependencies are skipped: a platform may legitimately lack them.
//
// node_modules may be a symlink to another checkout's install (worktrees share
// one); it is followed, so the check judges the install this checkout builds
// with.
//
// Usage: node config/scripts/check-installed-deps.mjs [--project <dir>]
//   exit 0  node_modules matches; exit 1  mismatches listed; exit 2  unreadable inputs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'

/** The installed version a locked `version:` value asks for, or a link/file marker. */
export function lockedVersionWanted(lockedVersion) {
  const raw = String(lockedVersion ?? '').trim()
  if (!raw) {
    return null
  }
  if (/^(link|file):/.test(raw)) {
    return { presenceOnly: true, label: raw.replace(/\(.*$/, '') }
  }
  // Why: pnpm appends peer and patch context in parentheses
  // ("0.3.201(zod@4.4.3)"); an npm: alias locks as "real-name@1.2.3".
  const withoutContext = raw.replace(/\(.*$/, '')
  const at = withoutContext.lastIndexOf('@')
  const version = at > 0 ? withoutContext.slice(at + 1) : withoutContext
  return { presenceOnly: false, label: version, version }
}

/**
 * Pure. `readInstalledVersion(name)` returns the installed package.json's
 * version, null when it is not installed, or throws for an unreadable one.
 * Returns one line per problem (empty when node_modules matches).
 */
export function findInstalledDepMismatches({ packageJson, lockfile, readInstalledVersion }) {
  const importer = lockfile?.importers?.['.'] ?? {}
  const locked = { ...importer.dependencies, ...importer.devDependencies }
  const wanted = { ...packageJson.dependencies, ...packageJson.devDependencies }
  const problems = []
  for (const name of Object.keys(wanted).sort()) {
    const entry = locked[name]
    if (!entry) {
      problems.push(`${name}: not in pnpm-lock.yaml (run pnpm install)`)
      continue
    }
    if (entry.specifier !== undefined && entry.specifier !== wanted[name]) {
      problems.push(
        `${name}: package.json asks for ${wanted[name]}, pnpm-lock.yaml was made for ${entry.specifier} (run pnpm install)`
      )
      continue
    }
    const want = lockedVersionWanted(entry.version)
    if (!want) {
      problems.push(`${name}: pnpm-lock.yaml records no version`)
      continue
    }
    let have
    try {
      have = readInstalledVersion(name)
    } catch (error) {
      problems.push(`${name}: installed package.json is unreadable (${error.code || error.message})`)
      continue
    }
    if (have === null) {
      problems.push(`${name}: not installed, lockfile has ${want.label} (run pnpm install)`)
    } else if (!want.presenceOnly && have !== want.version) {
      problems.push(`${name}: installed ${have}, lockfile has ${want.version} (run pnpm install)`)
    }
  }
  return problems
}

function readInstalledVersionFrom(projectDir) {
  return (name) => {
    let text
    try {
      text = readFileSync(path.join(projectDir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        return null
      }
      throw error
    }
    return JSON.parse(text).version ?? ''
  }
}

export function main(argv = process.argv.slice(2)) {
  const projectFlag = argv.indexOf('--project')
  const projectDir =
    projectFlag >= 0 && argv[projectFlag + 1]
      ? path.resolve(argv[projectFlag + 1])
      : path.resolve(import.meta.dirname, '../..')
  let packageJson
  let lockfile
  try {
    packageJson = JSON.parse(readFileSync(path.join(projectDir, 'package.json'), 'utf8'))
    lockfile = parse(readFileSync(path.join(projectDir, 'pnpm-lock.yaml'), 'utf8'))
  } catch (error) {
    console.error(`ERROR: cannot read package.json / pnpm-lock.yaml in ${projectDir}: ${error.message}`)
    return 2
  }
  const problems = findInstalledDepMismatches({
    packageJson,
    lockfile,
    readInstalledVersion: readInstalledVersionFrom(projectDir)
  })
  if (problems.length > 0) {
    console.error(
      `ERROR: node_modules does not match package.json and pnpm-lock.yaml (${problems.length}):\n  ${problems.join('\n  ')}`
    )
    return 1
  }
  const count = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies }).length
  console.log(`installed deps OK: ${count} direct dependencies match pnpm-lock.yaml`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main()
}
