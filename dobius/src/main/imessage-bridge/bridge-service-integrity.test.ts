import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SyncDatabase from '../sqlite/sync-database'

const mocks = vi.hoisted(() => ({
  allowed: true,
  config: {
    enabled: false,
    triggerPrefix: 'd:',
    selfHandle: '+15551234' as string | null,
    lastSeenRowid: 0
  },
  sendImessage: vi.fn(async (_handle: string, _text: string) => {}),
  handleChannelMessage: vi.fn(async (_args: { text: string }) => 'unhandled' as string)
}))

vi.mock('./imessage-send', () => ({
  sendImessage: mocks.sendImessage,
  countOutboundLastMinute: () => 0
}))
vi.mock('./bridge-config', () => ({
  getImessageBridgeConfig: () => ({ ...mocks.config }),
  updateImessageBridgeConfig: (updates: Partial<typeof mocks.config>) => {
    mocks.config = { ...mocks.config, ...updates }
    return { ...mocks.config }
  }
}))
vi.mock('../agents/agent-channel-service', () => ({
  handleChannelMessage: mocks.handleChannelMessage
}))
vi.mock('../agents/execution-gate', () => ({
  checkExecutionAdmission: () =>
    mocks.allowed
      ? { allowed: true }
      : { allowed: false, reason: 'paused', message: 'Crew is paused.' }
}))

import { bridgeServiceInternals, startImessageBridge } from './bridge-service'

type AgentStatus = { isRunningAgent: boolean; status: string | null }
type SendOptions = { beforeWrite?: (ptyId: string) => void | Promise<void> }

/** Fake runtime terminal: records PTY writes and, like the real runtime's
 *  writeTerminalAction, runs beforeWrite before the text and again before Enter. */
function fakeTerminal(initial: AgentStatus = { isRunningAgent: true, status: 'working' }) {
  const state = { agent: initial, active: 'term-1', writes: [] as string[] }
  const betweenTextAndEnter = vi.fn(() => {})
  const target = {
    resolveActiveTerminal: vi.fn(async () => state.active),
    getTerminalAgentStatus: vi.fn(async (_handle: string) => state.agent),
    sendTerminal: vi.fn(
      async (
        handle: string,
        action: { text?: string; enter?: boolean },
        options: SendOptions = {}
      ) => {
        if (action.text) {
          await options.beforeWrite?.('pty-1')
          state.writes.push(`${handle}:${action.text}`)
        }
        betweenTextAndEnter()
        if (action.enter) {
          await options.beforeWrite?.('pty-1')
          state.writes.push(`${handle}:<enter>`)
        }
      }
    )
  }
  return { state, target, betweenTextAndEnter }
}

function lastReply(): string {
  return String(mocks.sendImessage.mock.calls.at(-1)?.[1] ?? '')
}

