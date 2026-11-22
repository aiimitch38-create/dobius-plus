import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import {
  findTransport,
  getAgentRuntimeMetadataPath,
  getRuntimeMetadataPath,
  isAgentRuntimeScope,
  type RuntimeMetadata
} from '../../shared/runtime-bootstrap'
import { RuntimeClientError } from './types'

/**
 * Inside a Dobius terminal or agent run the CLI uses the agent bootstrap file
 * (limited key). Why the fallback: an older Dobius app writes only the full
 * file, and the CLI must keep working against it. The agent sandbox denies
 * reading the full file, so a sandboxed agent cannot use either fallback.
 */
export function resolveMetadataPath(
  userDataPath: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const fullPath = getRuntimeMetadataPath(userDataPath)
  if (!isAgentRuntimeScope(env)) {
    return fullPath
  }
  const agentPath = getAgentRuntimeMetadataPath(userDataPath)
  if (!existsSync(agentPath)) {
    return fullPath
  }
  // Why: an agent file left by a crashed newer app must not shadow an older
  // app that is running now. Unreadable full file (the sandbox) = agent file.
  const agentRuntimeId = readRuntimeId(agentPath)
  const fullRuntimeId = readRuntimeId(fullPath)
  if (fullRuntimeId && agentRuntimeId !== fullRuntimeId) {
    return fullPath
  }
  return agentPath
}

function readRuntimeId(path: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { runtimeId?: unknown } | null
    return typeof parsed?.runtimeId === 'string' ? parsed.runtimeId : null
  } catch {
    return null
  }
}

export function readMetadata(userDataPath: string): RuntimeMetadata {
  const metadataPath = resolveMetadataPath(userDataPath)
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as RuntimeMetadata | null
    if (!metadata || !findTransport(metadata, 'unix', 'named-pipe') || !metadata.authToken) {
      throw new RuntimeClientError(
        'runtime_unavailable',
        `Dobius runtime metadata is incomplete at ${metadataPath}`
      )
    }
    return metadata
  } catch (error) {
    if (error instanceof RuntimeClientError) {
      throw error
    }
    throw new RuntimeClientError(
      'runtime_unavailable',
      `Could not read Dobius runtime metadata at ${metadataPath}. Start the Dobius app first.`
    )
  }
}

export function tryReadMetadata(userDataPath: string): RuntimeMetadata | null {
  const metadataPath = resolveMetadataPath(userDataPath)
  try {
    return JSON.parse(readFileSync(metadataPath, 'utf8')) as RuntimeMetadata | null
  } catch {
    return null
  }
}

export function getDefaultUserDataPath(
  platform: NodeJS.Platform = process.platform,
  homeDir = homedir()
): string {
  // Why: in dev mode (and for parallel Dobius instances), the Electron app writes
  // runtime metadata to a separate userData directory (e.g. `dobius-dev`) to avoid
  // clobbering the production app's metadata. The CLI needs to find the same
  // metadata file, so this env var lets the CLI target a specific instance.
  if (process.env.DOBIUS_USER_DATA_PATH) {
    return process.env.DOBIUS_USER_DATA_PATH
  }
  // Why: Electron's userData path is derived from package.json "name"
  // ("dobius-plus"), captured before app.setName('Dobius+') runs — see
  // persistence.ts's initDataPath(). The CLI must match that exact
  // lowercase, hyphenated folder name, not the display name.
  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', 'dobius-plus')
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA
    if (!appData) {
      throw new RuntimeClientError(
        'runtime_unavailable',
        'APPDATA is not set, so the Dobius runtime metadata path cannot be resolved.'
      )
    }
    return join(appData, 'dobius-plus')
  }
  // Why: the CLI must find the same metadata file Electron writes in packaged
  // runs, so this mirrors Electron's default userData base instead of inventing
  // a CLI-specific config path.
  return join(process.env.XDG_CONFIG_HOME || join(homeDir, '.config'), 'dobius-plus')
}
