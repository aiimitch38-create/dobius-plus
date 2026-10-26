import { describe, expect, it } from 'vitest'
import type { BoardCard, BoardCardOf } from '@/store/slices/board'
import {
  browserHandoffText,
  browserLinkCables,
  browserLinkIdentity,
  browserVerifyText,
  consoleDriverAgentId,
  consoleDriverName,
  consoleForDriverAgentId,
  driverConsoleOf,
  tilesDrivenBy
} from './browser-link'

const base = { x: 0, y: 0, w: 100, h: 100, z: 1 }
const consoleCard = (id: string, title: string): BoardCardOf<'console'> => ({
  ...base,
  id,
  kind: 'console',
  tabId: `tab-${id}`,
  agentKind: 'claude',
  title
})
const tile = (id: string, driverCardId?: string): BoardCardOf<'web'> => ({
  ...base,
  id,
  kind: 'web',
  url: 'http://localhost:5173/',
  title: 'Preview',
  ...(driverCardId ? { driverCardId } : {})
})

const CLAUDE_1 = consoleCard('3f1c9a2b-0000-4000-8000-000000000001', 'Claude 1')

describe('console driver identity', () => {
  it('derives console-<first 8 chars> and a lowercase, pattern-safe id', () => {
    expect(consoleDriverAgentId(CLAUDE_1.id)).toBe('console-3f1c9a2b')
    expect(consoleDriverAgentId('ABC DEF!!')).toBe('console-abc-def-')
    expect(consoleDriverAgentId(CLAUDE_1.id)).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/)
  })

  it('names the cursor after the card title, never a reserved name', () => {
    expect(consoleDriverName('Claude 1', 'console-3f1c9a2b')).toBe('Claude 1')
    expect(consoleDriverName('Carson', 'console-3f1c9a2b')).toBe('Console-3f1c9a2b')
    expect(consoleDriverName('', 'console-3f1c9a2b')).toBe('Console-3f1c9a2b')
    expect(consoleDriverName('x'.repeat(40), 'console-3f1c9a2b')).toBe('Console-3f1c9a2b')
  })

  it('finds the console behind a driver agent id and ignores other ids', () => {
    const cards: BoardCard[] = [CLAUDE_1, tile('t1')]
    expect(consoleForDriverAgentId(cards, 'console-3f1c9a2b')?.title).toBe('Claude 1')
    expect(consoleForDriverAgentId(cards, 'adam')).toBeNull()
    expect(consoleForDriverAgentId(cards, 'console-ffffffff')).toBeNull()
  })

  it('bundles page id, agent id and name', () => {
    expect(browserLinkIdentity(tile('t1'), CLAUDE_1)).toEqual({
      pageId: 'web-tile:t1',
      agentId: 'console-3f1c9a2b',
      name: 'Claude 1'
    })
  })
})

describe('driver links', () => {
  it("resolves a tile's driver only while that console is on the board", () => {
    expect(driverConsoleOf([CLAUDE_1, tile('t1', CLAUDE_1.id)], tile('t1', CLAUDE_1.id))?.id).toBe(
      CLAUDE_1.id
    )
    expect(driverConsoleOf([tile('t1', CLAUDE_1.id)], tile('t1', CLAUDE_1.id))).toBeNull()
    expect(driverConsoleOf([CLAUDE_1], tile('t1'))).toBeNull()
  })

  it('lists the tiles a console drives', () => {
    const cards = [CLAUDE_1, tile('t1', CLAUDE_1.id), tile('t2'), tile('t3', CLAUDE_1.id)]
    expect(tilesDrivenBy(cards, CLAUDE_1.id).map((t) => t.id)).toEqual(['t1', 't3'])
  })

  it('draws one cable per driven tile, from the console, watching its tab', () => {
    const cables = browserLinkCables({
      cards: [CLAUDE_1, tile('t1', CLAUDE_1.id), tile('t2', 'gone')]
    })
    expect(cables).toEqual([
      {
        id: `${CLAUDE_1.id}->tile:t1`,
        from: CLAUDE_1,
        to: tile('t1', CLAUDE_1.id),
        orchestratorId: CLAUDE_1.id,
        targetTabIds: [CLAUDE_1.tabId]
      }
    ])
  })
})

describe('handoff and verify texts', () => {
  const flags = '--page web-tile:t1 --as console-3f1c9a2b'

  it('handoff names the page id, the agent id and the real CLI commands', () => {
    const text = browserHandoffText(tile('t1'), CLAUDE_1)
    expect(text).toContain('page id is web-tile:t1')
    expect(text).toContain('agent id console-3f1c9a2b')
    expect(text).toContain('You drive it as Claude 1')
    for (const cmd of [
      'snapshot',
      'click --element <ref>',
      'hover --element <ref>',
      'screenshot'
    ]) {
      expect(text).toContain(`dobius ${cmd} ${flags}`)
    }
    expect(text).toContain(`dobius goto --url "http://localhost:5173/" ${flags}`)
    expect(text).toContain('Never log in')
    expect(text).toContain(
      'dobius tasks attach --id <task-id> --file shot.png --by console-3f1c9a2b'
    )
    // Why: agent ids and page ids never carry quotes, so the text pastes cleanly.
    expect(text).not.toMatch(/--as "/)
    expect(text).toContain('ALWAYS pass --as console-3f1c9a2b')
    expect(text).toContain('Never use dobius computer')
  })

  it('keeps an interpolated title / url to one clean line', () => {
    const nasty = {
      ...tile('t1'),
      title: 'Pre\nview\u0007 x',
      url: 'http://localhost:1/\r\nrm -rf'
    }
    const text = browserHandoffText(nasty, CLAUDE_1)
    expect(text).toContain('web tile "Pre view x"')
    expect(text).toContain('dobius goto --url "http://localhost:1/ rm -rf"')
    expect(text.split('\n').every((line) => !/[\u0000-\u001f]/.test(line))).toBe(true)
  })

  it('verify asks for a reload, a cursor walk, before/after shots and a report', () => {
    const text = browserVerifyText(tile('t1'), CLAUDE_1)
    expect(text).toContain(`dobius goto --url "http://localhost:5173/" ${flags}`)
    expect(text).toMatch(/BEFORE screenshot/)
    expect(text).toMatch(/AFTER screenshots/)
    expect(text).toContain('non-destructive controls only')
    expect(text).toContain('what is fixed and what is still wrong')
    expect(text).toContain('--by console-3f1c9a2b')
  })
})
