import { spawn } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CloudBackupConnection, CloudBackupStatus } from '../../shared/cloud-backup'

type BackupControllerOptions = {
  base: string
  scripts: string
  python: string
  supported: boolean
  sourcePaths: () => string[]
  applicationDataPath: string
}

function readDocument(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {}
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) {
    throw new Error('Backup configuration is not a regular local file.')
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

export function validateCloudConnection(input: unknown): CloudBackupConnection {
  if (!input || typeof input !== 'object') {
    throw new Error('Enter AWS connection details.')
  }
  const data = input as Record<string, unknown>
  const limits = {
    bucket: 63,
    region: 40,
    accessKeyId: 128,
    secretAccessKey: 256,
    sessionToken: 16384
  }
  const result: Record<string, string> = {}
  for (const [name, limit] of Object.entries(limits)) {
    const value = data[name] ?? ''
    if (
      typeof value !== 'string' ||
      value.length > limit ||
      Array.from(value).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      )
    ) {
      throw new Error('AWS connection details contain an invalid field.')
    }
    result[name] = value.trim()
  }
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(result.bucket) ||
    /\.\.|\.-|-\.|^\d+\.\d+\.\d+\.\d+$/.test(result.bucket)
  ) {
    throw new Error('Enter an existing S3 bucket name, without a URL.')
  }
  if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(result.region) || result.region.startsWith('cn-')) {
    throw new Error('Enter a supported AWS region, such as us-east-1.')
  }
  if (!result.accessKeyId || !result.secretAccessKey) {
    throw new Error('Both AWS key fields are required.')
  }
  return result as unknown as CloudBackupConnection
}

export class CloudBackupController {
  private pending: string | null = null
  private failure: string | null = null
  constructor(private readonly options: BackupControllerOptions) {}

  getStatus(): CloudBackupStatus {
    const { supported, base } = this.options
    const empty: CloudBackupStatus = {
      supported,
      configured: false,
      enabled: false,
      health: supported ? 'not_configured' : 'unsupported',
      detail: supported
        ? 'Connect AWS to start automatic backups.'
        : 'Automatic AWS backup setup is available on macOS and Linux servers running as root. Open settings on the computer you want to back up.',
      bucket: '',
      region: 'us-east-1',
      repository: '',
      sources: []
    }
    if (!supported) {
      return empty
    }
    try {
      const config = readDocument(join(base, 'config.json'))
      const state = readDocument(join(base, 'state', 'status.json'))
      const repository = typeof config.repository === 'string' ? config.repository : ''
      const bucket = /^s3:https:\/\/[^/]+\/([^/]+)\//.exec(repository)?.[1] ?? ''
      const status: CloudBackupStatus = {
        ...empty,
        configured: Boolean(repository),
        enabled: Boolean(repository) && config.enabled !== false,
        repository,
        bucket,
        region: typeof config.region === 'string' ? config.region : empty.region,
        sources: Array.isArray(config.sources)
          ? config.sources.flatMap((s) => (typeof s?.path === 'string' ? [s.path] : []))
          : [],
        lastBackupAt: typeof state.last_backup_at === 'string' ? state.last_backup_at : undefined,
        lastRestoreAt:
          typeof state.last_restore_at === 'string' ? state.last_restore_at : undefined,
        lastCheckAt: typeof state.last_check_at === 'string' ? state.last_check_at : undefined
      }
      if (this.failure) {
        return { ...status, health: 'failed', detail: this.failure }
      }
      if (this.pending) {
        return { ...status, health: 'connecting', detail: this.pending }
      }
      if (config.enabled === false) {
        return {
          ...status,
          health: 'paused',
          detail: 'Automatic AWS backups are paused. Existing cloud snapshots are kept.'
        }
      }
      const allowed = ['connecting', 'running', 'healthy', 'failed', 'paused'] as const
      status.health = allowed.find((health) => health === state.health) ?? 'not_configured'
      status.detail = typeof state.detail === 'string' ? state.detail : empty.detail
      if (status.health === 'connecting' || status.health === 'running') {
        try {
          if (typeof state.pid !== 'number' || state.pid < 1) {
            throw new Error('Missing worker')
          }
          process.kill(state.pid, 0)
        } catch {
          status.health = 'failed'
          status.detail = 'The backup was interrupted. Run it again to complete verification.'
        }
      }
      return status
    } catch {
      return {
        ...empty,
        health: 'failed',
        detail: 'Backup configuration could not be read. Check its file permissions.'
      }
    }
  }

  connect(input: unknown): Promise<CloudBackupStatus> {
    const credentials = validateCloudConnection(input)
    return this.start('connect', {
      ...credentials,
      sourcePaths: this.options.sourcePaths(),
      applicationDataPath: this.options.applicationDataPath
    })
  }

  async start(
    action: 'connect' | 'run' | 'pause' | 'resume',
    input = {}
  ): Promise<CloudBackupStatus> {
    if (!this.options.supported) {
      throw new Error(this.getStatus().detail)
    }
    const status = this.getStatus()
    if (this.pending || status.health === 'connecting' || status.health === 'running') {
      throw new Error('A backup operation is already running. Wait for it to finish.')
    }
    if (action !== 'connect' && !status.configured) {
      throw new Error('Connect AWS first.')
    }
    this.failure = null
    this.pending =
      action === 'connect'
        ? 'Checking AWS and preparing automatic backups.'
        : 'Updating the backup schedule.'
    // Secrets travel over stdin, never command arguments, general settings, or logs.
    const child = spawn(
      this.options.python,
      [join(this.options.scripts, 'settings_bridge.py'), '--base', this.options.base, action],
      {
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true
      }
    )
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(input))
    return new Promise((resolve, reject) => {
      child.once('error', () => {
        this.pending = null
        this.failure = 'The backup runtime could not start. Install Python 3 and try again.'
        reject(new Error(this.failure))
      })
      child.once('spawn', () => {
        child.unref()
        if (action === 'pause') {
          // Pause is a short atomic settings change; report it only after it succeeds.
          child.once('close', (code) => {
            this.pending = null
            if (code !== 0) {
              this.failure = 'The backup schedule could not be paused.'
            }
            resolve(this.getStatus())
          })
        } else {
          resolve(this.getStatus())
        }
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        this.pending = null
        if (code !== 0 && this.getStatus().health !== 'failed') {
          this.failure =
            'AWS setup could not finish. Check the bucket, region, permissions, and credentials, then try again.'
        }
      })
      // The persisted runner status takes over once the worker has started.
      const timer = setTimeout(() => {
        this.pending = null
      }, 1500)
      timer.unref()
    })
  }
}
