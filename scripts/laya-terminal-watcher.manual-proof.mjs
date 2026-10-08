#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { TerminalWatcher } from './laya-terminal-watcher.mjs'

const processes = [
  { id: 'codex-proof', provider: 'codex', child: spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)']) },
  { id: 'shell-proof', provider: 'shell', child: spawn('/bin/sh', ['-c', 'sleep 10']) },
]
const checkpoints = new Map(processes.map(({ id, provider, child }) => [id, {
  version: 1, provider, terminalId: id, state: 'running', ownedPids: [child.pid], updatedAt: new Date().toISOString()
}]))
const deltas = new Map(processes.map(({ id }) => [id, { text: id === 'codex-proof' ? 'working\n' : 'permission: allow\n', cursor: 1 }]))
const events = []
const watcher = new TerminalWatcher({
  list: async () => processes.map(({ id, provider, child }) => ({ id, provider, pid: child.pid })),
  readCheckpoint: async (terminal) => checkpoints.get(terminal.id),
  writeCheckpoint: async (terminal, checkpoint) => checkpoints.set(terminal.id, checkpoint),
  readDelta: async (terminal) => deltas.get(terminal.id),
  emit: (event) => events.push(event),
})

await watcher.tick()
processes[0].child.kill('SIGTERM')
await once(processes[0].child, 'exit')
await watcher.tick()
assert.ok(events.some((event) => event.terminalId === 'codex-proof' && event.label === 'failed'))
assert.ok(events.some((event) => event.terminalId === 'shell-proof' && event.label === 'waiting-permission'))
console.log(JSON.stringify({ events, codexCheckpoint: checkpoints.get('codex-proof') }, null, 2))
for (const { child } of processes.slice(1)) child.kill('SIGTERM')
