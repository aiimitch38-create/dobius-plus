import { Button } from '../ui/button'

type Props = { canResume: boolean; busy: boolean; onRetry: () => void; onRestart: () => void }

export function TelegramAccountRecoveryPanel({
  canResume,
  busy,
  onRetry,
  onRestart
}: Props): React.JSX.Element {
  return (
    <div className="space-y-3">
      {canResume ? (
        <>
          <p className="text-sm text-muted-foreground">
            Retry uses your saved Telegram session and keeps your group choices. No new sign-in code
            is needed for this attempt.
          </p>
          <Button type="button" disabled={busy} onClick={onRetry}>
            Retry saved connection
          </Button>
        </>
      ) : null}
      <div>
        <Button type="button" variant="outline" disabled={busy} onClick={onRestart}>
          Restart sign-in
        </Button>
      </div>
    </div>
  )
}
