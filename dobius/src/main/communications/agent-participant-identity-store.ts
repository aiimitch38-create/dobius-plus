// Companion to participant-identity-store.ts: each Dobius-managed agent needs
// its own Nostr signing identity so it can post Communications replies as
// itself. The webview version generated these client-side into
// window.localStorage (dobiusCommunications.ts's `agentIdentity`), which the
// native tab can't reach (separate storage partition) and shouldn't reuse
// anyway — same rationale as the user's own identity: keep private keys out
// of the renderer entirely.
import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { safeStorage } from 'electron'
import { readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeSecureFile } from '../../shared/secure-file'
import type {
  SignedCommunicationsEvent,
  UnsignedCommunicationsEvent
} from './participant-identity-store'

const REGISTRY_FILE = 'communications-agent-identities.enc'

type AgentIdentityEntry = { privateKeyHex: string; pubkeyHex: string }
type AgentIdentityRegistry = Record<string, AgentIdentityEntry>

let cachedRegistry: AgentIdentityRegistry | null = null
let lastLoggedUnavailableDetail: string | null = null

/**
 * The shared agent identity file exists but could not be read, decrypted or
 * parsed. The file is left exactly as it is; no agent gets a new identity.
 */
export class AgentIdentityRegistryUnavailableError extends Error {
  constructor(
    readonly filePath: string,
    readonly detail: string
  ) {
    super(
      `Communications agent identities are unavailable (${detail}); the file at ${filePath} ` +
        'was kept unchanged and no new agent identities were created.'
    )
    this.name = 'AgentIdentityRegistryUnavailableError'
  }
}

function getRegistryPath(): string {
  return join(homedir(), '.dobius', REGISTRY_FILE)
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'))
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {return String(error.code)}
  return error instanceof Error ? error.message : String(error)
}

function parseRegistry(text: string): AgentIdentityRegistry | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {return undefined}
  for (const entry of Object.values(parsed)) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as Partial<AgentIdentityEntry>).privateKeyHex !== 'string' ||
      typeof (entry as Partial<AgentIdentityEntry>).pubkeyHex !== 'string'
    ) {
      return undefined
    }
  }
  return parsed as AgentIdentityRegistry
}

// Returns the registry, or a short reason (never file contents) it could not be decoded.
function decodeRegistry(raw: Buffer): AgentIdentityRegistry | string {
  let decryptProblem = 'encryption unavailable'
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return parseRegistry(safeStorage.decryptString(raw)) ?? 'unexpected registry shape'
    } catch (error) {
      decryptProblem = `decrypt failed: ${errorText(error)}`
    }
  }
  // Why: a file written while encryption was unavailable is plaintext JSON.
  return parseRegistry(raw.toString('utf8')) ?? decryptProblem
}

function unavailable(path: string, detail: string): AgentIdentityRegistryUnavailableError {
  if (lastLoggedUnavailableDetail !== detail) {
    lastLoggedUnavailableDetail = detail
    console.error(
      `[agent-participant-identity-store] agent identity registry unavailable (${path}: ${detail}); ` +
        'keeping the file and refusing to generate replacement identities'
    )
  }
  return new AgentIdentityRegistryUnavailableError(path, detail)
}

/**
 * Empty only when no registry file exists. Any other failure throws
 * AgentIdentityRegistryUnavailableError and is re-tried on the next call, so
 * a transient Keychain or read failure recovers every existing agent identity.
 */
function readRegistry(): AgentIdentityRegistry {
  if (cachedRegistry) {return cachedRegistry}

  const path = getRegistryPath()
  let raw: Buffer
  try {
    raw = readFileSync(path)
  } catch (error) {
    if (errorText(error) === 'ENOENT') {
      cachedRegistry = {}
      return cachedRegistry
    }
    throw unavailable(path, errorText(error))
  }

  const decoded = decodeRegistry(raw)
  if (typeof decoded === 'string') {
    throw unavailable(path, decoded)
  }
  lastLoggedUnavailableDetail = null
  cachedRegistry = decoded
  return cachedRegistry
}

function writeRegistry(registry: AgentIdentityRegistry): void {
  const serialized = JSON.stringify(registry)
  const contents = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(serialized)
    : Buffer.from(serialized, 'utf8')
  // Atomic temp + rename, 0600: an interrupted write leaves every agent's identity intact.
  writeSecureFile(getRegistryPath(), contents)
  cachedRegistry = registry
}

/** Reads an agent's Communications pubkey, generating its identity if none exists yet. */
export function ensureAgentIdentity(agentId: string): { pubkey: string } {
  const registry = readRegistry()
  const existing = registry[agentId]
  if (existing) {return { pubkey: existing.pubkeyHex }}

  const privateKeyBytes = schnorr.utils.randomPrivateKey()
  const entry: AgentIdentityEntry = {
    privateKeyHex: bytesToHex(privateKeyBytes),
    pubkeyHex: bytesToHex(schnorr.getPublicKey(privateKeyBytes))
  }
  writeRegistry({ ...registry, [agentId]: entry })
  return { pubkey: entry.pubkeyHex }
}

function computeEventId(
  pubkeyHex: string,
  createdAt: number,
  kind: number,
  tags: string[][],
  content: string
): Uint8Array {
  const serialized = JSON.stringify([0, pubkeyHex, createdAt, kind, tags, content])
  return sha256(new TextEncoder().encode(serialized))
}

/** Signs an event as the given agent. Throws if the agent has no identity yet. */
export function signAsAgent(
  agentId: string,
  event: UnsignedCommunicationsEvent
): SignedCommunicationsEvent {
  const registry = readRegistry()
  const identity = registry[agentId]
  if (!identity) {throw new Error(`No Communications identity for agent ${agentId}`)}

  const createdAt = event.createdAt ?? Math.floor(Date.now() / 1000)
  const idBytes = computeEventId(identity.pubkeyHex, createdAt, event.kind, event.tags, event.content)
  const sigBytes = schnorr.sign(idBytes, hexToBytes(identity.privateKeyHex))

  return {
    id: bytesToHex(idBytes),
    pubkey: identity.pubkeyHex,
    created_at: createdAt,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: bytesToHex(sigBytes)
  }
}

/** Test/reset hook only — clears the in-memory cache and the on-disk file. */
export function clearAgentIdentityRegistry(): void {
  cachedRegistry = null
  rmSync(getRegistryPath(), { force: true })
}
