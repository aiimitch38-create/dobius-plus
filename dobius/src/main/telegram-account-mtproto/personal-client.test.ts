import { describe, expect, it } from 'vitest'
import bigInt from 'big-integer'
import { Api } from 'teleproto/tl'
import { teleprotoRuntime } from './teleproto-runtime'
import { createGramJsPersonalTelegramClientFactory } from './personal-client'
import { TelegramAdapterError } from './telegram-errors'
import {
  fakeChannel,
  fakeMessage,
  fakeRuntime,
  fakeServiceMessage,
  fakeState,
  PASSWORD_REQUIRED
} from './personal-client.test-support'

const credentials = { apiId: 12345, apiHash: 'a'.repeat(32) }

function create(state = fakeState()) {
  const factory = createGramJsPersonalTelegramClientFactory(credentials, fakeRuntime(state))
  return { client: factory(null), state }
}

describe('teleproto personal-account adapter', () => {
  it('uses exact private credentials for code request and raw auth.SignIn without signup flow', async () => {
    const { client, state } = create()
    state.onSignIn = async () => {
      state.authorized = true
    }
    const signal = new AbortController().signal
    const { codeHandle } = await client.requestCode('+15551234567', signal)
    expect(codeHandle).toMatch(/^[0-9a-f-]{36}$/)
    expect(state.sendCodeArgs).toEqual([credentials, '+15551234567'])
    const result = await client.submitCode(codeHandle, '123456', signal)
    expect(result).toEqual({
      kind: 'authorized',
      identity: { userId: '123' },
      session: 'encrypted-session-fixture'
    })
    expect(state.signInRequests).toEqual([
      {
        kind: 'sign-in',
        phoneNumber: '+15551234567',
        phoneCodeHash: 'synthetic-code-hash',
        phoneCode: '123456'
      }
    ])
  })

  it('keeps 2FA password out of returned values and requires a real password-needed transition', async () => {
    const { client, state } = create()
    await expect(
      client.submitPassword('secret', new AbortController().signal)
    ).rejects.toBeInstanceOf(TelegramAdapterError)
    state.onSignIn = async () => {
      throw PASSWORD_REQUIRED
    }
    const signal = new AbortController().signal
    const { codeHandle } = await client.requestCode('+15551234567', signal)
    expect(await client.submitCode(codeHandle, '1234', signal)).toEqual({
      kind: 'password-required'
    })
    expect(await client.submitPassword('fixture-secret', signal)).toEqual({
      kind: 'authorized',
      identity: { userId: '123' },
      session: 'encrypted-session-fixture'
    })
  })

  it('rejects invalid app credentials with a fixed error and no client creation', () => {
    let created = false
    const runtime = fakeRuntime(fakeState())
    runtime.createClient = () => {
      created = true
      throw new Error('private')
    }
    expect(() =>
      createGramJsPersonalTelegramClientFactory({ apiId: 0, apiHash: 'bad' }, runtime)
    ).toThrow('Telegram operation unavailable')
    expect(created).toBe(false)
  })

  it('redacts credential accessor failures and rejects enrollment/signup results', async () => {
    const hostile = Object.defineProperty({}, 'apiHash', {
      get() {
        throw new Error('private-api-hash')
      }
    })
    expect(() => createGramJsPersonalTelegramClientFactory(hostile as never)).toThrow(
      'Telegram operation unavailable'
    )
    const state = fakeState()
    const runtime = fakeRuntime(state)
    runtime.isSignupRequired = () => true
    const client = createGramJsPersonalTelegramClientFactory(credentials, runtime)(null)
    const { codeHandle } = await client.requestCode('+15551234567', new AbortController().signal)
    await expect(
      client.submitCode(codeHandle, '1234', new AbortController().signal)
    ).rejects.toMatchObject({
      name: 'TelegramAdapterError',
      message: 'Telegram operation unavailable'
    })
    const failedState = fakeState()
    failedState.onSignIn = async () => {
      throw new Error('private-auth-response')
    }
    const failedClient = createGramJsPersonalTelegramClientFactory(
      credentials,
      fakeRuntime(failedState)
    )(null)
    const failedCode = await failedClient.requestCode('+15551234567', new AbortController().signal)
    await expect(
      failedClient.submitCode(failedCode.codeHandle, '1234', new AbortController().signal)
    ).rejects.toMatchObject({ message: 'Telegram operation unavailable' })
  })

  it('bounds dialog iteration and classifies only server Chat/megagroup entities as group kinds', async () => {
    const { client, state } = create()
    const result = await client.listDialogs(new AbortController().signal)
    expect(state.dialogsLimit).toBe(500)
    expect(result.map(({ id, kind }) => [id, kind])).toEqual([
      ['-42', 'group'],
      ['-10043', 'supergroup'],
      ['-10043', 'channel'],
      ['9', 'user']
    ])
  })

  it('emits only incoming plain text in groups and excludes outgoing, service, media and channels', async () => {
    const { client, state } = create()
    await client.connect('encrypted-session-fixture', new AbortController().signal)
    const received: unknown[] = []
    const unsubscribe = await client.subscribe((message) => received.push(message))
    const handler = state.eventHandler!
    handler({ message: fakeMessage({}) })
    handler({ message: fakeMessage({ out: true }) })
    handler({ message: fakeMessage({ media: { photo: true } }) })
    handler({ message: fakeServiceMessage() })
    handler({ message: fakeMessage({ getChat: async () => fakeChannel(false) }) })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(received).toEqual([
      {
        groupId: '-42',
        groupKind: 'group',
        senderId: '9',
        messageId: '7',
        text: 'hello',
        context: ''
      }
    ])
    await unsubscribe()
    expect(state.removed).toBe(1)
  })

  it('preserves durable random_id in the actual SendMessage request and keeps unknown lookup unknown', async () => {
    const { client, state } = create()
    await client.connect('encrypted-session-fixture', new AbortController().signal)
    expect(
      await client.sendText({
        groupId: '-42',
        text: 'approved reply',
        randomId: '-77',
        signal: new AbortController().signal,
        canSend: () => true
      })
    ).toBe('confirmed')
    const request = state.sentRequests[0] as Api.messages.SendMessage
    expect(request).toBeInstanceOf(Api.messages.SendMessage)
    expect(String(request.randomId)).toBe('-77')
    expect(await client.lookupRandomId('-77', new AbortController().signal)).toBe('confirmed')
    expect(await client.lookupRandomId('-78', new AbortController().signal)).toBe('unknown')
  })

  it('reports network failure after invocation as unknown and does not change the durable random id', async () => {
    const { client, state } = create()
    await client.connect('encrypted-session-fixture', new AbortController().signal)
    state.onSend = async () => {
      throw new Error('secret sdk payload')
    }
    expect(
      await client.sendText({
        groupId: '-42',
        text: 'approved reply',
        randomId: '88',
        signal: new AbortController().signal,
        canSend: () => true
      })
    ).toBe('unknown')
    expect(state.sentRequests).toHaveLength(1)
    expect(String((state.sentRequests[0] as Api.messages.SendMessage).randomId)).toBe('88')
  })

  it('rejects wrong group kind before sending and malformed caller arguments without SDK calls', async () => {
    const { client, state } = create()
    await client.connect('encrypted-session-fixture', new AbortController().signal)
    state.peer = fakeChannel(false)
    expect(
      await client.sendText({
        groupId: '-42',
        text: 'nope',
        randomId: '1',
        signal: new AbortController().signal,
        canSend: () => true
      })
    ).toBe('not-sent')
    expect(
      await client.sendText({
        groupId: '42',
        text: 'nope',
        randomId: '1',
        signal: new AbortController().signal,
        canSend: () => true
      })
    ).toBe('not-sent')
    expect(state.sentRequests).toHaveLength(0)
  })

  it('disconnect invalidates subscriptions, clears local receipts and ignores late events', async () => {
    const { client, state } = create()
    await client.connect('encrypted-session-fixture', new AbortController().signal)
    let delivered = 0
    await client.subscribe(() => {
      delivered += 1
    })
    const oldHandler = state.eventHandler!
    await client.disconnect()
    oldHandler({ message: fakeMessage({}) })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(delivered).toBe(0)
    expect(state.removed).toBe(1)
    expect(state.disconnected).toBe(1)
    expect(await client.lookupRandomId('1', new AbortController().signal)).toBe('unknown')
  })

  it('keeps remote revoke distinct from disconnect and sends auth.logOut only when requested', async () => {
    const { client, state } = create()
    await client.connect('encrypted-session-fixture', new AbortController().signal)
    expect(
      await (
        client as typeof client & { revokeAuthorization: () => Promise<boolean> }
      ).revokeAuthorization()
    ).toBe(true)
    expect(state.sentRequests[0]).toBeInstanceOf(Api.auth.LogOut)
    expect(state.disconnected).toBe(1)
  })

  it('reports remote revoke only when the SDK returns auth.LoggedOut', async () => {
    const state = fakeState()
    const runtime = fakeRuntime(state)
    runtime.isLoggedOut = () => false
    const client = createGramJsPersonalTelegramClientFactory(credentials, runtime)(null)
    await client.connect('encrypted-session-fixture', new AbortController().signal)
    expect(
      await (
        client as typeof client & { revokeAuthorization: () => Promise<boolean> }
      ).revokeAuthorization()
    ).toBe(false)
    expect(state.disconnected).toBe(0)
  })

  it('aborting an in-flight request disconnects and prevents late results', async () => {
    const { client, state } = create()
    let release!: (value: { phoneCodeHash: string; isCodeViaApp: boolean }) => void
    const pending = new Promise<{ phoneCodeHash: string; isCodeViaApp: boolean }>((resolve) => {
      release = resolve
    })
    const rawClient = (client as unknown as { client: { sendCode: () => Promise<unknown> } }).client
    rawClient.sendCode = () => pending
    const controller = new AbortController()
    const result = client.requestCode('+15551234567', controller.signal)
    controller.abort()
    release({ phoneCodeHash: 'late-secret', isCodeViaApp: true })
    await expect(result).rejects.toBeInstanceOf(TelegramAdapterError)
    expect(state.disconnected).toBe(1)
  })

  it('builds real version-specific auth/sign-in and send requests with the caller random id', () => {
    const auth = teleprotoRuntime.makeSignIn('+15551234567', 'hash-fixture', '1234')
    expect(auth).toBeInstanceOf(Api.auth.SignIn)
    const send = teleprotoRuntime.makeSendMessage(
      new Api.InputPeerChat({ chatId: bigInt(42) }),
      'text',
      bigInt('-9')
    )
    expect(send).toBeInstanceOf(Api.messages.SendMessage)
    expect(String(send.randomId)).toBe('-9')
  })
})
