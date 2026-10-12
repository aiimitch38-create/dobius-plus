export type CloudBackupConnection = {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export type CloudBackupHealth =
  | 'not_configured'
  | 'connecting'
  | 'running'
  | 'healthy'
  | 'failed'
  | 'paused'
  | 'unsupported'

export type CloudBackupStatus = {
  supported: boolean
  configured: boolean
  enabled: boolean
  health: CloudBackupHealth
  detail: string
  bucket: string
  region: string
  repository: string
  sources: string[]
  lastBackupAt?: string
  lastRestoreAt?: string
  lastCheckAt?: string
}

export type CloudBackupApi = {
  getStatus: () => Promise<CloudBackupStatus>
  connect: (input: CloudBackupConnection) => Promise<CloudBackupStatus>
  runNow: () => Promise<CloudBackupStatus>
  setEnabled: (enabled: boolean) => Promise<CloudBackupStatus>
  exportRecoveryKey: () => Promise<boolean>
}

export const CLOUD_BACKUP_SEARCH = {
  title: 'AWS cloud backups',
  description: 'Connect Amazon S3 for automatic encrypted backups and restore checks.',
  keywords: ['aws', 'amazon', 's3', 'cloud', 'backup', 'credentials', 'recovery', 'storage']
}
