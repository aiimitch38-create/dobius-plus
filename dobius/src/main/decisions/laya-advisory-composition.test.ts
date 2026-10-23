import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LayaAuthoritySnapshot as SnapshotSchema,
  type LayaAdvisoryIdentity
} from '../../shared/laya-advisory'
import { LayaAdvisoryJournal } from './laya-advisory-journal'
import { createLayaAdvisoryComposition } from './laya-advisory-composition'
import {
  deploymentReceipt,
  gate,
  health,
  jsonResponse,
  systemOneResponse
} from './laya-http-provider.fixtures'

const directories: string[] = []
const sourceRevision = 'job-1:v1'

function setup(
  options: {
    enabled?: boolean
    epoch?: () => unknown
    receipt?: (signal: AbortSignal) => Promise<unknown>
    authorization?: (signal: AbortSignal) => Promise<string | null>
    currentGate?: (signal: AbortSignal) => Promise<unknown>
    fetch?: typeof fetch
    deadlineMs?: number
    maxConcurrent?: number
  } = {}
) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'dobius-laya-composition-'))
  directories.push(directory)
  const journal = new LayaAdvisoryJournal(join(directory, 'journal.jsonl'))
  const epoch = { current: options.epoch ?? (() => 4) }
  const identity: LayaAdvisoryIdentity = { surface: 'job-routing', subjectIds: ['job-1'] }
  const authority = {
    read: vi.fn(async () =>
      SnapshotSchema.parse({
        schemaVersion: 1,
        surface: 'job-routing',
        subjectIds: identity.subjectIds,
        sourceRevision,
        capturedAt: 1_000,
        expiresAt: 10_000,
        evidenceRefs: ['4'.repeat(64)],
        facts: {
          nativeAppleRequired: false,
          targetSupportsNativeApple: true,
          dependenciesReady: true
        },
        eligibleChoices: ['http-target', 'needs-human']
      })
    )
  }
  const deploymentGate = {
    current: vi.fn(options.currentGate ?? (async () => gate()))
  }
  const fetchImpl: typeof fetch =
    options.fetch ??
    (async (input, init) => {
      if (new URL(String(input)).pathname === '/health') {
        return jsonResponse(health())
      }
      const body = JSON.parse(String(init?.body)) as {
        questions: Record<string, { criteria: string[] }>
      }
      return jsonResponse(systemOneResponse(body.questions.dobius_decision!.criteria))
    })
  const fetchMock = vi.fn(fetchImpl)
  const authorization = vi.fn(options.authorization ?? (async () => 'synthetic-token'))
  const receipt = vi.fn(options.receipt ?? (async () => deploymentReceipt()))
  const service = createLayaAdvisoryComposition({
    enabled: options.enabled,
    authority,
    deploymentGate,
    authorityEpoch: epoch,
    journal,
    readDeploymentReceipt: receipt,
    resolveAuthorization: authorization,
    fetch: fetchMock,
    now: () => 2_000,
    monotonicNow: () => 10,
    deadlineMs: options.deadlineMs,
    maxConcurrent: options.maxConcurrent,
    cacheTtlMs: 0
  })
  return {
    service,
    identity,
    authority,
    deploymentGate,
    journal,
    fetchMock,
    authorization,
    receipt
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Laya advisory composition', () => {
  it('stays disabled by default without constructing or calling provider readers', async () => {
    const { service, identity, fetchMock, authorization, receipt } = setup()
    expect(await service.advise(identity)).toMatchObject({
      status: 'unavailable',
      reason: 'provider-not-deployed'
    })
    expect(authorization).not.toHaveBeenCalled()
    expect(receipt).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the composition query-only and unavailable until an accepted gate exists', async () => {
    const { service, identity, fetchMock, authorization } = setup({
      enabled: true,
      currentGate: async () => null
    })
    expect(Object.keys(service)).toEqual(['advise'])
    expect('execute' in service).toBe(false)
    expect('mutate' in service).toBe(false)
    expect(await service.advise(identity)).toMatchObject({ status: 'unavailable' })
    expect(authorization).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed on a stale coherent epoch before provider readers or fetch', async () => {
    const { service, identity, authority, fetchMock, authorization, receipt } = setup({
      enabled: true,
      epoch: () => Number.NaN
    })
    expect(await service.advise(identity)).toMatchObject({
      status: 'unavailable',
      reason: 'authority-epoch-unavailable'
    })
    expect(authority.read).not.toHaveBeenCalled()
    expect(receipt).not.toHaveBeenCalled()
    expect(authorization).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks provider fetch when the shared epoch changes during trusted receipt resolution', async () => {
    let currentEpoch = 4
    const { service, identity, fetchMock, authorization } = setup({
      enabled: true,
      epoch: () => currentEpoch,
      receipt: async () => {
        currentEpoch += 1
        return deploymentReceipt()
      }
    })
    expect(await service.advise(identity)).toMatchObject({ status: 'unavailable' })
    expect(authorization).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bounds caller completion while an uncooperative receipt read retains service occupancy', async () => {
    let releaseReceipt!: (value: unknown) => void
    const receiptPending = new Promise<unknown>((resolve) => {
      releaseReceipt = resolve
    })
    const { service, identity, fetchMock } = setup({
      enabled: true,
      deadlineMs: 50,
      maxConcurrent: 1,
      receipt: async () => receiptPending
    })
    const result = await service.advise(identity)
    expect(result).toMatchObject({ status: 'unavailable', reason: 'deadline' })
    expect(await service.advise(identity)).toMatchObject({
      status: 'unavailable',
      reason: 'backpressure'
    })
    expect(fetchMock).not.toHaveBeenCalled()
    releaseReceipt(deploymentReceipt())
    await vi.waitFor(() => expect(fetchMock).not.toHaveBeenCalled())
  })
})
