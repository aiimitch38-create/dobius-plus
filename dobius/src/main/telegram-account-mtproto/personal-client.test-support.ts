import { Api } from 'teleproto/tl'
import type { TeleprotoClient, TeleprotoRuntime } from './teleproto-runtime'

export type FakeTelegramState = {
  authorized: boolean
  session: string
  sendCodeArgs: unknown[]
  signInRequests: unknown[]
  sentRequests: unknown[]
  eventHandler: ((event: { message: unknown }) => void) | null
  removed: number
  disconnected: number
  dialogsLimit: number | undefined
  peer: unknown
  onSignIn: () => Promise<void>
  onSend: () => Promise<void>
}

export function fakeRuntime(state: FakeTelegramState): TeleprotoRuntime {
  return {
    createClient: () => fakeClient(state),
    saveSession: () => state.session,
    makeSignIn: (phoneNumber, phoneCodeHash, phoneCode) => {
      const request = { kind: 'sign-in', phoneNumber, phoneCodeHash, phoneCode }
      state.signInRequests.push(request)
      return request as never
    },
    makeLogOut: () => new Api.auth.LogOut(),
    isLoggedOut: (value) => value instanceof Api.auth.LoggedOut,
    makeSendMessage: (peer, message, randomId) =>
      new Api.messages.SendMessage({
        peer,
        message,
        randomId
      }),
    makeIncomingEvent: () => ({}) as never,
    isPasswordRequired: (error) => error === PASSWORD_REQUIRED,
    isSignupRequired: (result) => result === SIGNUP_REQUIRED
  }
}

export const PASSWORD_REQUIRED = Symbol('password-required')
export const SIGNUP_REQUIRED = Symbol('signup-required')

export function fakeState(): FakeTelegramState {
  return {
    authorized: true,
    session: 'encrypted-session-fixture',
    sendCodeArgs: [],
    signInRequests: [],
    sentRequests: [],
    eventHandler: null,
    removed: 0,
    disconnected: 0,
    dialogsLimit: undefined,
    peer: fakeChat(),
    onSignIn: async () => {},
    onSend: async () => {}
  }
}

export function fakeChat(): Api.Chat {
  return Object.assign(Object.create(Api.Chat.prototype) as Api.Chat, {
    id: 42,
    title: 'Fixture group',
    version: 1
  })
}

export function fakeChannel(megagroup: boolean): Api.Channel {
  return Object.assign(Object.create(Api.Channel.prototype) as Api.Channel, {
    id: 43,
    title: 'Fixture channel',
    megagroup
  })
}

export function fakeMessage(properties: Record<string, unknown>): Api.Message {
  return Object.assign(Object.create(Api.Message.prototype) as Api.Message, {
    id: 7,
    message: 'hello',
    out: false,
    media: undefined,
    senderId: '9',
    peerId: undefined,
    getChat: async () => fakeChat(),
    ...properties
  })
}

export function fakeServiceMessage(): Api.MessageService {
  return Object.assign(Object.create(Api.MessageService.prototype) as Api.MessageService, {
    id: 8,
    message: '',
    out: false,
    media: undefined,
    getChat: async () => fakeChat()
  })
}

function fakeClient(state: FakeTelegramState): TeleprotoClient {
  const client = {
    session: { load: async () => {} },
    connect: async () => true,
    disconnect: async () => {
      state.disconnected += 1
    },
    checkAuthorization: async () => state.authorized,
    getMe: async () => ({ id: 123n }),
    sendCode: async (...args: unknown[]) => {
      state.sendCodeArgs = args
      return { phoneCodeHash: 'synthetic-code-hash', isCodeViaApp: true }
    },
    invoke: async (request: unknown) => {
      if ((request as { kind?: string }).kind === 'sign-in') {
        await state.onSignIn()
        return undefined
      }
      state.sentRequests.push(request)
      if (request instanceof Api.auth.LogOut) {
        return new Api.auth.LoggedOut({})
      }
      await state.onSend()
      return {}
    },
    signInWithPassword: async (
      _credentials: unknown,
      params: { password: () => Promise<string> }
    ) => {
      await params.password()
      state.authorized = true
    },
    iterDialogs: async function* ({ limit }: { limit?: number } = {}) {
      state.dialogsLimit = limit
      yield { entity: fakeChat(), title: 'Fixture group' }
      yield { entity: fakeChannel(true), title: 'Fixture supergroup' }
      yield { entity: fakeChannel(false), title: 'Broadcast' }
      yield { entity: Object.create(Api.User.prototype), title: 'User' }
    },
    getPeerId: async (entity: unknown) =>
      entity instanceof Api.Chat
        ? '-42'
        : entity instanceof Api.Channel
          ? `-100${String(entity.id)}`
          : '9',
    getInputEntity: async () => state.peer,
    getEntity: async (entity: unknown) => entity,
    addEventHandler: (handler: (event: { message: unknown }) => void) => {
      state.eventHandler = handler
    },
    removeEventHandler: () => {
      state.removed += 1
    }
  }
  return client as unknown as TeleprotoClient
}
