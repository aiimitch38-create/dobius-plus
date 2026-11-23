import { realpathSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join, delimiter } from 'node:path'
import { ADAM_CALLER_ID_ENV, rotateAdamCallerId } from './adam-caller-id'

export type AdamHermesRuntime = {
  python: string
  root: string
  profileHome: string
  args?: string[]
}

type DiscoveryOptions = {
  home?: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  readCommand?: (launcher: string, profileHome: string) => Promise<string[]>
}

function installedCommand(launcher: string, profileHome: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      launcher,
      ['--print-runtime-command', '--module', 'tui_gateway.entry'],
      {
        env: { ...process.env, HERMES_HOME: profileHome },
        timeout: 15_000,
        maxBuffer: 256 * 1024,
        encoding: 'utf8',
        windowsHide: true
      },
      (error, stdout) => {
        if (error) {
          reject(new Error('Hermes launcher unavailable'))
          return
        }
        try {
          const command: unknown = JSON.parse(stdout)
          if (
            !Array.isArray(command) ||
            command.length < 2 ||
            !command.every((part) => typeof part === 'string')
          ) {
            throw new Error('Invalid runtime command')
          }
          resolve(command)
        } catch {
          reject(new Error('Invalid Hermes runtime command'))
        }
      }
    )
  })
}
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Follow the installed launcher's machine contract before considering a legacy source venv. */
export async function resolveAdamHermesRuntime({
  home = homedir(),
  platform = process.platform,
  env = process.env,
  readCommand = installedCommand
}: DiscoveryOptions = {}): Promise<AdamHermesRuntime | null> {
  try {
    const profileHome = realpathSync(join(home, '.hermes', 'profiles', 'adam'))
    if (!isFile(join(profileHome, 'config.yaml'))) {
      return null
    }
    if (!env.DOBIUS_HERMES_ROOT) {
      const name = platform === 'win32' ? 'hermes.exe' : 'hermes'
      const candidates = env.DOBIUS_HERMES_BIN
        ? [env.DOBIUS_HERMES_BIN]
        : [
            join(home, '.local', 'bin', name),
            ...(env.PATH ?? '')
              .split(delimiter)
              .filter(Boolean)
              .map((dir) => join(dir, name))
          ]
      const launcher = candidates.find(isFile)
      if (launcher) {
        try {
          const [python, ...args] = await readCommand(launcher, profileHome)
          if (isFile(python) && args.length) {
            return { python, args, root: home, profileHome }
          }
        } catch {
          /* Older Hermes launchers do not implement this contract. */
        }
      }
    }
    const root = realpathSync(env.DOBIUS_HERMES_ROOT || join(home, '.hermes', 'hermes-agent'))
    if (!isFile(join(root, 'tui_gateway', 'entry.py'))) {
      return null
    }
    for (const venv of ['.venv', 'venv']) {
      const python =
        platform === 'win32'
          ? join(root, venv, 'Scripts', 'python.exe')
          : join(root, venv, 'bin', 'python')
      // Preserve the executable symlink: Python uses it to locate its virtualenv.
      if (isFile(python)) {
        return { python, root, profileHome }
      }
    }
  } catch {
    /* Report availability without exposing profile credentials or launcher output. */
  }
  return null
}

export function adamHermesEnvironment(runtime: AdamHermesRuntime): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (name.startsWith('HERMES_') || name === '_HERMES_GATEWAY') {
      delete env[name]
    }
  }
  for (const name of [
    'ELECTRON_RUN_AS_NODE',
    'NODE_OPTIONS',
    'PYTHONPATH',
    'PYTHONHOME',
    'DOBIUS_TERMINAL_HANDLE',
    // Why: ADAM is Carson's main agent and uses the whole `dobius` command line. The
    // agent scope is for background worker runs and must never be inherited here.
    'DOBIUS_RUNTIME_SCOPE'
  ]) {
    delete env[name]
  }
  return {
    ...env,
    HERMES_HOME: runtime.profileHome,
    // Installation-bound commands own their import paths and dependency generations.
    ...(!runtime.args ? { HERMES_PYTHON_SRC_ROOT: runtime.root } : {}),
    // Why: `dobius terminal send` marks ADAM's sends with it, so the conductor
    // watches those terminals and tells Carson when they finish (adam-conductor.ts).
    DOBIUS_CALLER: 'adam',
    // Why: `dobius adam notify` is ADAM's alone; this id proves the caller
    // (adam-caller-id.ts). Built once per Hermes spawn, so each restart rotates it.
    [ADAM_CALLER_ID_ENV]: rotateAdamCallerId(),
    HERMES_VOICE: '0',
    HERMES_VOICE_TTS: '0',
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8'
  }
}
