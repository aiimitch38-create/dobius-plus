import { useEffect, useRef, useState } from 'react'
import type { TelegramParticipantSummary } from '../../../../shared/telegram-account-api'
import { Button } from '../ui/button'
import { TelegramParticipantConsentRow } from './TelegramParticipantConsentRow'
import { TelegramRecordedConsentPanel } from './TelegramRecordedConsentPanel'
import type { TelegramAccountUiApi, TelegramAccountUiSnapshot } from './telegram-account-ui'

type Props = {
  api: TelegramAccountUiApi
  snapshot: TelegramAccountUiSnapshot
  busy: boolean
  onAction: (action: () => Promise<void>) => Promise<void>
}

export function TelegramAccountConsentPanel({
  api,
  snapshot,
  busy,
  onAction
}: Props): React.JSX.Element {
  const [participants, setParticipants] = useState<Record<string, TelegramParticipantSummary[]>>({})
  const [loadingGroup, setLoadingGroup] = useState<string | null>(null)
  const generation = useRef(0)
  const groupKey = snapshot.account.selectedGroups
    .map((group) => group.id)
    .sort()
    .join(',')
  useEffect(() => {
    generation.current += 1
    setParticipants({})
    return () => {
      generation.current += 1
    }
  }, [api, groupKey])

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-medium">Participant consent</h3>
      <p className="text-xs text-muted-foreground">
        Record consent each participant actually gave for Adam’s AI handling in this group.
        Recording evidence does not contact them or obtain consent. Unrecorded, expired, or revoked
        participants’ messages are excluded.
      </p>
      <TelegramRecordedConsentPanel
        consents={(snapshot.consents ?? []).filter(
          (consent) =>
            !participants[consent.groupId]?.some(
              (participant) => participant.senderId === consent.senderId
            )
        )}
        groups={snapshot.account.selectedGroups}
        api={api}
        busy={busy}
        onAction={onAction}
      />
      {snapshot.account.selectedGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Save your three groups before loading participants.
        </p>
      ) : null}
      {snapshot.account.selectedGroups.map((group) => (
        <div key={group.id} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-medium">{group.title}</h4>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !snapshot.account.connected || loadingGroup !== null}
              onClick={() => {
                const current = generation.current
                setLoadingGroup(group.id)
                void onAction(async () => {
                  try {
                    const next = await api.getParticipants({ groupId: group.id })
                    if (generation.current === current) {
                      setParticipants((previous) => ({ ...previous, [group.id]: next }))
                    }
                  } finally {
                    if (generation.current === current) {
                      setLoadingGroup(null)
                    }
                  }
                })
              }}
            >
              {loadingGroup === group.id
                ? 'Loading participants…'
                : `Load participants in ${group.title}`}
            </Button>
          </div>
          {participants[group.id]?.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No eligible participants returned by Telegram.
            </p>
          ) : null}
          {participants[group.id]?.map((participant) => (
            <TelegramParticipantConsentRow
              key={`${group.id}:${participant.senderId}`}
              participant={participant}
              api={api}
              busy={busy}
              canRecord={snapshot.account.connected}
              onAction={onAction}
              consent={snapshot.consents?.find(
                (consent) =>
                  consent.groupId === group.id && consent.senderId === participant.senderId
              )}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
