import { useEffect, useState } from 'react'
import type { BriefHandleResult, BriefHandleStatus } from '../../../../shared/adam-speaks-up'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

/**
 * "Send test text" and the code Carson types back: the morning brief only
 * texts a handle verified this way (main/jarvis/adam-brief-handle.ts).
 */
export function AdamBriefHandleVerify(): React.JSX.Element {
  const [status, setStatus] = useState<BriefHandleStatus | null>(null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    // Why new Promise: an older preload (or a test stub) without this call must not break Settings.
    void new Promise<BriefHandleStatus | null>((resolve, reject) => {
      window.api.jarvis.briefHandleStatus().then(resolve, reject)
    })
      .then((next) => live && setStatus(next))
      .catch(() => live && setMessage('Could not read the iMessage number status.'))
    return () => {
      live = false
    }
  }, [])

  const settle = (result: BriefHandleResult, done: string): void => {
    setStatus(result.status)
    setMessage(result.ok ? done : result.error)
  }

  const sendCode = async (): Promise<void> => {
    setBusy(true)
    try {
      settle(await window.api.jarvis.briefHandleSendCode(), 'Code sent. Type it below.')
    } catch {
      setMessage('The test text could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      settle(await window.api.jarvis.briefHandleConfirm(code), 'Number verified.')
      setCode('')
    } catch {
      setMessage('The code could not be checked.')
    } finally {
      setBusy(false)
    }
  }

  const state = !status?.handle
    ? 'No iMessage handle is set (Settings, iMessage bridge).'
    : status.verified
      ? `Texts go to ${status.handle} (verified).`
      : `${status.handle} is not verified yet; the brief stays in ADAM's thread until it is.`

  return (
    <div className="space-y-1.5">
      <Label htmlFor="adam-brief-handle-code">Morning brief iMessage number</Label>
      <p className="text-xs text-muted-foreground">{state}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !status?.handle}
          onClick={() => void sendCode()}
        >
          Send test text
        </Button>
        <Input
          id="adam-brief-handle-code"
          className="w-24"
          inputMode="numeric"
          maxLength={4}
          placeholder="Code"
          value={code}
          disabled={busy || !status?.codeSent}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        />
        <Button
          type="button"
          size="sm"
          disabled={busy || !status?.codeSent || code.length !== 4}
          onClick={() => void confirm()}
        >
          Confirm
        </Button>
      </div>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  )
}
