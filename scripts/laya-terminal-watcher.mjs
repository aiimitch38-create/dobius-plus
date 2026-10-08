#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { checkpointFilename, classifyTerminal, reconcileCheckpoint, terminalIdentity } from './terminal-infrastructure-policy.mjs'

const exec = promisify(execFile)
const cli = process.env.DOBIUS_WATCH_CLI || '/usr/local/bin/dobius'
const stateRoot = process.env.DOBIUS_TERMINAL_STATE_DIR || join(homedir(), 'Library', 'Application Support', 'dobius-terminal')

export class TerminalWatcher {
  constructor({ list, readDelta, readCheckpoint, writeCheckpoint, emit, now = Date.now }) {
    Object.assign(this, { list, readDelta, readCheckpoint, writeCheckpoint, emit, now })
    this.cursors = new Map()
    this.labels = new Map()
  }

  async tick() {
    const terminals = await this.list()
    for (const terminal of terminals) {
      const id = terminalIdentity(terminal)
      if (!id) continue
      let checkpoint = await this.readCheckpoint(terminal)
      if (checkpoint) {
        const reconciled = reconcileCheckpoint(checkpoint, (pid) => { try { process.kill(pid, 0); return true } catch { return false } })
        if (reconciled?.reconciled) { checkpoint = reconciled; await this.writeCheckpoint(terminal, checkpoint) }
      }
      const delta = await this.readDelta(terminal, this.cursors.get(id) || 0)
      this.cursors.set(id, delta.cursor)
      const result = classifyTerminal({ checkpoint, delta: delta.text, exitCode: terminal.exitCode, now: this.now() })
      if (this.labels.get(id) !== result.label) {
        const previous = this.labels.get(id) || null
        this.labels.set(id, result.label)
        this.emit({ terminalId: id, previous, ...result, at: new Date(this.now()).toISOString() })
      }
    }
  }
}

async function listTerminals() {
  const output = await exec(cli, ['terminal', 'list', '--json'], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 })
  const parsed = JSON.parse(output.stdout)
  if (!parsed.ok || !Array.isArray(parsed.result?.terminals)) throw new Error('terminal discovery unavailable')
  return parsed.result.terminals
}

async function checkpointForTerminal(terminal) {
  const file = checkpointFilename(stateRoot, terminal)
  if (!file) return null
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return null }
}

async function writeCheckpoint(terminal, checkpoint) {
  await mkdir(stateRoot, { recursive: true, mode: 0o700 })
  const file = checkpointFilename(stateRoot, terminal)
  if (file) await writeFile(file, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 })
}

async function readDelta(terminal, cursor) {
  const path = terminal.outputPath || terminal.logPath || terminal.rawOutputPath
  if (!path || !existsSync(path)) return { text: '', cursor }
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    const start = Math.min(cursor, stat.size)
    const buffer = Buffer.alloc(stat.size - start)
    if (buffer.length) await handle.read(buffer, 0, buffer.length, start)
    return { text: buffer.toString('utf8'), cursor: stat.size }
  } finally { await handle.close() }
}

export function createWatcher(deps = {}) {
  return new TerminalWatcher({ list: listTerminals, readDelta, readCheckpoint: checkpointForTerminal,
    writeCheckpoint, emit: (event) => console.log(`[laya-watch] ${JSON.stringify(event)}`), ...deps })
}

export async function runOnce(deps = {}) {
  const watcher = createWatcher(deps)
  await watcher.tick()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await mkdir(stateRoot, { recursive: true, mode: 0o700 })
  if (process.argv.includes('--once')) { await runOnce(); process.exit(0) }
  const watcher = createWatcher()
  while (true) { try { await watcher.tick() } catch { console.error('[laya-watch] discovery/read failed; retaining last state') } await new Promise((resolve) => setTimeout(resolve, 5000)) }
}
