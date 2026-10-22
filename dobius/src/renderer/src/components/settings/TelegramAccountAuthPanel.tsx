import { useEffect, useRef, useState } from 'react'
import type { TelegramAccountPhase } from '../../../../shared/telegram-account'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import type { TelegramAccountUiApi } from './telegram-account-ui'

type TelegramAccountAuthPanelProps = {
  api: TelegramAccountUiApi
  phase: TelegramAccountPhase
  busy: boolean
  onAction: (action: () => Promise<void>) => Promise<void>
  onCancel: () => void
}

export function TelegramAccountAuthPanel({
  api,
  phase,
  busy,
  onAction,
  onCancel
}: TelegramAccountAuthPanelProps): React.JSX.Element {
  const [phone, setPhone] = useState('')
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const authPending = useRef(false)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const normalizedPhone = phone.trim().replace(/[\s()-]/g, '')

  useEffect(
    () => () => {
      if (
        authPending.current &&
        phaseRef.current !== 'connected' &&
        phaseRef.current !== 'paused'
      ) {
        void api.cancelSignIn().catch(() => undefined)
      }
    },
    [api]
  )

  const submitAuth = (action: () => Promise<void>): void => {
    authPending.current = true
    void onAction(action).finally(() => {
      authPending.current = false
    })
  }

  const cancel = (): void => {
    setPhone('')
    setApiId('')
    setApiHash('')
    setCode('')
    setPassword('')
    authPending.current = false
    onCancel()
  }

  if (phase === 'disconnected') {
    return (
      <div className="max-w-xl space-y-3" aria-label="Telegram sign in">
        <p className="text-sm text-muted-foreground">
          Sign in with a phone number. Sign-in codes and passwords are sent to the secure account
          service and cleared from this form after submission.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="telegram-phone">Phone number</Label>
          <Input
            id="telegram-phone"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+15555550123"
            aria-describedby="telegram-phone-format"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            disabled={busy}
          />
          <p id="telegram-phone-format" className="text-xs text-muted-foreground">
            Include + and the country code, for example +1 followed by a US number.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="telegram-api-id">Telegram API ID</Label>
          <Input
            id="telegram-api-id"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={apiId}
            onChange={(event) => setApiId(event.target.value)}
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            Optional when an administrator has already configured an app registration.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="telegram-api-hash">Telegram API hash</Label>
          <Input
            id="telegram-api-hash"
            type="password"
            autoComplete="off"
            value={apiHash}
            onChange={(event) => setApiHash(event.target.value)}
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            Used only for this sign-in attempt; not saved in settings.
          </p>
        </div>
        {busy ? (
          <Button type="button" variant="ghost" onClick={cancel}>
            Cancel sign-in
          </Button>
        ) : (
          <Button
            type="button"
            disabled={
              !/^\+[1-9]\d{7,14}$/.test(normalizedPhone) ||
              Boolean(apiId) !== Boolean(apiHash.trim()) ||
              (apiId.length > 0 && (!Number.isSafeInteger(Number(apiId)) || Number(apiId) <= 0))
            }
            onClick={() => {
              const submittedPhone = normalizedPhone
              const submittedApiId = apiId.length > 0 ? Number(apiId) : undefined
              const submittedApiHash = apiHash.trim().length > 0 ? apiHash.trim() : undefined
              setPhone('')
              setApiId('')
              setApiHash('')
              submitAuth(() =>
                api.beginSignIn({
                  phoneNumber: submittedPhone,
                  ...(submittedApiId === undefined ? {} : { apiId: submittedApiId }),
                  ...(submittedApiHash === undefined ? {} : { apiHash: submittedApiHash })
                })
              )
            }}
          >
            Continue
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-xl space-y-3" aria-label="Complete Telegram sign in">
      {phase === 'awaiting-code' ? (
        <div className="space-y-1.5">
          <Label htmlFor="telegram-code">Sign-in code</Label>
          <Input
            id="telegram-code"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            The code is used only to complete this sign-in attempt.
          </p>
          <Button
            type="button"
            disabled={busy || code.trim().length === 0}
            onClick={() => {
              const submittedCode = code
              setCode('')
              submitAuth(() => api.submitCode({ code: submittedCode }))
            }}
          >
            Submit code
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="telegram-password">Two-step verification password</Label>
          <Input
            id="telegram-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            The password is used only to complete this sign-in attempt.
          </p>
          <Button
            type="button"
            disabled={busy || password.length === 0}
            onClick={() => {
              const submittedPassword = password
              setPassword('')
              submitAuth(() => api.submitPassword({ password: submittedPassword }))
            }}
          >
            Submit password
          </Button>
        </div>
      )}
      <Button type="button" variant="ghost" onClick={cancel}>
        Cancel sign-in
      </Button>
    </div>
  )
}
