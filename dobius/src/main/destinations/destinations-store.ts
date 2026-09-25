import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { app } from 'electron'
import type { Destination, DestinationSaveInput, DestinationType } from '../../shared/destinations'
import { hardenExistingSecureFile } from '../../shared/secure-file'
import { parseEveryEntry, SafeJsonFile } from '../storage/safe-json-file'

const FILE_NAME = 'destinations.json'

const DESTINATION_TYPES: DestinationType[] = ['telegram', 'imessage', 'system', 'asana', 'email']

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sanitizeConfig(type: DestinationType, raw: unknown): Destination['config'] {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  switch (type) {
    case 'telegram':
      return { botToken: asString(record.botToken), chatId: asString(record.chatId) }
    case 'imessage':
      return { handle: asString(record.handle) }
    case 'system':
      return {}
    case 'asana':
      return { taskGid: asString(record.taskGid) }
    case 'email':
      return {
        smtpHost: asString(record.smtpHost),
        smtpPort: Math.max(1, Math.round(asFiniteNumber(record.smtpPort, 587))),
        smtpSecure: record.smtpSecure === true,
        smtpUser: asString(record.smtpUser),
        smtpPassword: asString(record.smtpPassword),
        from: asString(record.from),
        to: asString(record.to)
      }
  }
}

function sanitizeDestination(raw: unknown): Destination | null {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const type = DESTINATION_TYPES.find((candidate) => candidate === record.type)
  const id = asString(record.id)
  if (!type || !id) {
    return null
  }
  return {
    id,
    name: asString(record.name) || type,
    type,
    config: sanitizeConfig(type, record.config),
    createdAt: asFiniteNumber(record.createdAt, Date.now()),
    updatedAt: asFiniteNumber(record.updatedAt, Date.now())
  } as Destination
}

// Why: a malformed entry makes the whole file unreadable instead of being
// dropped and then saved over (CX12 F2).
const file = new SafeJsonFile<Destination[]>({
  filePath,
  parse: (raw) => (Array.isArray(raw) ? parseEveryEntry(raw, sanitizeDestination) : undefined),
  fallback: () => [],
  label: `[destinations] ${FILE_NAME}`,
  // Why (BUILD-009C): the file holds Telegram bot tokens and SMTP passwords.
  mode: 0o600
})

// Why (BUILD-009C): builds before this one left the file at the umask
// default (0644). Metadata-cached, so repeat calls cost a stat.
function hardenExistingFile(target: string): void {
  try {
    hardenExistingSecureFile(target)
  } catch (error) {
    console.warn(
      '[destinations] failed to restrict store permissions:',
      error instanceof Error ? error.message : String(error)
    )
  }
}

function load(): Destination[] {
  hardenExistingFile(filePath())
  return file.get()
}

// Why: throws so the renderer's error path shows a refused save instead of
// an edit that silently disappears on restart.
function persist(destinations: Destination[]): void {
  file.save(destinations)
}

export function listDestinations(): Destination[] {
  return [...load()]
}

export function getDestination(id: string): Destination | null {
  return load().find((entry) => entry.id === id) ?? null
}

export function saveDestination(input: DestinationSaveInput): Destination {
  const destinations = load()
  const now = Date.now()
  const existing = input.id ? destinations.find((entry) => entry.id === input.id) : undefined
  const sanitized = sanitizeDestination({
    id: existing?.id ?? randomUUID(),
    name: input.name,
    type: input.type,
    config: input.config,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  })
  if (!sanitized) {
    throw new Error(`Unknown destination type: ${input.type}`)
  }
  const next = existing
    ? destinations.map((entry) => (entry.id === sanitized.id ? sanitized : entry))
    : [...destinations, sanitized]
  persist(next)
  return sanitized
}

export function deleteDestination(id: string): boolean {
  const destinations = load()
  const next = destinations.filter((entry) => entry.id !== id)
  if (next.length === destinations.length) {
    return false
  }
  persist(next)
  return true
}
