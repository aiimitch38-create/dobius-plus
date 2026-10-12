import { Cloud, Loader2 } from 'lucide-react'
import type { CloudBackupApi } from '../../../../shared/cloud-backup'
import { CLOUD_BACKUP_SEARCH } from '../../../../shared/cloud-backup'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSubsectionHeader } from './SettingsFormControls'
import { AwsBackupConnectionForm } from './AwsBackupConnectionForm'
import { useCloudBackup } from './useCloudBackup'
import { translate } from '@/i18n/i18n'

export function AwsCloudBackupSetting({
  api = typeof window !== 'undefined' ? window.api?.cloudBackup : undefined
}: {
  api?: CloudBackupApi
}): React.JSX.Element {
  const backup = useCloudBackup(api)
  const status = backup.status
  return (
    <SearchableSetting {...CLOUD_BACKUP_SEARCH} id="advanced-aws-backup" className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('settings.aws.title', 'AWS cloud backups')}
        description={translate(
          'settings.aws.description',
          'Connect Amazon S3 for automatic encrypted backups and restore checks.'
        )}
      />
      {!api ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'settings.aws.desktopOnly',
            'Open Dobius desktop settings on the computer you want to back up. SSH and VPS files need a backup configured on their host.'
          )}
        </p>
      ) : !status ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {translate('settings.aws.loading', 'Loading backup status…')}
        </p>
      ) : (
        <>
          <div
            className="space-y-2 rounded-md border border-border p-3"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2">
              {backup.busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Cloud className="size-4" aria-hidden="true" />
              )}
              <Badge variant="secondary">
                {status.health === 'healthy'
                  ? translate('settings.aws.verified', 'Backup verified')
                  : status.health === 'paused'
                    ? translate('settings.aws.paused', 'Paused')
                    : status.health === 'connecting' || status.health === 'running'
                      ? translate('settings.aws.inProgress', 'In progress')
                      : status.health === 'failed'
                        ? translate('settings.aws.attention', 'Needs attention')
                        : translate('settings.aws.notConnected', 'Not connected')}
              </Badge>
              {status.bucket && (
                <span className="truncate text-xs text-muted-foreground">
                  {status.bucket} · {status.region}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{status.detail}</p>
            {status.lastBackupAt && (
              <p className="text-xs text-muted-foreground">
                {translate('settings.aws.lastBackup', 'Last completed backup:')}{' '}
                {new Date(status.lastBackupAt).toLocaleString()}
              </p>
            )}
            {status.lastRestoreAt && (
              <p className="text-xs text-muted-foreground">
                {translate('settings.aws.lastRestore', 'Last restore check:')}{' '}
                {new Date(status.lastRestoreAt).toLocaleString()}
              </p>
            )}
          </div>
          {status.supported && (
            <>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'settings.aws.schedule',
                  'Backups run every 30 minutes while this computer is awake and online, even with Dobius closed. S3 storage and transfer charges apply. Use an existing private bucket in its correct region.'
                )}
              </p>
              <details open={!status.configured} className="space-y-3">
                <summary className="cursor-pointer text-xs font-medium">
                  {status.configured
                    ? translate(
                        'settings.aws.changeConnection',
                        'Change AWS connection or replace credentials'
                      )
                    : translate('settings.aws.connectionDetails', 'AWS connection details')}
                </summary>
                <AwsBackupConnectionForm
                  key={`${status.bucket}:${status.region}`}
                  bucket={status.bucket}
                  region={status.region}
                  busy={backup.busy}
                  onConnect={backup.connect}
                />
              </details>
              {status.configured && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={backup.busy || !status.enabled}
                      onClick={() => void backup.runNow()}
                    >
                      {translate('settings.aws.runNow', 'Back up now')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={backup.busy}
                      onClick={() => void backup.toggle()}
                    >
                      {status.enabled
                        ? translate('settings.aws.pause', 'Pause backups')
                        : translate('settings.aws.resume', 'Resume backups')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={backup.busy}
                      onClick={() => void backup.exportKey()}
                    >
                      {translate('settings.aws.saveKey', 'Save recovery key')}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {translate(
                      'settings.aws.recoveryNote',
                      'Keep your recovery key in a separate password manager. You need it to restore encrypted backups after losing this computer.'
                    )}
                  </p>
                  <details className="space-y-2">
                    <summary className="cursor-pointer text-xs font-medium">
                      {translate(
                        'settings.aws.sources',
                        'Folders included in this computer’s backup'
                      )}
                    </summary>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {status.sources.map((source) => (
                        <li key={source} className="break-all">
                          {source}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      {translate(
                        'settings.aws.exclusions',
                        'Dependencies, caches, and generated builds are excluded. Remote projects and other personal folders are not included automatically.'
                      )}
                    </p>
                  </details>
                </>
              )}
            </>
          )}
        </>
      )}
      {backup.error && (
        <p role="alert" className="text-xs text-destructive">
          {backup.error}
        </p>
      )}
      {backup.notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {backup.notice}
        </p>
      )}
    </SearchableSetting>
  )
}
