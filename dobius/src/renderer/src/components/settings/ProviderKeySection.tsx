import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { SettingsSubsectionHeader } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

/**
 * Entry point for provider API keys. The field is write-only by design: the
 * main process stores the key encrypted and answers only whether one exists,
 * so a saved key is never rendered back into the page.
 */
type Props = {
  provider: string
  label: string
  hint: string
}

export function ProviderKeySection({ provider, label, hint }: Props): React.JSX.Element {
  const [configured, setConfigured] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const status = await window.api.agents.providerKeyStatus(provider)
      setConfigured(status.configured)
    } catch {
      setConfigured(false)
    }
  }, [provider])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.api.agents.saveProviderKey(provider, draft)
      setDraft('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the key')
    } finally {
      setBusy(false)
    }
  }

  const clear = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.api.agents.clearProviderKey(provider)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the key')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <SettingsSubsectionHeader title={label} description={hint} />
      <div className="flex items-center gap-2">
        <Input
          type="password"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            configured
              ? translate(
                  'auto.components.settings.ProviderKeySection.saved',
                  'Saved — paste a new key to replace it'
                )
              : translate(
                  'auto.components.settings.ProviderKeySection.placeholder',
                  'Paste your API key'
                )
          }
          aria-label={label}
        />
        <Button onClick={() => void save()} disabled={busy || draft.trim().length === 0}>
          {translate('auto.components.settings.ProviderKeySection.save', 'Save')}
        </Button>
        {configured ? (
          <Button variant="outline" onClick={() => void clear()} disabled={busy}>
            {translate('auto.components.settings.ProviderKeySection.remove', 'Remove')}
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <p className="text-muted-foreground text-sm">
        {configured
          ? translate(
              'auto.components.settings.ProviderKeySection.configured',
              'A key is stored, encrypted on this machine. It is never shown again.'
            )
          : translate(
              'auto.components.settings.ProviderKeySection.missing',
              'No key stored yet. This provider will fail to launch until one is added.'
            )}
      </p>
    </div>
  )
}
