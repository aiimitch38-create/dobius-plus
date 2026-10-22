import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { TelegramAccountRendererTrust } from './telegram-account-trust'

function sender(id = 42): IpcMainInvokeEvent {
  const frame = { detached: false }
  return {
    sender: { id, isDestroyed: () => false, mainFrame: frame },
    senderFrame: frame
  } as unknown as IpcMainInvokeEvent
}

describe('Telegram personal-account renderer authority', () => {
  it('refuses all account controls until the desktop window is assigned', () => {
    expect(() => new TelegramAccountRendererTrust().capture(sender())).toThrow('desktop settings')
  })

  it('accepts only the current desktop main frame', () => {
    const trust = new TelegramAccountRendererTrust()
    trust.setRenderer(42)
    expect(() => trust.capture(sender())()).not.toThrow()
    expect(() => trust.capture(sender(99))).toThrow('desktop settings')
    const subframe = sender()
    Object.assign(subframe, { senderFrame: { detached: false } })
    expect(() => trust.capture(subframe)).toThrow('desktop settings')
    const missingFrame = sender()
    Object.assign(missingFrame, { senderFrame: null })
    expect(() => trust.capture(missingFrame)).toThrow('desktop settings')
  })

  it('invalidates in-flight authority when a window is replaced, including an ID ABA', () => {
    const trust = new TelegramAccountRendererTrust()
    trust.setRenderer(42)
    const assertCurrent = trust.capture(sender())
    trust.setRenderer(99)
    trust.setRenderer(42)
    expect(assertCurrent).toThrow('desktop settings')
    expect(() => trust.capture(sender())()).not.toThrow()
  })

  it('refuses a destroyed or detached sender after an asynchronous boundary', () => {
    const trust = new TelegramAccountRendererTrust()
    trust.setRenderer(42)
    const event = sender()
    const assertCurrent = trust.capture(event)
    Object.assign(event.senderFrame!, { detached: true })
    expect(assertCurrent).toThrow('desktop settings')
    Object.assign(event.senderFrame!, { detached: false })
    Object.assign(event.sender, { isDestroyed: () => true })
    expect(assertCurrent).toThrow('desktop settings')
  })

  it('revokes in-flight authority when the desktop window closes', () => {
    const trust = new TelegramAccountRendererTrust()
    trust.setRenderer(42)
    const assertCurrent = trust.capture(sender())
    trust.setRenderer(null)
    expect(assertCurrent).toThrow('desktop settings')
  })
})
