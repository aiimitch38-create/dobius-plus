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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  SignedCommunicationsEvent,
  UnsignedCommunicationsEvent
} from './participant-identity-store'

const REGISTRY_FILE = 'communications-agent-identities.enc'

type AgentIdentityEntry = { privateKeyHex: string; pubkeyHex: string }
type AgentIdentityRegistry = Record<string, AgentIdentityEntry>

let cachedRegistry: AgentIdentityRegistry | null = null

function getRegistryPath(): string {
  return join(homedir(), '.dobius', REGISTRY_FILE)
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'))
}

function readRegistry(): AgentIdentityRegistry {
  if (cachedRegistry) {return cachedRegistry}

  const path = getRegistryPath()
  if (!existsSync(path)) {
    cachedRegistry = {}
    return cachedRegistry
  }

  const raw = readFileSync(path)
  const decrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(raw)
    : raw.toString('utf8')
  cachedRegistry = JSON.parse(decrypted) as AgentIdentityRegistry
  return cachedRegistry
}

function writeRegistry(registry: AgentIdentityRegistry): void {
  const dir = join(homedir(), '.dobius')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const serialized = JSON.stringify(registry)
  const contents = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(serialized)
    : Buffer.from(serialized, 'utf8')
  writeFileSync(getRegistryPath(), contents, { mode: 0o600 })
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
