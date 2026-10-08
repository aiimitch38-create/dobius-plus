import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkpointFor, classifyTerminal, envrcFor, laneManifest, reconcileCheckpoint } from './terminal-infrastructure-policy.mjs'
import { createLane } from './terminal-lane.mjs'
import { TerminalWatcher } from './laya-terminal-watcher.mjs'
import { proceduralQuestionGate } from './terminal-question-gate.mjs'

test('lane manifest is deterministic and provider-neutral', () => {
  const manifest = laneManifest({ laneId: 'lane-a', worktree: '/tmp/lane-a', basePort: 4400 })
  assert.equal(manifest.env.LANE_ID, 'lane-a')
  assert.equal(manifest.env.PORT_BASE, '4400')
  assert.match(envrcFor(manifest), /DOBIUS_LANE_RUNTIME_PATH/)
})

test('lane creation writes envrc and manifest without agent assumptions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dobius-lane-'))
  const manifest = await createLane({ laneId: 'plain-shell', worktree: root, basePort: 4500, stateRoot: join(root, '.state') })
  assert.equal((await readFile(manifest.envrc, 'utf8')).includes('LANE_ID'), true)
})

test('running checkpoint with dead process is reconciled to failed/interrupted', () => {
  const checkpoint = checkpointFor({ terminalId: 'term-plain', provider: 'shell', state: 'running', ownedPids: [99999] })
  const result = reconcileCheckpoint(checkpoint, () => false)
  assert.equal(result.reconciled, true)
  assert.equal(result.state, 'failed')
  assert.match(result.interruption, /interrupted/)
})

test('hard checkpoint and exit signals win over ambiguous text', () => {
  assert.equal(classifyTerminal({ checkpoint: { state: 'waiting_external' }, delta: 'working...', exitCode: null }).label, 'needs-human')
  assert.equal(classifyTerminal({ checkpoint: { state: 'running' }, delta: 'all good', exitCode: 1 }).label, 'failed')
})

test('watcher tails each terminal incrementally and emits only transitions', async () => {
  const states = new Map([['codex', { state: 'running', ownedPids: [], updatedAt: new Date().toISOString() }], ['shell', { state: 'running', ownedPids: [], updatedAt: new Date().toISOString() }]])
  const tails = new Map([['codex', { text: 'building 1/2\n', cursor: 12 }], ['shell', { text: 'permission: allow\n', cursor: 18 }]])
  const events = []
  const watcher = new TerminalWatcher({ list: async () => [{ id: 'codex' }, { id: 'shell' }],
    readCheckpoint: async (terminal) => states.get(terminal.id), writeCheckpoint: async () => {},
    readDelta: async (terminal) => tails.get(terminal.id), emit: (event) => events.push(event) })
  await watcher.tick(); await watcher.tick()
  assert.deepEqual(events.map((event) => [event.terminalId, event.label]), [['codex', 'working'], ['shell', 'waiting-permission']])
})

test('procedural questions require both vault and relevant skill evidence', () => {
  assert.equal(proceduralQuestionGate({ vaultHits: 0, relevantHits: 1, question: 'where?' }).allowed, false)
  assert.equal(proceduralQuestionGate({ vaultHits: 1, relevantHits: 1, question: 'where?' }).allowed, true)
})
