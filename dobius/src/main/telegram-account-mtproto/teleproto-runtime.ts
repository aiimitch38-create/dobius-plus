import bigInt, { type BigInteger } from 'big-integer'
import { TelegramClient } from 'teleproto'
import { LogLevel } from 'teleproto/extensions/Logger'
import { NewMessage } from 'teleproto/events'
import { StringSession } from 'teleproto/sessions'
import { Api } from 'teleproto/tl'
import { RPCError } from 'teleproto/errors/RPCBaseErrors'

export type TeleprotoClient = TelegramClient

export type TeleprotoRuntime = {
  createClient: (session: string | null, apiId: number, apiHash: string) => TeleprotoClient
  saveSession: (client: TeleprotoClient) => string
  makeSignIn: (phoneNumber: string, phoneCodeHash: string, phoneCode: string) => Api.auth.SignIn
  makeLogOut: () => Api.auth.LogOut
  isLoggedOut: (value: unknown) => boolean
  makeSendMessage: (
    peer: Api.TypeInputPeer,
    message: string,
    randomId: BigInteger
  ) => Api.messages.SendMessage
  makeIncomingEvent: () => NewMessage
  isPasswordRequired: (error: unknown) => boolean
  isSignupRequired: (value: unknown) => boolean
}

export const teleprotoRuntime: TeleprotoRuntime = {
  createClient: (session, apiId, apiHash) => {
    const client = new TelegramClient(new StringSession(session ?? ''), apiId, apiHash, {})
    client.setLogLevel(LogLevel.NONE)
    return client
  },
  saveSession: (client) => {
    const saved = client.session.save()
    if (typeof saved !== 'string') {
      throw new Error('Session unavailable')
    }
    return saved
  },
  makeSignIn: (phoneNumber, phoneCodeHash, phoneCode) =>
    new Api.auth.SignIn({
      phoneNumber,
      phoneCodeHash,
      phoneCode
    }),
  makeLogOut: () => new Api.auth.LogOut(),
  isLoggedOut: (value) => value instanceof Api.auth.LoggedOut,
  makeSendMessage: (peer, message, randomId) =>
    new Api.messages.SendMessage({
      peer,
      message,
      randomId
    }),
  makeIncomingEvent: () => new NewMessage({ incoming: true }),
  isPasswordRequired: (error) =>
    error instanceof RPCError && error.errorMessage === 'SESSION_PASSWORD_NEEDED',
  isSignupRequired: (value) => value instanceof Api.auth.AuthorizationSignUpRequired
}

export function parseRandomId(value: string): BigInteger | null {
  if (!/^-?(?:0|[1-9]\d{0,18})$/.test(value)) {
    return null
  }
  try {
    const parsed = bigInt(value)
    if (
      parsed.compare(bigInt('-9223372036854775808')) < 0 ||
      parsed.compare(bigInt('9223372036854775807')) > 0
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}