beforeEach(() => {
  mocks.allowed = true
  mocks.config = { enabled: false, triggerPrefix: 'd:', selfHandle: '+15551234', lastSeenRowid: 0 }
  mocks.sendImessage.mockClear()
  mocks.handleChannelMessage.mockReset()
  mocks.handleChannelMessage.mockResolvedValue('unhandled')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('#12 iMessage → terminal guard', () => {
  it('refuses an idle shell: nothing is typed and the reply says why', async () => {
    const { state, target } = fakeTerminal({ isRunningAgent: false, status: null })
    await bridgeServiceInternals.dispatchCommand('rm -rf ~/x', '+15551234', target)

    expect(target.sendTerminal).not.toHaveBeenCalled()
    expect(state.writes).toEqual([])
    expect(lastReply()).toContain('not running an agent')
  })

  it('refuses an agent sitting on a permission prompt', async () => {
    const { state, target } = fakeTerminal({ isRunningAgent: true, status: 'permission' })
    await bridgeServiceInternals.dispatchCommand('yes', '+15551234', target)

    expect(state.writes).toEqual([])
    expect(lastReply()).toContain('permission prompt')
  })

  it('accepts an agent target and types the command then Enter into it', async () => {
    const { state, target } = fakeTerminal()
    await bridgeServiceInternals.dispatchCommand('summarize the diff', '+15551234', target)

    expect(state.writes).toEqual(['term-1:summarize the diff', 'term-1:<enter>'])
    expect(lastReply()).toContain('sent to the active Dobius+ terminal')
  })

  it('agent exits between text and Enter: Enter is never written', async () => {
    const { state, target, betweenTextAndEnter } = fakeTerminal()
    betweenTextAndEnter.mockImplementation(() => {
      state.agent = { isRunningAgent: false, status: null }
    })
    await bridgeServiceInternals.dispatchCommand('ls', '+15551234', target)

    expect(state.writes).toEqual(['term-1:ls'])
    expect(lastReply()).toContain('not submitted')
  })

  it('pins the target: a tab switch mid-send never moves the write or the check', async () => {
    const { state, target, betweenTextAndEnter } = fakeTerminal()
    betweenTextAndEnter.mockImplementation(() => {
      state.active = 'term-2'
    })
    await bridgeServiceInternals.dispatchCommand('ls', '+15551234', target)

    expect(target.resolveActiveTerminal).toHaveBeenCalledTimes(1)
    expect(state.writes).toEqual(['term-1:ls', 'term-1:<enter>'])
    for (const call of target.getTerminalAgentStatus.mock.calls) {
      expect(call[0]).toBe('term-1')
    }
  })

  it('Pause crew flipped while the terminal is being resolved stops the send', async () => {
    const { state, target } = fakeTerminal()
    let release: (handle: string) => void = () => {}
    target.resolveActiveTerminal.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        })
    )
    const pending = bridgeServiceInternals.dispatchCommand('ls', '+15551234', target)
    await Promise.resolve()
    mocks.allowed = false
    release('term-1')
    await pending

    expect(state.writes).toEqual([])
    expect(lastReply()).toBe('(Dobius+ crew is paused; command not sent to the terminal)')
  })

  it('Pause crew flipped between text and Enter: Enter is never written', async () => {
    const { state, target, betweenTextAndEnter } = fakeTerminal()
    betweenTextAndEnter.mockImplementation(() => {
      mocks.allowed = false
    })
    await bridgeServiceInternals.dispatchCommand('ls', '+15551234', target)

    expect(state.writes).toEqual(['term-1:ls'])
    expect(lastReply()).toContain('paused mid-send')
  })

  it('never logs the command text', async () => {
    const { target } = fakeTerminal()
    await bridgeServiceInternals.dispatchCommand('secret-token-abc', '+15551234', target)
    const idle = fakeTerminal({ isRunningAgent: false, status: null })
    await bridgeServiceInternals.dispatchCommand('secret-token-abc', '+15551234', idle.target)

    const logged = [
      ...vi.mocked(console.log).mock.calls,
      ...vi.mocked(console.warn).mock.calls
    ].flat()
    expect(logged.join(' ')).not.toContain('secret-token-abc')
  })
})

