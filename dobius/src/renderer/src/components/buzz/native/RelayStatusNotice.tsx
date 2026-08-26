import { useCallback, useEffect, useState } from 'react'
import { CloudOff, Loader2 } from 'lucide-react'
import type { CommunicationsRelayStatus } from '../../../../../shared/communications-relay-status'

// Why optional-chained: relayStatus() ships only in preload/communications.js,
// which today rides the Communications guest webview. A surface that mounts
// this page without that bridge cannot answer, and a missing read must never
// fake an outage — so an unavailable or failed read renders nothing.
type RelayStatusBridge = {
  relayStatus?: () => Promise<CommunicationsRelayStatus>
}

async function queryRelayStartupStatus(): Promise<CommunicationsRelayStatus | null> {
  const read = (window as { dobiusCommunications?: RelayStatusBridge }).dobiusCommunications
    ?.relayStatus
  if (!read) {return null}
  try {
    return await read()
  } catch {
    return null
  }
}

function failureCopy(status: CommunicationsRelayStatus): string | null {
  switch (status.state) {
    case 'failed':
      return status.reason ?? 'The local relay failed to start'
    case 'stopped':
      return "The local relay hasn't started"
    default:
      return null
  }
}

export function RelayStatusNotice({
  onConnected
}: {
  onConnected: () => void
}): React.JSX.Element | null {
  const [reason, setReason] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    let cancelled = false
    void queryRelayStartupStatus().then((status) => {
      if (!cancelled) {setReason(status ? failureCopy(status) : null)}
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleRetry = useCallback(async () => {
    setRetrying(true)
    try {
      const status = await queryRelayStartupStatus()
      const copy = status ? failureCopy(status) : null
      setReason(copy)
      if (!copy && status?.state === 'running') {onConnected()}
    } finally {
      setRetrying(false)
    }
  }, [onConnected])

  if (!reason) {return null}

  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b px-4 py-1.5 text-xs"
      style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--destructive)' }} />
      <span className="shrink-0 font-medium">Can&apos;t reach the relay</span>
      <span className="truncate" style={{ color: 'var(--muted-foreground)' }}>
        {reason}
      </span>
      <button
        type="button"
        onClick={() => {
          void handleRetry()
        }}
        disabled={retrying}
        title="Retry connecting to the relay"
        className="ml-auto flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 transition-colors hover:bg-[var(--accent)] disabled:opacity-50"
        style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
      >
        {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        Retry
      </button>
    </div>
  )
}
