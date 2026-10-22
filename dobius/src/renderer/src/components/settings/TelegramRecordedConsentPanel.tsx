import type { TelegramParticipantConsent } from '../../../../shared/telegram-account-api'
import type { TelegramGroupSummary } from '../../../../shared/telegram-account'
import { Button } from '../ui/button'
import { formatTelegramActivity, type TelegramAccountUiApi } from './telegram-account-ui'

type Props = {
  consents: TelegramParticipantConsent[]
  groups: TelegramGroupSummary[]
  api: TelegramAccountUiApi
  busy: boolean
  onAction: (action: () => Promise<void>) => Promise<void>
}

/** Withdrawing local consent must remain possible without reconnecting or fetching membership. */
export function TelegramRecordedConsentPanel({
  consents,
  groups,
  api,
  busy,
  onAction
}: Props): React.JSX.Element | null {
  if (consents.length === 0) {
    return null
  }
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">Saved participant consent</h4>
      <p className="text-xs text-muted-foreground">
        You can withdraw recorded consent while Telegram is paused.
      </p>
      {consents.map((consent) => (
        <div
          key={`${consent.groupId}:${consent.senderId}`}
          className="space-y-1 border-t border-border py-3 text-xs text-muted-foreground"
        >
          <p className="text-sm font-medium text-foreground">{consent.displayName}</p>
          <p>
            {groups.find((group) => group.id === consent.groupId)?.title ??
              `Telegram group ${consent.groupId}`}{' '}
            · Participant {consent.senderId}
          </p>
          <p>
            {consent.expiresAt > Date.now()
              ? 'Recorded consent expires'
              : 'Recorded consent expired'}{' '}
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
                api.revokeConsent({ groupId: consent.groupId, senderId: consent.senderId })
              )
            }
          >
            Revoke saved consent for {consent.displayName}
          </Button>
        </div>
      ))}
    </div>
  )
}
