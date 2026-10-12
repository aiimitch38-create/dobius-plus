import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { CloudBackupConnection } from '../../../../shared/cloud-backup'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { translate } from '@/i18n/i18n'

export function AwsBackupConnectionForm({
  bucket,
  region,
  busy,
  onConnect
}: {
  bucket: string
  region: string
  busy: boolean
  onConnect: (input: CloudBackupConnection) => Promise<void>
}): React.JSX.Element {
  const [fields, setFields] = useState<CloudBackupConnection>({
    bucket,
    region,
    accessKeyId: '',
    secretAccessKey: '',
    sessionToken: ''
  })
  const definitions = [
    {
      name: 'bucket',
      label: translate('settings.aws.bucket', 'S3 bucket name'),
      secret: false,
      placeholder: 'my-dobius-backups',
      max: 63
    },
    {
      name: 'region',
      label: translate('settings.aws.region', 'AWS region'),
      secret: false,
      placeholder: 'us-east-1',
      max: 40
    },
    {
      name: 'accessKeyId',
      label: translate('settings.aws.accessKey', 'Access key ID'),
      secret: true,
      max: 128
    },
    {
      name: 'secretAccessKey',
      label: translate('settings.aws.secretKey', 'Secret access key'),
      secret: true,
      max: 256
    },
    {
      name: 'sessionToken',
      label: translate('settings.aws.sessionToken', 'Session token (optional)'),
      secret: true,
      max: 16384
    }
  ] as const
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (busy) {
          return
        }
        const input = { ...fields }
        // The secret fields are cleared even if connection verification fails.
        setFields((current) => ({
          ...current,
          accessKeyId: '',
          secretAccessKey: '',
          sessionToken: ''
        }))
        void onConnect(input)
      }}
    >
      {definitions.map((field) => (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={`aws-${field.name}`}>{field.label}</Label>
          <Input
            id={`aws-${field.name}`}
            name={field.name}
            type={field.secret ? 'password' : 'text'}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            maxLength={field.max}
            required={field.name !== 'sessionToken'}
            placeholder={'placeholder' in field ? field.placeholder : undefined}
            value={fields[field.name]}
            onChange={(event) =>
              setFields((current) => ({ ...current, [field.name]: event.target.value }))
            }
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        {translate(
          'settings.aws.credentialsNote',
          'Use an IAM backup identity limited to this bucket. Credentials are stored in private files on this computer for backups while Dobius is closed. Temporary credentials must be replaced before they expire.'
        )}
      </p>
      <Button
        type="submit"
        size="sm"
        disabled={
          busy ||
          !fields.bucket.trim() ||
          !fields.region.trim() ||
          !fields.accessKeyId.trim() ||
          !fields.secretAccessKey.trim()
        }
      >
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {translate('settings.aws.connect', 'Connect and enable backups')}
      </Button>
    </form>
  )
}
