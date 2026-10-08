import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TerminalPriority, priorityDecisions, parseProcesses, terminalTier } from './terminal-priority-policy.mjs'

const row = (pid, handle, parent = 1) => ({ pid, handle, parent, uid: 501, started: 'Thu Oct 8 00:00:00 2026' })
function fixture() {
  const state = { uid: 501, selfPid: 90, appPids: [10], metroPids: [20],
    rows: [row(10, 'term_app'), row(20, 'term_metro'), row(30, 'term_work'), row(90, null)],
    terminals: [
      { handle: 'term_app', connected: true, title: 'research' },
      { handle: 'term_metro', connected: true, title: 'verify' },
      { handle: 'term_work', connected: true, title: 'research' }
    ] }
  const changes = []
  const logs = []
  const supervisor = new TerminalPriority({ snapshot: async () => state,
    apply: async (flag, pid) => changes.push([flag, pid]), log: (line) => logs.push(line) })
  return { state, changes, logs, supervisor }
}

test('Tier 1 is skipped despite a Tier 3 title and records the reason', async () => {
  const f = fixture()
  await f.supervisor.tick()
  assert.deepEqual(f.changes, [['-b', 30]])
  assert.ok(f.logs.some((line) => line.includes('Metro listener on 8081')))
  assert.ok(f.logs.some((line) => line.includes('Dobius+ main process')))
})

test('retitle restores default, including new descendants that inherited background', async () => {
  const f = fixture()
  await f.supervisor.tick()
  f.state.terminals[2].title = 'rebuild'
  f.state.rows.push(row(31, 'term_work', 30))
  await f.supervisor.tick()
  assert.deepEqual(f.changes, [['-b', 30], ['-B', 30], ['-B', 31]])
})

test('recreated terminal process is reclassified and an unresolved PID is skipped', async () => {
  const f = fixture()
  f.state.terminals.push({ handle: 'term_unknown', connected: true, title: 'verify' })
  await f.supervisor.tick()
  f.state.rows[2] = row(32, 'term_work')
  await f.supervisor.tick()
  assert.deepEqual(f.changes, [['-b', 30], ['-b', 32]])
  assert.ok(f.logs.some((line) => line.includes('PID unresolved')))
})

test('Metro protection uses the port owner, even for an unrelated command name', () => {
  const f = fixture()
  f.state.metroPids = [30]
  const actions = priorityDecisions(f.state).filter((entry) => entry.action !== 'skip')
  assert.ok(!actions.some((entry) => entry.pid === 30))
})

test('protects Metro ancestors, foreign users and shared agent servers', () => {
  const f = fixture()
  f.state.rows[1].parent = 30
  f.state.rows.push({ ...row(40, 'term_work'), uid: 502 },
    { ...row(50, 'term_work'), sharedServer: true }, row(51, 'term_work', 50))
  assert.deepEqual(priorityDecisions(f.state).filter((entry) => entry.action !== 'skip'), [])
})

test('missing protection evidence fails closed', async () => {
  const f = fixture()
  f.state.metroPids = []
  await f.supervisor.tick()
  assert.deepEqual(f.changes, [])
})

test('rechecks identity and new Metro listener before applying a stale decision', async () => {
  for (const mutate of [(f) => { f.state.rows[2].started = 'new process' },
    (f) => { f.state.metroPids = [30] }, (f) => { f.state.terminals[2].title = 'build' }]) {
    const f = fixture()
    let calls = 0
    f.supervisor.snapshot = async () => {
      if (++calls === 2) mutate(f)
      return f.state
    }
    await f.supervisor.tick()
    assert.deepEqual(f.changes, [])
  }
})

test('parses only exact terminal environment markers; never retains environment text', () => {
  const rows = parseProcesses(' 30 1 501 Thu Oct  8 00:00:00 2026 node codex DOBIUS_TERMINAL_HANDLE=term_work TOKEN=private')
  assert.equal(rows[0].handle, 'term_work')
  assert.ok(!JSON.stringify(rows).includes('private'))
  assert.equal(parseProcesses('bad row').length, 0)
  assert.equal(terminalTier('research and verify'), 3)
  assert.equal(terminalTier('build repair rebuild'), 2)
  assert.equal(terminalTier('ordinary terminal'), 2)
})
