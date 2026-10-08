#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { TerminalPriority, parseProcesses } from './terminal-priority-policy.mjs'

const exec = promisify(execFile)
const env = { ...process.env, LC_ALL: 'C' }
// Priority is local. An inherited SSH/runtime selector must never supply foreign PIDs.
for (const key of ['DOBIUS_PAIRING_CODE', 'DOBIUS_REMOTE_PAIRING', 'DOBIUS_ENVIRONMENT', 'DOBIUS_TERMINAL_HANDLE']) delete env[key]
const cli = process.env.DOBIUS_PRIORITY_CLI || '/usr/local/bin/dobius'

async function command(file, args) {
  return (await exec(file, args, { env, timeout: 8000, maxBuffer: 8 * 1024 * 1024 })).stdout
}

export async function snapshot() {
  const [listed, processes, executableNames, listeners] = await Promise.all([
    command(cli, ['terminal', 'list', '--json']),
    command('/bin/ps', ['eww', '-axo', 'pid=,ppid=,uid=,lstart=,command=']),
    command('/bin/ps', ['-axo', 'pid=,comm=']),
    command('/usr/sbin/lsof', ['-nP', '-iTCP:8081', '-sTCP:LISTEN', '-Fp'])
  ])
  const response = JSON.parse(listed)
  if (!response.ok || !Array.isArray(response.result?.terminals)) throw new Error('terminal discovery unavailable')
  const appPids = executableNames.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/)
    return match && match[2].endsWith('/Dobius+.app/Contents/MacOS/Dobius+') ? [Number(match[1])] : []
  })
  return { terminals: response.result.terminals, rows: parseProcesses(processes), appPids,
    metroPids: [...listeners.matchAll(/^p(\d+)$/gm)].map((match) => Number(match[1])),
    uid: process.getuid(), selfPid: process.pid }
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('terminal priority requires macOS taskpolicy')
  const directory = process.env.DOBIUS_PRIORITY_STATE_DIR || join(homedir(), 'Library', 'Application Support', 'dobius-priority')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const statePath = join(directory, 'applied.json')
  let saved = []
  try { saved = JSON.parse(await readFile(statePath, 'utf8')) } catch { /* First run. */ }
  const applied = new Set(Array.isArray(saved) ? saved.filter((entry) => typeof entry === 'string') : [])
  const dryRun = process.argv.includes('--dry-run')
  const supervisor = new TerminalPriority({ snapshot, applied,
    apply: async (flag, pid) => {
      if (dryRun) console.log(`[terminal-priority] dry run ${flag} PID ${pid}`)
      else await command('/usr/sbin/taskpolicy', [flag, '-p', String(pid)])
    }
  })
  do {
    try {
      await supervisor.tick()
      if (!dryRun) {
        await writeFile(`${statePath}.tmp`, `${JSON.stringify([...applied])}\n`, { mode: 0o600 })
        await rename(`${statePath}.tmp`, statePath)
      }
    } catch {
      // Command output can include terminal contents or environment secrets. Never print it.
      console.error('[terminal-priority] discovery/apply failed; no guessed priority changes')
      if (process.argv.includes('--once')) process.exitCode = 1
    }
    if (process.argv.includes('--once')) break
    await new Promise((resolve) => setTimeout(resolve, 12000))
  } while (true)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
