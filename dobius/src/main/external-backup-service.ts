import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const EXTERNAL_BACKUP_INTERVAL_MS = 15 * 60 * 1000
export const EXTERNAL_BACKUP_FOLDER_NAME = 'Dobius+ Backups'

/** Directories that are re-creatable from a lockfile or a build command. Copying
 *  them turns a 15-minute mirror into an hours-long one for no recovery value. */
const RSYNC_EXCLUDES = [
  'node_modules',
  '.pnpm-store',
  'dist',
  'out',
  'build',
  '.next',
  '.turbo',
  '.venv',
  'target',
  '.DS_Store'
]

export type ExternalBackupSource = {
  /** Absolute path to mirror. */
  path: string
  /** Folder name under the backup root. Falls back to the path's basename. */
  label?: string
}

export type ExternalBackupRunResult =
  | { status: 'skipped'; reason: 'disabled' | 'no-destination' | 'already-running' }
  | { status: 'drive-missing'; destination: string }
  | { status: 'done'; copied: number; failed: string[] }

type Logger = Pick<Console, 'warn' | 'debug'>

type ExternalBackupServiceOptions = {
  /** Where the mirrored copies go, and whether the feature is on. */
  getSettings: () => { enabled: boolean; destination: string }
  /** Local paths worth mirroring — repos and any out-of-tree worktrees. */
  listSources: () => ExternalBackupSource[]
  /** Called when a run finds the destination gone. Fires on the transition into
   *  the missing state only, so an unplugged drive doesn't nag every tick. */
  onDriveMissing: (destination: string) => void
  exists?: (path: string) => boolean
  ensureDir?: (path: string) => void
  runRsync?: (args: string[]) => Promise<void>
  intervalMs?: number
  logger?: Logger
}

/** True when the user-picked destination is reachable. The folder picker only
 *  returns directories that exist, so its absence means the volume is gone. */
export function isDestinationAvailable(
  destination: string,
  exists: (path: string) => boolean
): boolean {
  return destination.trim().length > 0 && exists(destination)
}

export function buildRsyncArgs(source: string, destinationDir: string): string[] {
  return [
    '-a',
    '--delete',
    ...RSYNC_EXCLUDES.flatMap((pattern) => ['--exclude', pattern]),
    // Trailing slash copies the contents of `source` into `destinationDir`
    // rather than nesting another directory level inside it.
    `${source.replace(/\/+$/, '')}/`,
    destinationDir
  ]
}

export function backupFolderNameFor(source: ExternalBackupSource): string {
  const label = source.label?.trim()
  return label && label.length > 0 ? label : basename(source.path)
}

export class ExternalBackupService {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private driveWasMissing = false
  private readonly exists: (path: string) => boolean
  private readonly ensureDir: (path: string) => void
  private readonly runRsync: (args: string[]) => Promise<void>
  private readonly intervalMs: number
  private readonly logger: Logger

  constructor(private readonly options: ExternalBackupServiceOptions) {
    this.exists = options.exists ?? existsSync
    // macOS ships rsync 2.6.9, which has no --mkpath: the backup root has to
    // exist before the first mirror or rsync exits with "No such file".
    this.ensureDir =
      options.ensureDir ??
      ((path) => {
        mkdirSync(path, { recursive: true })
      })
    this.runRsync =
      options.runRsync ??
      (async (args) => {
        await execFileAsync('rsync', args, { maxBuffer: 8 * 1024 * 1024 })
      })
    this.intervalMs = options.intervalMs ?? EXTERNAL_BACKUP_INTERVAL_MS
    this.logger = options.logger ?? console
  }

  setEnabled(enabled: boolean): void {
    if (!enabled) {
      this.stop()
      return
    }
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => {
      void this.runOnce()
    }, this.intervalMs)
    // Why unref: a backup timer must never be the reason the process stays
    // alive during quit.
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  dispose(): void {
    this.stop()
  }

  async runOnce(): Promise<ExternalBackupRunResult> {
    const { enabled, destination } = this.options.getSettings()
    if (!enabled) {
      return { status: 'skipped', reason: 'disabled' }
    }
    if (destination.trim().length === 0) {
      return { status: 'skipped', reason: 'no-destination' }
    }
    if (this.running) {
      return { status: 'skipped', reason: 'already-running' }
    }
    if (!isDestinationAvailable(destination, this.exists)) {
      if (!this.driveWasMissing) {
        this.driveWasMissing = true
        this.options.onDriveMissing(destination)
      }
      return { status: 'drive-missing', destination }
    }
    this.driveWasMissing = false

    this.running = true
    const failed: string[] = []
    let copied = 0
    try {
      const root = join(destination, EXTERNAL_BACKUP_FOLDER_NAME)
      this.ensureDir(root)
      for (const source of this.options.listSources()) {
        if (!this.exists(source.path)) {
          continue
        }
        try {
          await this.runRsync(buildRsyncArgs(source.path, join(root, backupFolderNameFor(source))))
          copied += 1
        } catch (error) {
          failed.push(source.path)
          this.logger.warn('[external-backup] failed to mirror', source.path, error)
        }
      }
    } finally {
      this.running = false
    }
    return { status: 'done', copied, failed }
  }
}
