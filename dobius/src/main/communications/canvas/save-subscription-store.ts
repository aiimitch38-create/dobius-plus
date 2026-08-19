/**
 * Durable JSON-file store for save subscriptions. Same shape of work as
 * team-store.ts/channel-template-store.ts (one array file in userData,
 * atomic tmp-then-rename write), keyed by the composite key
 * save-subscription-record.ts's `subscriptionKey()` computes instead of a
 * single `id`, since a subscription is identified by
 * (identityPubkey, relayUrl, scopeType, scopeValue), not a generated id.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import {
  assertValidIdentityPubkey,
  assertValidRelayUrl,
  assertValidScopeType,
  assertValidScopeValue,
  normalizeKinds,
  ownerSubscriptionKey,
  sanitizeSaveSubscriptionRow,
  subscriptionKey,
  type SaveSubscription
} from './save-subscription-record'

const FILE_NAME = 'save-subscriptions.json'

let cached: SaveSubscription[] | null = null

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function load(): SaveSubscription[] {
  if (cached) {return cached}
  try {
    const raw = JSON.parse(readFileSync(filePath(), 'utf-8'))
    cached = Array.isArray(raw) ? raw.map(sanitizeSaveSubscriptionRow).filter((row): row is SaveSubscription => row !== null) : []
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      console.warn('[save-subscriptions] failed to load save subscriptions:', error instanceof Error ? error.message : String(error))
    }
    cached = []
  }
  return cached
}

function persist(subscriptions: SaveSubscription[]): void {
  const target = filePath()
  const tmp = `${target}.${process.pid}.tmp`
  try {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(tmp, `${JSON.stringify(subscriptions, null, 2)}\n`, 'utf-8')
    renameSync(tmp, target)
  } catch (error) {
    console.warn('[save-subscriptions] failed to persist save subscriptions:', error instanceof Error ? error.message : String(error))
  }
}

export function listSaveSubscriptions(identityPubkey: string, relayUrl: string): SaveSubscription[] {
  const pubkey = assertValidIdentityPubkey(identityPubkey)
  const relay = assertValidRelayUrl(relayUrl)
  return load()
    .filter((entry) => entry.identityPubkey === pubkey && entry.relayUrl === relay)
    .map((entry) => ({ ...entry, kinds: [...entry.kinds] }))
}

/** Create-or-replace: a repeat create_save_subscription call for the same
 * (identity, relay, scopeType, scopeValue) overwrites `kinds` rather than
 * erroring — the vendor "Runs an access probe on the backend" doc comment
 * describes Rust-only defense-in-depth (channel membership checks) that
 * does not apply to this single-user local relay, so create here is a
 * plain idempotent upsert. */
export function createSaveSubscription(
  identityPubkey: string,
  relayUrl: string,
  scopeType: unknown,
  scopeValue: unknown,
  kinds: unknown
): SaveSubscription {
  const pubkey = assertValidIdentityPubkey(identityPubkey)
  const relay = assertValidRelayUrl(relayUrl)
  const type = assertValidScopeType(scopeType)
  const value = assertValidScopeValue(scopeValue)
  const record: SaveSubscription = { identityPubkey: pubkey, relayUrl: relay, scopeType: type, scopeValue: value, kinds: normalizeKinds(kinds), createdAt: Date.now() }
  const key = subscriptionKey(record)
  const subscriptions = load().filter((entry) => subscriptionKey(entry) !== key)
  subscriptions.push(record)
  cached = subscriptions
  persist(subscriptions)
  return record
}

export function deleteSaveSubscription(identityPubkey: string, relayUrl: string, scopeType: unknown, scopeValue: unknown): boolean {
  const key = subscriptionKey({
    identityPubkey: assertValidIdentityPubkey(identityPubkey),
    relayUrl: assertValidRelayUrl(relayUrl),
    scopeType: assertValidScopeType(scopeType),
    scopeValue: assertValidScopeValue(scopeValue)
  })
  const subscriptions = load()
  const next = subscriptions.filter((entry) => subscriptionKey(entry) !== key)
  const removed = next.length !== subscriptions.length
  if (removed) {
    cached = next
    persist(next)
  }
  return removed
}

function upsertOwnerRow(identityPubkey: string, relayUrl: string, mutate: (kinds: number[]) => number[]): SaveSubscription | null {
  const target = ownerSubscriptionKey(identityPubkey, relayUrl)
  const targetKey = subscriptionKey(target)
  const subscriptions = load()
  const existing = subscriptions.find((entry) => subscriptionKey(entry) === targetKey)
  const nextKinds = mutate(existing ? [...existing.kinds] : [])
  const others = subscriptions.filter((entry) => subscriptionKey(entry) !== targetKey)

  if (nextKinds.length === 0) {
    cached = others
    persist(others)
    return null
  }
  const record: SaveSubscription = { ...target, kinds: normalizeKinds(nextKinds), createdAt: existing?.createdAt ?? Date.now() }
  const next = [...others, record]
  cached = next
  persist(next)
  return record
}

/** Atomically merges `kind` into the caller's own `owner_p` subscription,
 * creating the row if it did not exist. Mirrors the Rust
 * read-modify-write-in-one-transaction contract described in
 * mergeSaveSubscriptionKinds's vendor doc comment — this store's module
 * cache + synchronous fs calls give the same effective atomicity for a
 * single-process Electron main. */
export function mergeSaveSubscriptionKinds(identityPubkey: string, relayUrl: string, kind: unknown): SaveSubscription {
  if (typeof kind !== 'number' || !Number.isInteger(kind)) {
    throw new Error('Missing save subscription kind')
  }
  const record = upsertOwnerRow(identityPubkey, relayUrl, (kinds) => [...kinds, kind])
  // mutate always adds one kind, so the row can never come back empty here.
  return record as SaveSubscription
}

/** Removes `kind` from the caller's own `owner_p` subscription, deleting
 * the row entirely once its kind list becomes empty — mirrors
 * removeSaveSubscriptionKind's vendor doc comment. */
export function removeSaveSubscriptionKind(identityPubkey: string, relayUrl: string, kind: unknown): SaveSubscription | null {
  if (typeof kind !== 'number' || !Number.isInteger(kind)) {
    throw new Error('Missing save subscription kind')
  }
  return upsertOwnerRow(identityPubkey, relayUrl, (kinds) => kinds.filter((existing) => existing !== kind))
}
