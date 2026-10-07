import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MetroSupervisor } from './metro-supervisor.mjs'

function fixture() {
  const state = { mounted: false, healthy: false, starts: 0, stops: 0, time: 0 }
  const supervisor = new MetroSupervisor({
    available: () => state.mounted,
    healthy: async () => state.healthy,
    start: () => { state.starts++; return { pid: 123, exitCode: null, signalCode: null, alive: true } },
    stop: (child) => { state.stops++; child.alive = false },
    alive: (child) => child.alive,
    now: () => state.time
  })
  return { state, supervisor }
}

test('waits for mount, starts once, stops on disconnect, restarts on remount', async () => {
  const { state, supervisor } = fixture()
  await supervisor.tick()
  assert.equal(state.starts, 0)
  state.mounted = true
  await supervisor.tick()
  await supervisor.tick()
  assert.equal(state.starts, 1)
  state.mounted = false
  await supervisor.tick()
  assert.equal(state.stops, 1)
  state.mounted = true
  await supervisor.tick()
  assert.equal(state.starts, 2)
})

test('adopts a healthy manual server without starting or stopping it', async () => {
  const { state, supervisor } = fixture()
  state.mounted = state.healthy = true
  await supervisor.tick()
  state.mounted = false
  await supervisor.tick()
  assert.equal(state.starts, 0)
  assert.equal(state.stops, 0)
})

test('restarts a crashed child and replaces a persistently unhealthy owned child', async () => {
  const { state, supervisor } = fixture()
  state.mounted = true
  await supervisor.tick()
  supervisor.child.exitCode = 1
  supervisor.child.alive = false
  await supervisor.tick()
  assert.equal(state.starts, 2)
  state.time = 400000
  await supervisor.tick()
  await supervisor.tick()
  await supervisor.tick()
  assert.equal(state.stops, 1)
  await supervisor.tick()
  assert.equal(state.starts, 3)
})

test('does not duplicate a server whose termination is delayed by disk IO', async () => {
  const { state, supervisor } = fixture()
  state.mounted = true
  await supervisor.tick()
  const oldChild = supervisor.child
  supervisor.stop = () => { state.stops++ }
  state.mounted = false
  await supervisor.tick()
  state.mounted = true
  await supervisor.tick()
  assert.equal(state.starts, 1)
  oldChild.alive = false
  await supervisor.tick()
  assert.equal(state.starts, 2)
})

test('waits for an inherited/manual startup before launching a replacement', async () => {
  const { state, supervisor } = fixture()
  state.mounted = true
  supervisor.starting = () => true
  await supervisor.tick()
  assert.equal(state.starts, 0)
  supervisor.starting = () => false
  await supervisor.tick()
  assert.equal(state.starts, 1)
})
