import { describe, expect, it } from 'vitest'
import { assertBoardWindowSender } from './board-ipc-sender-guard'

describe('assertBoardWindowSender', () => {
  const mainFrame = { id: 'main' }
  const webContents = { id: 1, mainFrame }
  const mainWindow = { webContents } as unknown as Parameters<typeof assertBoardWindowSender>[1]
  const event = (sender: unknown, senderFrame: unknown): Parameters<typeof assertBoardWindowSender>[0] =>
    ({ sender, senderFrame }) as unknown as Parameters<typeof assertBoardWindowSender>[0]

  it('accepts only the Board window top frame', () => {
    expect(() => assertBoardWindowSender(event(webContents, mainFrame), mainWindow, 'agents:yield')).not.toThrow()
  })

  it('refuses a web tile guest, a Board sub-frame and foreign webContents, naming the channel', () => {
    // Why: a guest page or an iframe inside the Board must never be able to
    // yield a tile (blocking agents) or control agents as if it were the human.
    expect(() => assertBoardWindowSender(event({ id: 999, mainFrame }, mainFrame), mainWindow, 'agents:yield')).toThrow(
      'forbidden: agents:yield is only accepted from the Board window'
    )
    expect(() =>
      assertBoardWindowSender(event(webContents, { id: 'iframe' }), mainWindow, 'agents:control')
    ).toThrow('forbidden: agents:control is only accepted from the Board window')
    expect(() => assertBoardWindowSender(event(undefined, undefined), mainWindow, 'agents:yield')).toThrow(/forbidden/)
  })
})
