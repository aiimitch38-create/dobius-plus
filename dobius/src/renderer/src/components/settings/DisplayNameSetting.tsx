import type React from 'react'
import { useEffect, useId, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import { Input } from '../ui/input'
import { DISPLAY_NAME_MAX_CHARS, normalizeDisplayName } from '../board/board-home/home-greeting'
import { SettingsRow } from './SettingsFormControls'

/** "Your name": what Home greets you by. Saves on blur or Enter; blank unsets it. */
export function DisplayNameSetting({
  displayName,
  updateSettings
}: {
  displayName: string | undefined
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const labelId = useId()
  const [draft, setDraft] = useState(displayName ?? '')
  // Why: another window (or Settings search remount) may change the saved name.
  useEffect(() => setDraft(displayName ?? ''), [displayName])

  const commit = (): void => {
    const next = normalizeDisplayName(draft)
    setDraft(next ?? '')
    if (next !== normalizeDisplayName(displayName)) {
      // Why: '' (not undefined) so clearing survives every merge path; readers
      // treat blank as unset and fall back to the git username.
      updateSettings({ displayName: next ?? '' })
    }
  }

  return (
    <SettingsRow
      labelId={labelId}
      label={translate('settings.general.displayName.label', 'Your name')}
      description={translate(
        'settings.general.displayName.hint',
        'Used to greet you on the Home screen.'
      )}
      control={
        <Input
          aria-labelledby={labelId}
          value={draft}
          maxLength={DISPLAY_NAME_MAX_CHARS}
          placeholder={translate('settings.general.displayName.placeholder', 'Your name')}
          className="h-8 w-56 text-sm"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
          }}
        />
      }
    />
  )
}
