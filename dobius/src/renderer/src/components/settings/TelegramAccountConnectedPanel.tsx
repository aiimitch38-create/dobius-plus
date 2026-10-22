import { RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { TelegramAccountConsentPanel } from './TelegramAccountConsentPanel'
import { TelegramAccountRepliesPanel } from './TelegramAccountRepliesPanel'
import {
  formatTelegramActivity,
  isValidTelegramGroupSelection,
  TELEGRAM_AUDIT_LIMIT,
  TELEGRAM_GROUP_SELECTION_COUNT,
  type TelegramAccountUiApi,
  type TelegramAccountUiSnapshot,
  type TelegramAuditEntry,
  type TelegramGroupOption
} from './telegram-account-ui'

type TelegramAccountConnectedPanelProps = {
  api: TelegramAccountUiApi
  snapshot: TelegramAccountUiSnapshot
  busy: boolean
  groupDraft: string[]
  setGroupDraft: (ids: string[]) => void
  onAction: (action: () => Promise<void>) => Promise<void>
}

function auditLabel(code: TelegramAuditEntry['code']): string {
  switch (code) {
    case 'connected':
      return 'Account connected'
    case 'paused':
      return 'Replies paused'
    case 'disconnected':
      return 'Account disconnected'
    case 'groups-updated':
      return 'Group selection updated'
    case 'draft-created':
      return 'Reply draft created'
    case 'draft-approved':
      return 'Draft approved'
    case 'send-started':
      return 'Reply send started'
    case 'send-confirmed':
      return 'Reply send confirmed'
    case 'send-unknown':
      return 'Reply delivery needs review'
    case 'message-filtered':
      return 'Message filtered from handling'
    case 'operation-refused':
      return 'Operation refused'
  }
}

export function TelegramAccountConnectedPanel({
  api,
  snapshot,
  busy,
  groupDraft,
  setGroupDraft,
  onAction
}: TelegramAccountConnectedPanelProps): React.JSX.Element {
  const selectedSaved = snapshot.account.selectedGroups.map((group) => group.id)
  const validGroupDraft = isValidTelegramGroupSelection(groupDraft, snapshot.groups)
  const activityAt = snapshot.audit.length
    ? Math.max(...snapshot.audit.map((entry) => entry.at))
    : null

  const toggleGroup = (id: string, checked: boolean): void => {
    setGroupDraft(
      checked
        ? groupDraft.length < TELEGRAM_GROUP_SELECTION_COUNT
          ? [...groupDraft, id]
          : groupDraft
        : groupDraft.filter((candidate) => candidate !== id)
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <p>
          <span className="text-muted-foreground">Account: </span>Personal Telegram account
        </p>
        <p>
          <span className="text-muted-foreground">Assigned agent: </span>Adam
        </p>
        <p>
          <span className="text-muted-foreground">Last activity: </span>
          {formatTelegramActivity(activityAt)}
        </p>
        <p>
          <span className="text-muted-foreground">Reply handling: </span>Drafts for approval
        </p>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Groups Adam may handle</h3>
            <p className="text-xs text-muted-foreground">
              Choose exactly three verified groups. Direct messages and channels are not eligible.
            </p>
          </div>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {groupDraft.length} of {TELEGRAM_GROUP_SELECTION_COUNT} selected
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Group names come from Telegram account metadata.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void onAction(async () => {
                await api.refreshGroups()
              })
            }
          >
            <RefreshCw /> Refresh groups
          </Button>
        </div>
        <div className="space-y-2">
          {snapshot.groups.map((group: TelegramGroupOption) => (
            <label
              key={group.id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <Checkbox
                checked={groupDraft.includes(group.id)}
                disabled={
                  busy ||
                  (!groupDraft.includes(group.id) &&
                    groupDraft.length >= TELEGRAM_GROUP_SELECTION_COUNT)
                }
                onCheckedChange={(checked) => toggleGroup(group.id, checked === true)}
              />
              <span>{group.title}</span>
            </label>
          ))}
          {snapshot.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No verified groups are available yet.</p>
          ) : null}
        </div>
        <Button
          type="button"
          disabled={busy || !validGroupDraft || groupDraft.join('\0') === selectedSaved.join('\0')}
          onClick={() => void onAction(() => api.saveGroups({ groupIds: [...groupDraft] }))}
        >
          Save group selection
        </Button>
      </div>

      <TelegramAccountConsentPanel api={api} snapshot={snapshot} busy={busy} onAction={onAction} />
      <TelegramAccountRepliesPanel api={api} snapshot={snapshot} busy={busy} onAction={onAction} />

      <div className="border-t border-border pt-4">
        <h3 className="mb-2 text-sm font-medium">Recent account activity</h3>
        {snapshot.audit.length > 0 ? (
          <ul
            className="space-y-1 text-xs text-muted-foreground"
            aria-label="Recent account activity"
          >
            {snapshot.audit
              .slice(-TELEGRAM_AUDIT_LIMIT)
              .toReversed()
              .map((entry, index) => (
                <li key={`${entry.at}-${entry.code}-${index}`}>
                  {auditLabel(entry.code)} · {formatTelegramActivity(entry.at)}
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No account activity recorded.</p>
        )}
      </div>
    </div>
  )
}
