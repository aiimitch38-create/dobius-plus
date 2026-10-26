import { beforeEach, describe, expect, it } from 'vitest'
import { ConsoleTileBindings } from './console-tile-bindings'

describe('ConsoleTileBindings', () => {
  let bindings: ConsoleTileBindings
  beforeEach(() => {
    bindings = new ConsoleTileBindings()
  })

  it('refuses an unconnected console, allows its own tile, refuses another', () => {
    expect(bindings.refusal('console-3f1c9a2b', 'tile-1')).toContain('not connected')
    bindings.replaceAll([{ agentId: 'console-3f1c9a2b', tileId: 'tile-1' }])
    expect(bindings.refusal('console-3f1c9a2b', 'tile-1')).toBeNull()
    expect(bindings.refusal('console-3f1c9a2b', 'tile-2')).toContain('web-tile:tile-1')
  })

  it('a disconnect (sync without the link) revokes the tile', () => {
    bindings.replaceAll([{ agentId: 'console-3f1c9a2b', tileId: 'tile-1' }])
    bindings.replaceAll([])
    expect(bindings.refusal('console-3f1c9a2b', 'tile-1')).toContain('not connected')
  })

  it('dropTile revokes just that tile (guest unregistered)', () => {
    bindings.replaceAll([
      { agentId: 'console-3f1c9a2b', tileId: 'tile-1' },
      { agentId: 'console-3f1c9a2b', tileId: 'tile-2' }
    ])
    bindings.dropTile('tile-1')
    expect(bindings.refusal('console-3f1c9a2b', 'tile-1')).toContain('web-tile:tile-2')
    expect(bindings.refusal('console-3f1c9a2b', 'tile-2')).toBeNull()
    bindings.dropTile('tile-2')
    expect(bindings.refusal('console-3f1c9a2b', 'tile-2')).toContain('not connected')
  })

  it('leaves non-console identities alone and ignores them in a sync', () => {
    bindings.replaceAll([{ agentId: 'adam', tileId: 'tile-1' }])
    expect(bindings.tilesFor('adam')).toEqual([])
    expect(bindings.refusal('adam', 'tile-9')).toBeNull()
  })

  it('validates the IPC payload', () => {
    expect(() => bindings.parse({ bindings: [{ agentId: 'Console X', tileId: 't' }] })).toThrow()
    expect(() => bindings.parse({ bindings: [], extra: 1 })).toThrow()
    expect(bindings.parse({ bindings: [{ agentId: 'console-1', tileId: 't' }] })).toEqual([
      { agentId: 'console-1', tileId: 't' }
    ])
  })
})
