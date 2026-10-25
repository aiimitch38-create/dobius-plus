import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it } from 'vitest'
import { AgentPresenceRegistry, HUMAN_YIELD_MS } from './agent-presence-registry'
import {
  HUMAN_INPUT_YIELD_THROTTLE_MS,
  attachWebTileHumanInput,
  webTileIdFromBrowserPageId
} from './web-tile-human-input'

function fakeGuest() {
  const emitter = new EventEmitter()
  return {
    guest: emitter as unknown as WebContents,
    key: () => emitter.emit('before-input-event', {}, { type: 'keyDown', key: 'a' }),
    input: (type: string) => emitter.emit('input-event', {}, { type }),
    listenerCount: () => emitter.listenerCount('before-input-event') + emitter.listenerCount('input-event')
  }
}

describe('attachWebTileHumanInput', () => {
  it('maps web-tile page ids to tile ids and ignores other pages', () => {
    expect(webTileIdFromBrowserPageId('web-tile:card-1')).toBe('card-1')
    expect(webTileIdFromBrowserPageId('tab-1')).toBeNull()
    const { guest, listenerCount } = fakeGuest()
    attachWebTileHumanInput(guest, 'tab-1', new AgentPresenceRegistry())
    expect(listenerCount()).toBe(0)
  })

  it('renews the tile yield at most once per second while the human types or clicks', () => {
    let t = 10_000
    const registry = new AgentPresenceRegistry(() => t)
    const { guest, key, input } = fakeGuest()
    attachWebTileHumanInput(guest, 'web-tile:card-1', registry, () => t)

    input('mouseMove')
    expect(registry.isYielding('card-1')).toBe(false)
    input('mouseDown')
    expect(registry.isYielding('card-1')).toBe(true)
    t += HUMAN_YIELD_MS - 100
    expect(registry.isYielding('card-1')).toBe(true)
    key() // within the throttle window of nothing; renews
    t += HUMAN_YIELD_MS - 100
    expect(registry.isYielding('card-1')).toBe(true)
    // Throttle: a burst of keys inside one second yields once.
    const before = t
    key()
    t += HUMAN_INPUT_YIELD_THROTTLE_MS - 1
    key()
    expect(registry.clearance('adam', 'card-1')).toBe('yielding')
    t = before + HUMAN_YIELD_MS + 1
    expect(registry.isYielding('card-1')).toBe(false)
  })

  it('does not count input while an agent dispatch is in flight, and detaches cleanly', () => {
    const registry = new AgentPresenceRegistry(() => 50_000)
    const { guest, key, input, listenerCount } = fakeGuest()
    const detach = attachWebTileHumanInput(guest, 'web-tile:card-2', registry)
    const release = registry.markAgentDispatch('card-2')
    key()
    input('mouseDown')
    expect(registry.isYielding('card-2')).toBe(false)
    release()
    release()
    expect(registry.isAgentDispatching('card-2')).toBe(false)
    input('mouseWheel')
    expect(registry.isYielding('card-2')).toBe(true)
    detach()
    expect(listenerCount()).toBe(0)
  })
})
