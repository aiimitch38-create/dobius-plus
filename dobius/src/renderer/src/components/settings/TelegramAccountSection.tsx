import { useCallback, useEffect, useRef, useState } from 'react'
import { Unplug } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { SettingsSubsectionHeader } from './SettingsFormControls'
import { TelegramAccountAuthPanel } from './TelegramAccountAuthPanel'
import { TelegramAccountConnectedPanel } from './TelegramAccountConnectedPanel'
import { TelegramAccountRecoveryPanel } from './TelegramAccountRecoveryPanel'
import {
  getTelegramUiErrorMessage,
  getTelegramAccountStatusLabel,
  getTelegramRequestErrorMessage,
  type TelegramAccountUiApi,
  type TelegramAccountUiSnapshot
} from './telegram-account-ui'

type TelegramAccountSectionProps = {
  api: TelegramAccountUiApi | null
}

function unavailableSnapshot(): TelegramAccountUiSnapshot {
  return {
    account: {
      phase: 'unavailable',
      connected: false,
      paused: false,
      selectedGroups: [],
      drafts: [],
      lastError: 'client-unavailable',
      revision: 0
    },
    groups: [],
    audit: []
  }
}

export function TelegramAccountSection({ api }: TelegramAccountSectionProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<TelegramAccountUiSnapshot | null>(null)
  const [groupDraft, setGroupDraft] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [controlBusy, setControlBusy] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  // Keep urgent account controls in their own lane so a delayed refresh cannot unlock them.
  const ordinaryBusyRef = useRef(false)
  const cancelingRef = useRef(false)
  const controlBusyRef = useRef(false)
  const ordinaryOperationRef = useRef(0)
  const controlOperationRef = useRef(0)
  const generationRef = useRef(0)

  const refreshSnapshot = useCallback(
    async (generation: number, polling = false): Promise<void> => {
      if (!api) {
        setSnapshot(unavailableSnapshot())
        return
      }
      try {
        const next = await api.getSnapshot()
        if (generationRef.current !== generation) {
          return
        }
        setSnapshot(next.account.phase === 'unavailable' ? unavailableSnapshot() : next)
        if (!polling) {
          setGroupDraft(next.account.selectedGroups.map((group) => group.id))
        }
        if (!polling || next.account.phase === 'error') {
          setError(
            next.account.lastError
              ? getTelegramUiErrorMessage(next.account.lastError, next.account.canResume === true)
              : null
          )
        }
      } catch {
        if (generationRef.current === generation) {
          setSnapshot(unavailableSnapshot())
          setError(null)
        }
      }
    },
    [api]
  )

  useEffect(() => {
    const generation = ++generationRef.current
    void refreshSnapshot(generation)
    return () => {
      generationRef.current += 1
    }
  }, [api, refreshSnapshot])

  const shouldPoll =
    snapshot?.account.connected ||
    (snapshot?.account.canResume === true && snapshot.account.phase === 'disconnected')
  useEffect(() => {
    if (!api || !shouldPoll) {
      return
    }
    let pending = false
    const timer = setInterval(() => {
      if (pending || ordinaryBusyRef.current || controlBusyRef.current || cancelingRef.current) {
        return
      }
      pending = true
      void refreshSnapshot(generationRef.current, true).finally(() => {
        pending = false
      })
    }, 2500)
    return () => clearInterval(timer)
  }, [api, shouldPoll, refreshSnapshot])

  const runAction = useCallback(
    async (action: () => Promise<void>): Promise<void> => {
      if (!api || ordinaryBusyRef.current || controlBusyRef.current) {
        return
      }
      ordinaryBusyRef.current = true
      setBusy(true)
      setError(null)
      const operation = ++ordinaryOperationRef.current
      const generation = ++generationRef.current
      try {
        await action()
        await refreshSnapshot(generation)
      } catch (error) {
        if (generationRef.current === generation) {
          setError(getTelegramRequestErrorMessage(error))
        }
      } finally {
        if (ordinaryOperationRef.current === operation) {
          ordinaryBusyRef.current = false
          setBusy(false)
        }
      }
    },
    [api, refreshSnapshot]
  )

  const runControlAction = useCallback(
    async (name: 'pause' | 'resume' | 'disconnect' | 'revoke'): Promise<void> => {
      if (!api || controlBusyRef.current) {
        return
      }

      controlBusyRef.current = true
      setControlBusy(true)
      setError(null)
      const operation = ++controlOperationRef.current
      const generation = ++generationRef.current
      const action =
        name === 'pause'
          ? api.pause
          : name === 'resume'
            ? api.resume
            : name === 'disconnect'
              ? api.disconnect
              : api.revoke
      try {
        await action.call(api)
        await refreshSnapshot(generation)
      } catch (error) {
        if (generationRef.current === generation) {
          setError(getTelegramRequestErrorMessage(error, snapshot?.account.canResume === true))
        }
      } finally {
        if (controlOperationRef.current === operation) {
          controlBusyRef.current = false
          setControlBusy(false)
        }
      }
    },
    [api, refreshSnapshot, snapshot?.account.canResume]
  )

  const status = snapshot?.account.phase ?? 'unavailable'
  const connected = status === 'connected' || status === 'paused'
  const cancelSignIn = (): void => {
    if (!api || cancelingRef.current) {
      return
    }
    cancelingRef.current = true
    const generation = ++generationRef.current
    setCancelBusy(true)
    setError(null)
    void api
      .cancelSignIn()
      .then(() => refreshSnapshot(generation))
      .catch((error: unknown) => {
        if (generationRef.current === generation) {
          setError(getTelegramRequestErrorMessage(error))
        }
      })
      .finally(() => {
        cancelingRef.current = false
        setCancelBusy(false)
      })
  }

  const statusLabel = getTelegramAccountStatusLabel(status)

  return (
    <section className="space-y-4" aria-labelledby="telegram-personal-account-heading">
      <SettingsSubsectionHeader
        title={<span id="telegram-personal-account-heading">Telegram personal account</span>}
        description="Connect a personal Telegram account for Adam. This is separate from bot destinations."
      />

      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">Account status</span>
            <Badge variant={status === 'connected' ? 'default' : 'secondary'}>{statusLabel}</Badge>
          </div>
          {connected ? (
            <div className="flex flex-wrap gap-2">
              {status === 'paused' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={controlBusy}
                  onClick={() => void runControlAction('resume')}
                >
                  Resume
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={controlBusy}
                  onClick={() => void runControlAction('pause')}
                >
                  Pause replies
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={controlBusy}
                onClick={() => void runControlAction('disconnect')}
              >
                <Unplug /> Disconnect
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={controlBusy}
                onClick={() => void runControlAction('revoke')}
              >
                Revoke access
              </Button>
            </div>
          ) : null}
        </div>

        {!snapshot || status === 'unavailable' ? (
          <p role="status" className="text-sm text-muted-foreground">
            Telegram account service is unavailable. No account is connected; secure account support
            must be configured before sign-in.
          </p>
        ) : null}

        {snapshot &&
        (status === 'disconnected' ||
          status === 'awaiting-code' ||
          status === 'awaiting-password') ? (
          <TelegramAccountAuthPanel
            api={api!}
            phase={status}
            busy={busy || cancelBusy}
            onAction={runAction}
            onCancel={cancelSignIn}
          />
        ) : null}

        {status === 'error' ? (
          <TelegramAccountRecoveryPanel
            canResume={snapshot?.account.canResume === true}
            busy={busy || controlBusy || cancelBusy}
            onRestart={cancelSignIn}
            onRetry={() => void runControlAction('resume')}
          />
        ) : null}

        {connected && snapshot ? (
          <TelegramAccountConnectedPanel
            api={api!}
            snapshot={snapshot}
            busy={busy || controlBusy}
            groupDraft={groupDraft}
            setGroupDraft={setGroupDraft}
            onAction={runAction}
          />
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {busy || controlBusy || cancelBusy ? (
          <span className="sr-only" role="status">
            Updating Telegram account…
          </span>
        ) : null}
      </div>
    </section>
  )
}
