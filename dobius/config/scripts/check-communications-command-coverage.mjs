// Package 0 of plans/BUZZ-COMMUNICATIONS-TAKEOVER.md: a checked manifest of
// every native command the vendored Buzz renderer calls, plus a build gate
// that fails on an unclassified command or a production import of the
// test-only e2e fixture bridge. The manifest is regenerated from source on
// every run — it is a derived artifact, not hand-maintained, so it cannot
// silently drift from what the renderer actually calls.

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

import { classifyCommand } from './communications-command-classification.mjs'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const SKIP_PATH_PARTS = new Set(['node_modules', 'dist', 'out', '.git', 'testing'])
const INVOKE_CALL_PATTERN = /\binvoke(?:Tauri)?\s*(?:<[^>]*>)?\s*\(\s*["']([a-zA-Z][a-zA-Z0-9_]*)["']/g
const E2E_BRIDGE_IMPORT_PATTERN = /from\s+["'][^"']*testing\/e2eBridge[^"']*["']/
const BRIDGE_CASE_PATTERN = /case\s+["']([a-zA-Z][a-zA-Z0-9_]*)["']\s*:/g

export function normalizePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function isTestFile(relativePath) {
  return relativePath.includes('.test.') || relativePath.includes('.spec.')
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
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Scan every production (non-test) source file under `rendererRoot` for
 * `invoke("command_name", ...)` / `invokeTauri("command_name", ...)` calls.
 * Returns a Map of command name -> first call-site (relative file:line).
 */
export async function scanBuzzCommands(rendererRoot) {
  const files = await collectSourceFiles(rendererRoot, rendererRoot)
  const commands = new Map()

  for (const filePath of files) {
    const relative = normalizePath(rendererRoot, filePath)
    if (isTestFile(relative)) continue

    const text = await fs.readFile(filePath, 'utf8')
    for (const match of text.matchAll(INVOKE_CALL_PATTERN)) {
      const command = match[1]
      if (!commands.has(command)) {
        const line = text.slice(0, match.index).split('\n').length
        commands.set(command, `${relative}:${line}`)
      }
    }
  }

  return commands
}

/**
 * Find every production file that imports the test-only e2e fixture bridge.
 * A production import means fixture behavior could ship instead of real
 * Dobius-backed behavior.
 */
export async function findE2eBridgeLeaks(rendererRoot) {
  const files = await collectSourceFiles(rendererRoot, rendererRoot)
  const leaks = []

  for (const filePath of files) {
    const relative = normalizePath(rendererRoot, filePath)
    if (isTestFile(relative)) continue

    const text = await fs.readFile(filePath, 'utf8')
    if (E2E_BRIDGE_IMPORT_PATTERN.test(text)) {
      leaks.push(relative)
    }
  }

  return leaks
}

/**
 * Ground truth for "implemented": the actual `case "command":` labels in the
 * Dobius communications bridge's dispatch switch, not a hand-maintained list.
 */
export function scanImplementedCommands(bridgeSource) {
  const implemented = new Set()
  for (const match of bridgeSource.matchAll(BRIDGE_CASE_PATTERN)) {
    implemented.add(match[1])
  }
  return implemented
}

/**
 * Build the coverage manifest: one entry per command found in production
 * source, classified by destination and cross-checked against what the
 * bridge actually implements today.
 */
export function buildManifest(commands, implementedCommands) {
  const entries = []
  const unclassified = []

  for (const [command, callSite] of commands) {
    const classification = classifyCommand(command)
    if (!classification) {
      unclassified.push(command)
      entries.push({
        command,
        disposition: null,
        package: null,
        feature: null,
        status: 'unclassified',
        callSite,
        implemented: false
      })
      continue
    }

    const implemented = implementedCommands.has(command)
    const status =
      classification.disposition === 'removed'
        ? 'removed-pending'
        : implemented
          ? 'implemented'
          : 'pending'

    entries.push({
      command,
      disposition: classification.disposition,
      package: classification.package,
      feature: classification.feature,
      status,
      callSite,
      implemented
    })
  }

  entries.sort((a, b) => a.command.localeCompare(b.command))
  return { entries, unclassified }
}

function summarize(entries) {
  const counts = {}
  for (const entry of entries) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1
  }
  return counts
}

export async function main(root = process.cwd()) {
  const rendererRoot = path.join(root, 'vendor', 'buzz-desktop', 'src')
  const bridgePath = path.join(rendererRoot, 'shared', 'api', 'dobiusCommunications.ts')
  const manifestPath = path.join(root, 'src', 'main', 'communications', 'command-manifest.json')

  const [commands, bridgeSource, leaks] = await Promise.all([
    scanBuzzCommands(rendererRoot),
    fs.readFile(bridgePath, 'utf8').catch(() => ''),
    findE2eBridgeLeaks(rendererRoot)
  ])

  const implementedCommands = scanImplementedCommands(bridgeSource)
  const { entries, unclassified } = buildManifest(commands, implementedCommands)
  const counts = summarize(entries)

  const manifest = {
    generatedFrom: 'config/scripts/check-communications-command-coverage.mjs',
    totalCommands: entries.length,
    counts,
    entries
  }
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(
    `Communications command coverage: ${entries.length} commands, ` +
      `${counts.implemented ?? 0} implemented, ${counts.pending ?? 0} pending, ` +
      `${counts['removed-pending'] ?? 0} awaiting removal, ${unclassified.length} unclassified.`
  )
  console.log(`Manifest written to ${normalizePath(root, manifestPath)}`)

  let failed = false

  if (unclassified.length > 0) {
    failed = true
    console.error('')
    console.error('Unclassified commands (add a rule to communications-command-classification.mjs):')
    for (const command of unclassified) {
      console.error(`  ${command}  (${commands.get(command)})`)
    }
  }

  if (leaks.length > 0) {
    failed = true
    console.error('')
    console.error('Production files importing the test-only e2e fixture bridge:')
    for (const file of leaks) {
      console.error(`  ${file}`)
    }
  }

  return failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}