function createChatDb(): SyncDatabase.Database {
  const database = new SyncDatabase(':memory:')
  database.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT);
    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB,
      is_from_me INTEGER, handle_id INTEGER
    );
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
  `)
  return database
}

function addMessage(
  database: SyncDatabase.Database,
  row: { rowid: number; text: string; fromMe?: boolean; handleId?: number; chatIds?: number[] }
): void {
  database
    .prepare(
      'INSERT INTO message (ROWID, text, attributedBody, is_from_me, handle_id) VALUES (?, ?, NULL, ?, ?)'
    )
    .run(row.rowid, row.text, row.fromMe === false ? 0 : 1, row.handleId ?? 0)
  for (const chatId of row.chatIds ?? []) {
    database
      .prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)')
      .run(chatId, row.rowid)
  }
}

describe('#14 exact self-chat identity', () => {
  function seed(): SyncDatabase.Database {
    const database = createChatDb()
    database.exec(`
      INSERT INTO handle (ROWID, id) VALUES
        (1, '+15551234'), (2, '+155512345'), (3, 'me@x.com'), (4, 'someme@x.com');
      INSERT INTO chat (ROWID, guid, chat_identifier) VALUES
        (10, 'iMessage;-;+15551234', '+15551234'),
        (11, 'iMessage;-;+155512345', '+155512345'),
        (12, 'iMessage;+;chat987', 'chat987'),
        (13, 'iMessage;-;me@x.com', 'me@x.com'),
        (14, 'iMessage;-;someme@x.com', 'someme@x.com'),
        (15, 'SMS;-;+15551234', '+15551234');
    `)
    addMessage(database, { rowid: 1, text: 'self chat', handleId: 1, chatIds: [10] })
    addMessage(database, { rowid: 2, text: 'longer number', handleId: 2, chatIds: [11] })
    addMessage(database, { rowid: 3, text: 'group with self', handleId: 1, chatIds: [12] })
    addMessage(database, {
      rowid: 4,
      text: 'not from me',
      fromMe: false,
      handleId: 1,
      chatIds: [10]
    })
    addMessage(database, { rowid: 5, text: 'no chat link', handleId: 1 })
    addMessage(database, { rowid: 6, text: 'self email', handleId: 3, chatIds: [13] })
    addMessage(database, { rowid: 7, text: 'email superset', handleId: 4, chatIds: [14] })
    addMessage(database, { rowid: 8, text: 'two self chats', handleId: 1, chatIds: [10, 15] })
    return database
  }

  it('phone handle: only its own 1:1 chat, never a longer number or a group', () => {
    const rows = bridgeServiceInternals.readNewSelfMessages(seed(), 0, '+15551234')
    expect(rows.map((row) => row.rowid)).toEqual([1, 5, 8])
  })

  it('email handle: exact (case-insensitive) match only, never a superset address', () => {
    const rows = bridgeServiceInternals.readNewSelfMessages(seed(), 0, 'Me@X.com')
    expect(rows.map((row) => row.rowid)).toEqual([6])
  })

  it('SQL wildcards in the configured handle match nothing', () => {
    expect(bridgeServiceInternals.readNewSelfMessages(seed(), 0, '%')).toEqual([])
    expect(bridgeServiceInternals.readNewSelfMessages(seed(), 0, '+1555123_')).toEqual([])
  })

  describe('US phone spellings (setting typed without +1)', () => {
    function seedUs(): SyncDatabase.Database {
      const database = createChatDb()
      database.exec(`
        INSERT INTO handle (ROWID, id) VALUES
          (1, '+15551234567'), (2, '+15551234568'), (3, '+155512345670'), (4, '+445551234567');
        INSERT INTO chat (ROWID, guid, chat_identifier) VALUES
          (10, 'iMessage;-;+15551234567', '+15551234567'),
          (11, 'iMessage;-;+15551234568', '+15551234568'),
          (12, 'iMessage;-;+155512345670', '+155512345670'),
          (13, 'iMessage;-;+445551234567', '+445551234567'),
          (14, 'iMessage;+;chat555', 'chat555');
      `)
      addMessage(database, { rowid: 1, text: 'self chat', handleId: 1, chatIds: [10] })
      addMessage(database, { rowid: 2, text: 'last digit differs', handleId: 2, chatIds: [11] })
      addMessage(database, { rowid: 3, text: 'superset number', handleId: 3, chatIds: [12] })
      addMessage(database, { rowid: 4, text: 'other country', handleId: 4, chatIds: [13] })
      addMessage(database, { rowid: 5, text: 'group with self', handleId: 1, chatIds: [14] })
      addMessage(database, { rowid: 6, text: 'no chat link', handleId: 1 })
      addMessage(database, { rowid: 7, text: 'no link, other', handleId: 2 })
      return database
    }

    it.each(['5551234567', '+15551234567', '15551234567', '(555) 123-4567', '+1 555-123-4567'])(
      'configured %j matches only the E.164 self chat',
      (configured) => {
        const rows = bridgeServiceInternals.readNewSelfMessages(seedUs(), 0, configured)
        expect(rows.map((row) => row.rowid)).toEqual([1, 6])
      }
    )

    it('a shorter or partial number matches nothing', () => {
      expect(bridgeServiceInternals.readNewSelfMessages(seedUs(), 0, '1234567')).toEqual([])
      expect(bridgeServiceInternals.readNewSelfMessages(seedUs(), 0, '555123456')).toEqual([])
    })
  })
})

describe('#13 watermark is coupled to dispatch', () => {
  it('a throw after a command was typed never re-types it on the next poll', async () => {
    const database = createChatDb()
    database.exec(`
      INSERT INTO handle (ROWID, id) VALUES (1, '+15551234');
      INSERT INTO chat (ROWID, guid, chat_identifier) VALUES (10, 'iMessage;-;+15551234', '+15551234');
    `)
    addMessage(database, { rowid: 1, text: 'd: echo one', handleId: 1, chatIds: [10] })
    addMessage(database, { rowid: 2, text: 'boom', handleId: 1, chatIds: [10] })
    addMessage(database, { rowid: 3, text: 'd: echo three', handleId: 1, chatIds: [10] })
    mocks.handleChannelMessage.mockImplementation(async ({ text }) => {
      if (text === 'boom') {
        throw new Error('channel exploded')
      }
      return 'unhandled'
    })
    const { state, target } = fakeTerminal()
    const watermarkAtWrite: number[] = []
    target.sendTerminal.mockImplementationOnce(async (handle, action) => {
      watermarkAtWrite.push(mocks.config.lastSeenRowid)
      state.writes.push(`${handle}:${action.text}`)
    })
    startImessageBridge(target, vi.fn())

    await bridgeServiceInternals.pollNewMessages(database)
    // Simulated restart: a fresh poll reads the persisted watermark.
    await bridgeServiceInternals.pollNewMessages(database)

    expect(state.writes.filter((write) => write.endsWith('echo one'))).toHaveLength(1)
    expect(state.writes.filter((write) => write.endsWith('echo three'))).toHaveLength(1)
    // Persisted past the message before anything was typed.
    expect(watermarkAtWrite).toEqual([1])
    expect(mocks.config.lastSeenRowid).toBe(3)
  })
})
