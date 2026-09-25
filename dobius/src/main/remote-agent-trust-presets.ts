import type { AgentTrustPreset } from './agent-trust-presets'
import { upsertProjectTrustLevelInContent } from './codex/config-toml-trust'
import { getActiveMultiplexer } from './ipc/ssh'
import { getSshFilesystemProvider } from './providers/ssh-filesystem-dispatch'
import type { IFilesystemProvider } from './providers/types'
import {
  isWindowsAbsolutePathLike,
  normalizeRuntimePathSeparators
} from '../shared/cross-platform-path'

export async function markRemoteAgentWorkspaceTrusted(args: {
  preset: AgentTrustPreset
  connectionId: string
  workspacePath: string
}): Promise<void> {
  const home = await resolveRemoteHome(args.connectionId)
  const fsProvider = getSshFilesystemProvider(args.connectionId)
  if (!home || !fsProvider) {
    return
  }

  const workspacePath = await canonicalizeRemoteWorkspacePath(fsProvider, args.workspacePath)
  if (args.preset === 'codex') {
    await markRemoteCodexProjectTrusted(fsProvider, home, workspacePath)
  } else if (args.preset === 'cursor') {
    await markRemoteCursorWorkspaceTrusted(fsProvider, home, workspacePath)
  } else if (args.preset === 'copilot') {
    await markRemoteCopilotFolderTrusted(fsProvider, home, workspacePath)
  }
}

async function resolveRemoteHome(connectionId: string): Promise<string | null> {
  const mux = getActiveMultiplexer(connectionId)
  if (!mux || mux.isDisposed?.()) {
    return null
  }
  const result = (await mux.request('session.resolveHome', { path: '~' })) as {
    resolvedPath?: unknown
  }
  const home =
    typeof result.resolvedPath === 'string'
      ? normalizeRuntimePathSeparators(result.resolvedPath.trim())
      : ''
  return home &&
    (home.startsWith('/') || isWindowsAbsolutePathLike(home)) &&
    !hasRemotePathControlCharacter(home)
    ? home.replace(/\/$/, '')
    : null
}

function hasRemotePathControlCharacter(value: string): boolean {
  return value.includes(String.fromCharCode(0)) || value.includes('\r') || value.includes('\n')
}

async function canonicalizeRemoteWorkspacePath(
  fsProvider: IFilesystemProvider,
  workspacePath: string
): Promise<string> {
  try {
    return await fsProvider.realpath(workspacePath)
  } catch {
    return workspacePath
  }
}

function remoteErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
}

// Why: the relay forwards the remote errno as the JSON-RPC error code
// (fs.stat -> 'ENOENT'). Only a missing file may be treated as empty; any
// other failure (EACCES, dropped connection, size cap) must not lead to a
// write that replaces the user's remote config.
function isRemoteFileMissing(error: unknown): boolean {
  return (
    remoteErrorCode(error) === 'ENOENT' ||
    (error instanceof Error && error.message.startsWith('ENOENT'))
  )
}

// Returns '' only when the file does not exist; throws on every other read
// problem so the caller never overwrites a file it could not read.
async function readRemoteTextFile(
  fsProvider: IFilesystemProvider,
  filePath: string
): Promise<string> {
  let result: Awaited<ReturnType<IFilesystemProvider['readFile']>>
  try {
    result = await fsProvider.readFile(filePath)
  } catch (error) {
    if (isRemoteFileMissing(error)) {
      return ''
    }
    const detail = remoteErrorCode(error) ?? (error instanceof Error ? error.message : 'unknown')
    console.warn(`[agent-trust] not updating ${filePath}: remote read failed (${detail})`)
    throw new Error(`Could not read remote ${filePath} (${detail}); left it unchanged`)
  }
  if (result.isBinary) {
    console.warn(`[agent-trust] not updating ${filePath}: remote file is not text`)
    throw new Error(`Remote ${filePath} is not a text file; left it unchanged`)
  }
  return result.content
}

async function markRemoteCodexProjectTrusted(
  fsProvider: IFilesystemProvider,
  remoteHome: string,
  workspacePath: string
): Promise<void> {
  const codexDir = `${remoteHome}/.codex`
  const configPath = `${codexDir}/config.toml`
  const existing = await readRemoteTextFile(fsProvider, configPath)
  const updated = upsertProjectTrustLevelInContent(existing, workspacePath, 'trusted', {
    // Why: workspacePath was resolved by the remote filesystem provider; local
    // realpath would canonicalize the wrong machine on SSH.
    alreadyCanonical: true
  })
  if (updated === existing) {
    return
  }
  await fsProvider.createDir(codexDir)
  await fsProvider.writeFile(configPath, updated)
}

async function markRemoteCursorWorkspaceTrusted(
  fsProvider: IFilesystemProvider,
  remoteHome: string,
  workspacePath: string
): Promise<void> {
  const slug = workspacePath.replace(/^[\\/]+/, '').replace(/[\\/:*?"<>|]+/g, '-')
  if (!slug) {
    return
  }
  const trustDir = `${remoteHome}/.cursor/projects/${slug}`
  const trustFile = `${trustDir}/.workspace-trusted`
  try {
    await fsProvider.stat(trustFile)
    return
  } catch {
    // Missing marker: write the same shape the local trust preset writes.
  }
  await fsProvider.createDir(trustDir)
  await fsProvider.writeFile(
    trustFile,
    `${JSON.stringify({ trustedAt: new Date().toISOString(), workspacePath }, null, 2)}\n`
  )
}

async function markRemoteCopilotFolderTrusted(
  fsProvider: IFilesystemProvider,
  remoteHome: string,
  workspacePath: string
): Promise<void> {
  const configDir = `${remoteHome}/.copilot`
  const configPath = `${configDir}/config.json`
  const raw = await readRemoteTextFile(fsProvider, configPath)
  let config: Record<string, unknown> = {}
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        // Why: replacing a non-object config with {} would drop its contents.
        return
      }
      config = parsed as Record<string, unknown>
    } catch {
      return
    }
  }
  const existing = Array.isArray(config.trustedFolders) ? (config.trustedFolders as unknown[]) : []
  if (existing.includes(workspacePath)) {
    return
  }
  config.trustedFolders = [...existing.filter((entry) => typeof entry === 'string'), workspacePath]
  await fsProvider.createDir(configDir)
  await fsProvider.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
}
