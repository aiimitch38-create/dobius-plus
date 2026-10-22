import { app } from 'electron'
import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { realpathSync, statSync } from 'node:fs'

export type AdamBridgeRuntime = {
  python: string
  runner: string
  hermesRoot: string
  profileHome: string
}

/** Only main chooses executable/profile paths; Telegram and renderer input never select a process. */
export function resolveAdamBridgeRuntime(): AdamBridgeRuntime | null {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return null
  }
  try {
    const hermesRoot = realpathSync(join(homedir(), '.hermes', 'hermes-agent'))
    const profileHome = realpathSync(join(homedir(), '.hermes', 'profiles', 'adam'))
    const resourceRoot = app.isPackaged
      ? process.resourcesPath
      : join(app.getAppPath(), 'resources')
    const runner = realpathSync(join(resourceRoot, 'adam-telegram', 'bridge_runner.py'))
    let python: string | undefined
    for (const directory of ['.venv', 'venv']) {
      try {
        const candidate = join(hermesRoot, directory, 'bin', 'python')
        realpathSync(candidate)
        // Python discovers pyvenv.cfg from this path; resolving the symlink loses the venv.
        python = candidate
        break
      } catch {
        /* A Hermes installation can use either supported virtualenv name. */
      }
    }
    if (
      !python ||
      !trusted(hermesRoot, true) ||
      !trusted(profileHome, true) ||
      !trusted(runner, false) ||
      !trusted(python, false) ||
      !trusted(join(hermesRoot, 'gateway', 'run.py'), false)
    ) {
      return null
    }
    return { python, runner, hermesRoot, profileHome }
  } catch {
    return null
  }
}

function trusted(path: string, directory: boolean): boolean {
  const info = statSync(path)
  const uid = process.getuid?.()
  return (
    isAbsolute(path) &&
    (directory ? info.isDirectory() : info.isFile()) &&
    (info.mode & 0o022) === 0 &&
    (uid === undefined || info.uid === uid || info.uid === 0)
  )
}
