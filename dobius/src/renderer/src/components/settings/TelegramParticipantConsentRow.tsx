import { useState } from 'react'
import type {
  TelegramParticipantConsent,
  TelegramParticipantSummary
} from '../../../../shared/telegram-account-api'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { formatTelegramActivity, type TelegramAccountUiApi } from './telegram-account-ui'

type Props = {
  participant: TelegramParticipantSummary
  consent?: TelegramParticipantConsent
  api: TelegramAccountUiApi
  busy: boolean
  canRecord: boolean
  onAction: (action: () => Promise<void>) => Promise<void>
}

function localDateTime(time: number): string {
  const date = new Date(time)
  return new Date(time - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function TelegramParticipantConsentRow({
  participant,
  consent,
  api,
  busy,
  canRecord,
  onAction
}: Props): React.JSX.Element {
  const [evidence, setEvidence] = useState('')
  const [expiry, setExpiry] = useState(() => localDateTime(Date.now() + 7 * 86400000))
  const expiresAt = new Date(expiry).getTime()
  const active = !!consent && consent.expiresAt > Date.now()
  const id = `telegram-consent-${participant.groupId}-${participant.senderId}`
  return (
    <div className="space-y-3 border-t border-border py-3">
      <p className="text-sm font-medium">{participant.displayName}</p>
      <p className="text-xs text-muted-foreground">
        Telegram participant ID: {participant.senderId}
      </p>
      {consent ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            {active ? 'Recorded consent expires' : 'Recorded consent expired'}{' '}
            {formatTelegramActivity(consent.expiresAt)}
          </p>
          <p className="whitespace-pre-wrap break-words">Evidence: {consent.evidence}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void onAction(() =>
                api.revokeConsent({ groupId: participant.groupId, senderId: participant.senderId })
              )
            }
          >
            Revoke consent for {participant.displayName}
          </Button>
        </div>
      ) : null}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (
            busy ||
            !canRecord ||
            evidence.trim().length < 10 ||
            !Number.isFinite(expiresAt) ||
            expiresAt <= Date.now()
          ) {
            return
          }
          void onAction(async () => {
            await api.grantConsent({
              groupId: participant.groupId,
              senderId: participant.senderId,
              evidence: evidence.trim(),
              expiresAt
            })
            setEvidence('')
          })
        }}
      >
        <div className="space-y-1">
          <Label htmlFor={`${id}-evidence`}>Consent evidence for {participant.displayName}</Label>
          <Input
            id={`${id}-evidence`}
            maxLength={1000}
            value={evidence}
            disabled={busy || !canRecord}
            placeholder="Record what they agreed to, when, and a reference to their consent."
            onChange={(event) => setEvidence(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-expiry`}>Consent expiry for {participant.displayName}</Label>
          <Input
            id={`${id}-expiry`}
            type="datetime-local"
            value={expiry}
            disabled={busy || !canRecord}
            onChange={(event) => setExpiry(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={
            busy ||
            !canRecord ||
            evidence.trim().length < 10 ||
            !Number.isFinite(expiresAt) ||
            expiresAt <= Date.now()
          }
        >
          Record consent for {participant.displayName}
        </Button>
      </form>
    </div>
  )
}
