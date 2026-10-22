import { describe, expect, it } from 'vitest'
import { TELEGRAM_SAFE_ERRORS } from '../../../../shared/telegram-account'
import { getTelegramRequestErrorMessage, getTelegramUiErrorMessage } from './telegram-account-ui'

describe('Telegram request error presentation', () => {
  it.each(TELEGRAM_SAFE_ERRORS)('preserves the closed error code %s across IPC', (code) => {
    expect(getTelegramRequestErrorMessage(new Error(code))).toBe(getTelegramUiErrorMessage(code))
    expect(
      getTelegramRequestErrorMessage(
        new Error(`Error invoking remote method 'telegramAccount:beginSignIn': Error: ${code}`)
      )
    ).toBe(getTelegramUiErrorMessage(code))
  })

  it.each([
    new Error('private phone +15555550123'),
    new Error(
      "Error invoking remote method 'telegramAccount:beginSignIn': Error: invalid-input secret"
    ),
    new Error("Error invoking remote method 'unrelated:beginSignIn': Error: invalid-input"),
    new Error('prefix invalid-input'),
    { message: 'invalid-input' },
    null
  ])('keeps unknown exceptions generic: %#', (error) => {
    expect(getTelegramRequestErrorMessage(error)).toBe(getTelegramUiErrorMessage())
  })

  it('does not propagate an exception from a hostile message accessor', () => {
    const error = new Error('untrusted')
    Object.defineProperty(error, 'message', {
      get: () => {
        throw new Error('secret')
      }
    })
    expect(getTelegramRequestErrorMessage(error)).toBe(getTelegramUiErrorMessage())
  })
})
