import { TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions'
import { LogLevel } from 'teleproto/extensions/Logger'
import { describe, expect, it, vi } from 'vitest'
import { teleprotoRuntime } from './teleproto-runtime'
import { TeleprotoPersonalTelegramClient } from './personal-client'

function syntheticSession(fill = 17): string {
  const address = Buffer.from('149.154.167.91')
  const length = Buffer.alloc(2)
  length.writeInt16BE(address.length)
  const port = Buffer.alloc(2)
  port.writeInt16BE(443)
  return `1${Buffer.concat([Buffer.from([4]), length, address, port, Buffer.alloc(256, fill)]).toString('base64')}`
}

function fixture() {
  const session = syntheticSession()
  const sdk = new TelegramClient(new StringSession(session), 12345, 'a'.repeat(32), {})
  sdk.setLogLevel(LogLevel.NONE)
  // Real StringSession lifecycle, but no network, account lookup or actual credentials.
  const socket = vi.spyOn(sdk, 'connect').mockResolvedValue(true)
  vi.spyOn(sdk, 'checkAuthorization').mockResolvedValue(true)
  vi.spyOn(sdk, 'getMe').mockResolvedValue({ id: 123n } as never)
  const client = new TeleprotoPersonalTelegramClient(
    sdk,
    teleprotoRuntime.saveSession,
    teleprotoRuntime,
    { apiId: 12345, apiHash: 'a'.repeat(32) }
  )
  return { session, sdk, socket, client }
}

describe('saved Telegram SDK session restoration', () => {
  it('loads the real SDK session before comparing or opening a socket', async () => {
    const f = fixture()
    expect(teleprotoRuntime.saveSession(f.sdk)).toBe('')
    await expect(f.client.connect(f.session, new AbortController().signal)).resolves.toEqual({
      userId: '123'
    })
    expect(teleprotoRuntime.saveSession(f.sdk)).toBe(f.session)
    expect(f.socket).toHaveBeenCalledOnce()
  })

  it('refuses a different saved session before any network connection', async () => {
    const f = fixture()
    await expect(
      f.client.connect(syntheticSession(18), new AbortController().signal)
    ).rejects.toThrow()
    expect(f.socket).not.toHaveBeenCalled()
  })

  it('does not open a connection if cancelled while hydration is pending', async () => {
    const f = fixture()
    let release!: () => void
    vi.spyOn(f.sdk.session, 'load').mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          release = done
        })
    )
    vi.spyOn(f.sdk, 'disconnect').mockResolvedValue()
    const controller = new AbortController()
    const pending = f.client.connect(f.session, controller.signal)
    const rejected = expect(pending).rejects.toThrow()
    controller.abort()
    release()
    await rejected
    expect(f.socket).not.toHaveBeenCalled()
  })
})
