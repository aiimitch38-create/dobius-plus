import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => new Map<string, (event: unknown, ...args: unknown[]) => unknown>())

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: (channel: string) => handlers.delete(channel),
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
  }
}))

import { protectedSelfUiActive, resetProtectedSelfUiForTest } from '../computer/protected-self-ui'
import { memoryIntakeStore } from './intake-store'
import { setTextIntake, TextIntake } from './text-intake'
import { registerTextIntakeIpc } from './text-intake-ipc'

const EMPTY = { contacts: [], suggestions: [], drafts: [] }
const sender = { id: 7, on: vi.fn(), once: vi.fn() }
const TRUSTED = { trusted: true, sender }
const UNTRUSTED = { trusted: false, sender }

function setup(confirm = vi.fn(async () => true)) {
  const createCard = vi.fn(() => ({ id: 'task-1' }))
  const sendText = vi.fn(async () => undefined)
  const intake = new TextIntake({
    store: memoryIntakeStore({ contacts: [{ name: 'Brett', handle: '+15550102000' }] }),
    createCard,
    sendText,
    sendUnavailable: () => null,
    authorizeSend: async () => null,
    appendThread: async () => undefined,
    tap: () => undefined
  })
  intake.ingest({ messageId: 'g1', handle: '+15550102000', text: 'Can you send the private deck?' })
  const draft = intake.createDraft('Brett', 'Carson will call at 3.')
  setTextIntake(intake)
  registerTextIntakeIpc((event) => (event as unknown as { trusted: boolean }).trusted, confirm)
  const fingerprint = intake.view().drafts[0].fingerprint
  return { intake, createCard, sendText, confirm, fingerprint, draftId: draft.id, suggestionId: intake.view().suggestions[0].id }
}

const invoke = (channel: string, event: unknown, ...args: unknown[]): unknown => {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  return handler(event, ...args)
}

beforeEach(() => {
  handlers.clear()
  setTextIntake(null)
  resetProtectedSelfUiForTest()
})

describe('text intake IPC', () => {
  it('gives an untrusted sender EMPTY on every channel and does nothing', async () => {
    const { createCard, sendText, draftId, suggestionId } = setup()
    expect(invoke('textIntake:view', UNTRUSTED)).toBeNull()
    const calls: [string, ...unknown[]][] = [
      ['textIntake:setContacts', []],
      ['textIntake:accept', suggestionId],
      ['textIntake:dismiss', suggestionId],
      ['textIntake:sendDraft', draftId, 'edited'],
      ['textIntake:discardDraft', draftId]
    ]
    for (const [channel, ...args] of calls) {
      const result = await invoke(channel, UNTRUSTED, ...args)
      expect(result, channel).toEqual({ ok: false, error: 'Only the Dobius+ window can do this.', view: EMPTY })
      expect(JSON.stringify(result)).not.toMatch(/Brett|private deck|call at 3/)
    }
    expect(createCard).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
    const view = invoke('textIntake:view', TRUSTED) as { contacts: unknown[]; suggestions: unknown[]; drafts: unknown[] }
    expect(view.contacts).toHaveLength(1)
    expect(view.suggestions).toHaveLength(1)
    expect(view.drafts).toHaveLength(1)
  })

  it('lets the trusted window act', async () => {
    const { createCard, suggestionId } = setup()
    expect(await invoke('textIntake:accept', TRUSTED, suggestionId)).toMatchObject({ ok: true })
    expect(createCard).toHaveBeenCalledTimes(1)
  })

  it('an untrusted sender gets EMPTY even before intake starts', async () => {
    registerTextIntakeIpc(() => false)
    expect(await invoke('textIntake:accept', UNTRUSTED, 'x')).toMatchObject({ ok: false, view: EMPTY })
  })
})

describe('text intake IPC: Send needs Carson', () => {
  it('shows the exact recipient and text in a confirm, and sends only on Send', async () => {
    let guardedDuringConfirm = false
    const confirm = vi.fn(async () => {
      guardedDuringConfirm = protectedSelfUiActive()
      return true
    })
    const { sendText, draftId, fingerprint } = setup(confirm)
    expect(await invoke('textIntake:sendDraft', TRUSTED, draftId, fingerprint, 'Calling at 4.')).toMatchObject({ ok: true })
    expect(confirm).toHaveBeenCalledWith(TRUSTED, { toName: 'Brett', toHandle: '+15550102000', text: 'Calling at 4.' })
    expect(guardedDuringConfirm).toBe(true)
    expect(protectedSelfUiActive()).toBe(false)
    expect(sendText).toHaveBeenCalledWith('+15550102000', 'Calling at 4.')
  })

  it('Cancel sends nothing', async () => {
    const { sendText, draftId, fingerprint } = setup(vi.fn(async () => false))
    expect(await invoke('textIntake:sendDraft', TRUSTED, draftId, fingerprint)).toMatchObject({ ok: false, error: 'Not sent.' })
    expect(sendText).not.toHaveBeenCalled()
  })

  it('a stale fingerprint is refused before any confirm opens', async () => {
    const { sendText, confirm, draftId } = setup()
    expect(await invoke('textIntake:sendDraft', TRUSTED, draftId, 'stale')).toMatchObject({ ok: false })
    expect(confirm).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
  })

  it('the review list on screen holds the computer-use guard until it is hidden', () => {
    setup()
    invoke('textIntake:reviewVisible', UNTRUSTED, true)
    expect(protectedSelfUiActive()).toBe(false)
    invoke('textIntake:reviewVisible', TRUSTED, true)
    expect(protectedSelfUiActive()).toBe(true)
    invoke('textIntake:reviewVisible', TRUSTED, false)
    expect(protectedSelfUiActive()).toBe(false)
  })
})

describe('text intake IPC: overlapping confirms', () => {
  it('each confirm holds its own key, so the first to close never lifts the other', async () => {
    const opened: (() => void)[] = []
    const confirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          opened.push(() => resolve(false))
        })
    )
    const { intake, draftId, fingerprint } = setup(confirm)
    const second = intake.createDraft('Brett', 'second')
    const secondFp = intake.view().drafts.find((d) => d.id === second.id)?.fingerprint
    const a = invoke('textIntake:sendDraft', TRUSTED, draftId, fingerprint) as Promise<unknown>
    const b = invoke('textIntake:sendDraft', TRUSTED, second.id, secondFp) as Promise<unknown>
    await vi.waitFor(() => expect(opened).toHaveLength(2))
    opened[0]()
    await a
    expect(protectedSelfUiActive()).toBe(true)
    opened[1]()
    await b
    expect(protectedSelfUiActive()).toBe(false)
  })
})
