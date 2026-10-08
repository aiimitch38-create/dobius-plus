// Uses real, short-lived OS processes with fake terminal metadata; never changes a user's terminal.
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { snapshot } from './terminal-priority.mjs'
import { TerminalPriority } from './terminal-priority-policy.mjs'
import assert from 'node:assert/strict'

const terminals = ['research', 'build'].map((title) => ({
  title, handle: `term_priority-proof-${title}-${process.pid}`, connected: true
}))
// Apple's get_background_proc queries current_task's external policy when who differs
// from the caller. Probe inside each fixture, not from a separate observer process.
// https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_resource.c
const children = terminals.map((terminal) => spawn('/usr/bin/python3',
  ['-u', '-c', 'import ctypes,os,sys\nc=ctypes.CDLL(None)\nfor line in sys.stdin: print(c.getpriority(4,os.getppid()),flush=True)', 'codex-priority-proof'],
  { env: { ...process.env, DOBIUS_TERMINAL_HANDLE: terminal.handle }, stdio: ['pipe', 'pipe', 'inherit'] }))
const exits = children.map((child) => once(child, 'exit'))
await new Promise((resolve) => setTimeout(resolve, 250))
const changes = []
const priority = async (child) => {
  const output = once(child.stdout, 'data')
  child.stdin.write('probe\n')
  return Number((await output)[0].toString().trim())
}
const supervisor = new TerminalPriority({
  snapshot: async () => {
    const live = await snapshot()
    // These are owned isolated fixtures, not clients of the shared app server.
    for (const row of live.rows) row.sharedServer = false
    return { ...live, terminals }
  },
  apply: async (flag, pid) => {
    assert.ok(children.some((child) => child.pid === pid))
    execFileSync('/usr/sbin/taskpolicy', [flag, '-p', String(pid)])
    changes.push([flag, pid])
  }
})
await supervisor.tick()
assert.ok(changes.some(([flag, pid]) => flag === '-b' && pid === children[0].pid))
assert.ok(!changes.some(([flag, pid]) => flag === '-b' && pid === children[1].pid))
const values = await Promise.all(children.map(priority))
console.log('Darwin external-background policy values:', values)
assert.deepEqual(values, [1, 0])
console.log(execFileSync('/bin/ps', ['-o', 'pid,stat,comm', '-p', children.map((child) => child.pid).join(',')], { encoding: 'utf8' }))
terminals[0].title = 'repair'
await supervisor.tick()
assert.ok(changes.some(([flag, pid]) => flag === '-B' && pid === children[0].pid))
assert.equal(await priority(children[0]), 0)
console.log('Retitle restored default:')
console.log(execFileSync('/bin/ps', ['-o', 'pid,stat,comm', '-p', children.map((child) => child.pid).join(',')], { encoding: 'utf8' }))
for (const child of children) child.stdin.end()
await Promise.all(exits)
