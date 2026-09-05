import { HardDrive } from 'lucide-react'
import type { ExternalBackupSettings, GlobalSettings } from '../../../../shared/types'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'

export const EXTERNAL_BACKUP_TITLE = 'Auto-backup to external drive'
export const EXTERNAL_BACKUP_DESCRIPTION =
  'Mirror your repos and worktrees to a folder on an external drive every 15 minutes. Build output and node_modules are skipped.'
export const EXTERNAL_BACKUP_KEYWORDS = [
  'backup',
  'auto-save',
  'autosave',
  'external drive',
  'hard drive',
  'mirror',
  'worktrees'
]

const EMPTY_BACKUP: ExternalBackupSettings = { enabled: false, destination: '' }

type ExternalBackupSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  /** Injected in tests; defaults to the real folder picker. */
  pickDirectory?: (args: { defaultPath?: string }) => Promise<string | null>
}

export function ExternalBackupSetting({
  settings,
  updateSettings,
  pickDirectory
}: ExternalBackupSettingProps): React.JSX.Element {
  const backup = settings.externalBackup ?? EMPTY_BACKUP
  const hasDestination = backup.destination.trim().length > 0

  const choose = async (): Promise<void> => {
    const pick = pickDirectory ?? window.api.shell.pickDirectory
    const destination = await pick({ defaultPath: backup.destination || undefined })
    if (!destination) {
      return
    }
    updateSettings({ externalBackup: { ...backup, destination } })
  }

  return (
    <section className="space-y-3">
      <SearchableSetting
        title={EXTERNAL_BACKUP_TITLE}
        description={EXTERNAL_BACKUP_DESCRIPTION}
        keywords={EXTERNAL_BACKUP_KEYWORDS}
        id="advanced-external-backup"
      >
        <div className="flex items-start justify-between gap-4 py-2">
          <div className="min-w-0 flex-1 space-y-0.5">
            <Label id="advanced-external-backup-label">{EXTERNAL_BACKUP_TITLE}</Label>
            <p className="text-xs text-muted-foreground">{EXTERNAL_BACKUP_DESCRIPTION}</p>
          </div>
          {/* Why disabled without a destination: enabling with no folder chosen
              would silently do nothing on every tick, which reads as a broken
              toggle rather than an unfinished setup. */}
          <SettingsSwitch
            checked={backup.enabled}
            disabled={!hasDestination}
            ariaLabel={EXTERNAL_BACKUP_TITLE}
            onChange={() =>
              updateSettings({ externalBackup: { ...backup, enabled: !backup.enabled } })
            }
          />
        </div>
        <div className="flex items-center justify-between gap-4 py-1">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {hasDestination ? backup.destination : 'No backup folder chosen yet.'}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => void choose()}>
            <HardDrive className="size-4" />
            {hasDestination ? 'Change folder' : 'Choose folder'}
          </Button>
        </div>
      </SearchableSetting>
    </section>
  )
}
