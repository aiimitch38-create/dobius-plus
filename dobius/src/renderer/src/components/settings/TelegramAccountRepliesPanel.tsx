import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { TelegramManualReviewPanel } from './TelegramManualReviewPanel'
import type { TelegramAccountUiApi, TelegramAccountUiSnapshot } from './telegram-account-ui'

type Props = {
  api: TelegramAccountUiApi
  snapshot: TelegramAccountUiSnapshot
  busy: boolean
  onAction: (action: () => Promise<void>) => Promise<void>
}

export function TelegramAccountRepliesPanel({
  api,
  snapshot,
  busy,
  onAction
}: Props): React.JSX.Element {
  const handling = snapshot.replyHandling
  const ready = handling?.bridge === 'ready' && snapshot.account.phase === 'connected'
  const eligible =
    ready &&
    snapshot.account.connected &&
    !snapshot.account.paused &&
    handling.policy === 'approval-required'
  const knownBridge = handling && ['unavailable', 'error', 'ready'].includes(handling.bridge)
  const activeConsent = snapshot.consents?.some(
    (consent) =>
      consent.grantedAt <= Date.now() &&
      consent.expiresAt > Date.now() &&
      snapshot.account.selectedGroups.some((group) => group.id === consent.groupId)
  )
  const label = handling?.listening
    ? 'Listening for new messages'
    : handling?.bridge === 'starting'
      ? 'Connecting to Adam'
      : ready
        ? 'Adam connected'
        : handling?.bridge === 'error'
          ? 'Adam connection needs attention'
          : 'Adam is not connected'
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Adam reply handling</h3>
        <Badge variant={handling?.listening ? 'default' : 'secondary'}>{label}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Only new messages from participants with current recorded consent can reach Adam. Every
        reply needs your approval and a separate send action.
      </p>
      <div className="flex flex-wrap gap-2">
        {handling?.listening ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void onAction(() => api.stopReplies())}
          >
            Stop listening
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              busy ||
              !knownBridge ||
              handling?.policy !== 'approval-required' ||
              !snapshot.account.connected ||
              snapshot.account.paused ||
              snapshot.account.phase !== 'connected' ||
              snapshot.account.selectedGroups.length !== 3 ||
              !activeConsent
            }
            onClick={() => void onAction(() => api.startReplies())}
          >
            Connect Adam and start listening
          </Button>
        )}
      </div>
      {!activeConsent ? (
        <p className="text-xs text-muted-foreground">
          Record at least one participant’s current consent before starting.
        </p>
      ) : null}
      <div className="space-y-3">
        {snapshot.account.drafts.map((draft) => (
          <article key={draft.id} className="space-y-2 rounded-md border border-border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{draft.groupTitle}</p>
              <Badge variant="secondary">{draft.state}</Badge>
            </div>
            <p className="whitespace-pre-wrap break-words">{draft.body}</p>
            <div className="flex flex-wrap gap-2">
              {draft.state === 'awaiting-approval' ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !eligible || draft.consentAllowed !== true}
                  onClick={() =>
                    void onAction(() =>
                      api.approveDraft({ draftId: draft.id, expectedRevision: draft.revision })
                    )
                  }
                >
                  Approve draft
                </Button>
              ) : null}
              {draft.state === 'approved' ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !eligible || draft.consentAllowed !== true}
                  onClick={() =>
                    void onAction(() =>
                      api.sendDraft({ draftId: draft.id, expectedRevision: draft.revision })
                    )
                  }
                >
                  Send approved reply
                </Button>
              ) : null}
              {(draft.state === 'awaiting-approval' || draft.state === 'approved') &&
              (!eligible || draft.consentAllowed !== true) ? (
                <p className="text-xs text-muted-foreground">
                  Connect Adam and verify current individual consent before approving or sending.
                </p>
              ) : null}
              {draft.state === 'unknown' ? (
                <p className="text-xs text-muted-foreground">
                  Delivery is uncertain. Check Telegram before sending anything again.
                </p>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      <TelegramManualReviewPanel receipts={snapshot.manualReview ?? []} />
    </div>
  )
}
