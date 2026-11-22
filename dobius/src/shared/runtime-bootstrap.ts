import { join } from 'node:path'

export type RuntimeTransportMetadata =
  | {
      kind: 'unix'
      endpoint: string
    }
  | {
      kind: 'named-pipe'
      endpoint: string
    }
  | {
      kind: 'websocket'
      endpoint: string
    }

export type RuntimeMetadata = {
  runtimeId: string
  pid: number
  transports: RuntimeTransportMetadata[]
  authToken: string | null
  startedAt: number
}

// Why: the CLI must handle metadata files written by older Dobius versions that
// used a singular `transport` field. This helper extracts the first transport
// matching the given kinds from either the new `transports` array or the
// legacy `transport` field.
export function findTransport(
  metadata: RuntimeMetadata,
  ...kinds: RuntimeTransportMetadata['kind'][]
): RuntimeTransportMetadata | null {
  const transports = metadata.transports
  if (transports && Array.isArray(transports)) {
    return transports.find((t) => kinds.includes(t.kind)) ?? null
  }
  // Why: backward compatibility with pre-transports-array metadata files.
  const legacy = (metadata as Record<string, unknown>).transport as RuntimeTransportMetadata | null
  if (legacy && kinds.includes(legacy.kind)) {
    return legacy
  }
  return null
}

const PRIMARY_RUNTIME_METADATA_FILE = 'dobius-runtime.json'

export function getRuntimeMetadataPath(userDataPath: string): string {
  return join(userDataPath, PRIMARY_RUNTIME_METADATA_FILE)
}

// Why: background (sandboxed) agent runs must not hold the full runtime
// key. The runtime also publishes a second bootstrap file with the same
// endpoint and a narrower agent key; the server maps that key to a short
// method allowlist (main/runtime/agent-rpc-scope.ts). The agent sandbox denies
// reading the full file, so a sandboxed CLI can only ever find this one.
const AGENT_RUNTIME_METADATA_FILE = 'dobius-runtime-agent.json'

export function getAgentRuntimeMetadataPath(userDataPath: string): string {
  return join(userDataPath, AGENT_RUNTIME_METADATA_FILE)
}

/** Set on background agent runs (SDK, Codex, postchecks); the CLI then uses the agent key. */
export const DOBIUS_RUNTIME_SCOPE_ENV = 'DOBIUS_RUNTIME_SCOPE'
export const AGENT_RUNTIME_SCOPE = 'agent'

export function isAgentRuntimeScope(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return env[DOBIUS_RUNTIME_SCOPE_ENV] === AGENT_RUNTIME_SCOPE
}
