import { PassThrough, Readable } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { readAdamIntentRequest } from './adam-cloud-child'
import type * as RuntimeClientModule from '../runtime-client'
import {
  adamBindingGrant,
  adamJobInput
} from '../../main/automations/cloud-jobs/cloud-job-adam-client.fixtures'
import {
  AdamLookupApprovedIntentRequest,
  AdamSubmitApprovedIntentRequest
} from '../../shared/cloud-job-adam-intent-wire'

const { calls, constructors } = vi.hoisted(() => ({ calls: vi.fn(), constructors: vi.fn() }))
vi.mock('../runtime-client', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeClientModule>()
  return {
    ...actual,
    RuntimeClient: vi.fn(function (...args: unknown[]) {
      constructors(...args)
      return { call: calls }
    })
  }
})
import { main } from '../index'

const request = () => {
  const grant = adamBindingGrant()
  const { capability: _capability, ...identity } = grant
  return {
    schemaVersion: 1,
    audienceRuntimeId: '357e37d6-2be7-4c5f-9fc6-9573b3bb8c52',
    credential: Buffer.alloc(32, 4).toString('base64url'),
    intentId: grant.bindingId,
    identity,
    sealedEnvelope: 'sealed:dobius-adam-intent:v1:YWJjZA==',
    approvedJob: adamJobInput()
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  calls.mockReset()
  constructors.mockReset()
  process.exitCode = undefined
})

it('bounds stdin and rejects invalid UTF-8, oversized, and malformed JSON with fixed errors', async () => {
  expect(await readAdamIntentRequest(Readable.from([JSON.stringify(request())]))).toEqual(request())
  for (const content of [
    Buffer.from([0xff]),
    Buffer.alloc(131_073, 97),
    '{"secret":"synthetic-private"'
  ]) {
    await expect(readAdamIntentRequest(Readable.from([content]))).rejects.toThrow(
      'Invalid, oversized, or incomplete ADAM request.'
    )
  }
  expect(AdamSubmitApprovedIntentRequest.safeParse({ ...request(), untrusted: true }).success).toBe(
    false
  )
})

it('bounds unfinished stdin and removes readers when the deadline expires', async () => {
  const stream = new PassThrough()
  await expect(readAdamIntentRequest(stream, 25)).rejects.toThrow('incomplete')
  expect(stream.listenerCount('data')).toBe(0)
  expect(stream.listenerCount('end')).toBe(0)
  stream.destroy()
})

it('forces local selection and submits only sealed intent data on stdin RPC', async () => {
  vi.stubEnv('DOBIUS_ENVIRONMENT', 'must-not-use')
  vi.stubEnv('DOBIUS_PAIRING_CODE', 'must-not-use')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const stream = new PassThrough()
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stream as unknown as typeof process.stdin)
  calls.mockResolvedValue({
    id: 'fixture',
    ok: true,
    result: { job: { id: 'child', state: 'queued' } },
    _meta: { runtimeId: 'fixture' }
  })
  const pending = main(['submit-adam-child', '--request-stdin', '--json'])
  await new Promise((resolve) => setImmediate(resolve))
  stream.end(Buffer.from(JSON.stringify(request())))
  await pending
  expect(constructors).toHaveBeenCalledWith(undefined, undefined, null, null)
  expect(calls).toHaveBeenCalledWith('adam.submitApprovedIntent', request(), { timeoutMs: 10_000 })
  expect(JSON.stringify(calls.mock.calls)).not.toContain(adamBindingGrant().capability)
})

it('seals capability input only through bounded stdin and returns no grant', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const stream = new PassThrough()
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stream as unknown as typeof process.stdin)
  const sealRequest = {
    schemaVersion: 1,
    audienceRuntimeId: request().audienceRuntimeId,
    credential: request().credential,
    envelope: {
      schemaVersion: 1,
      intentId: request().intentId,
      identity: request().identity,
      capability: adamBindingGrant().capability
    }
  }
  calls.mockResolvedValue({
    id: 'fixture',
    ok: true,
    result: { sealedEnvelope: request().sealedEnvelope },
    _meta: { runtimeId: 'fixture' }
  })
  const pending = main(['seal-adam-intent', '--request-stdin', '--json'])
  await new Promise((resolve) => setImmediate(resolve))
  stream.end(Buffer.from(JSON.stringify(sealRequest)))
  await pending
  expect(calls).toHaveBeenCalledWith('adam.sealApprovedIntent', sealRequest, { timeoutMs: 10_000 })
})

it('looks up only through the local sealed-packet RPC and accepts a null child', async () => {
  vi.stubEnv('DOBIUS_ENVIRONMENT', 'must-not-use')
  vi.stubEnv('DOBIUS_PAIRING_CODE', 'must-not-use')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const stream = new PassThrough()
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stream as unknown as typeof process.stdin)
  calls.mockResolvedValue({
    id: 'fixture',
    ok: true,
    result: {
      schemaVersion: 1,
      audienceRuntimeId: request().audienceRuntimeId,
      intentId: request().intentId,
      identity: request().identity,
      job: null
    },
    _meta: { runtimeId: 'fixture' }
  })
  const pending = main(['lookup-adam-child', '--request-stdin', '--json'])
  await new Promise((resolve) => setImmediate(resolve))
  stream.end(Buffer.from(JSON.stringify(request())))
  await pending

  expect(constructors).toHaveBeenCalledWith(undefined, undefined, null, null)
  expect(calls).toHaveBeenCalledWith('adam.lookupApprovedIntent', request(), { timeoutMs: 10_000 })
  expect(AdamLookupApprovedIntentRequest.safeParse(request()).success).toBe(true)
})

it('prints an exact read-only lookup result through the locally selected runtime', async () => {
  vi.stubEnv('DOBIUS_ENVIRONMENT', 'must-not-use')
  vi.stubEnv('DOBIUS_PAIRING_CODE', 'must-not-use')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const stream = new PassThrough()
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stream as unknown as typeof process.stdin)
  const job = { id: 'existing-child', state: 'succeeded' }
  calls.mockResolvedValue({
    id: 'fixture',
    ok: true,
    result: {
      schemaVersion: 1,
      audienceRuntimeId: request().audienceRuntimeId,
      intentId: request().intentId,
      identity: request().identity,
      job
    },
    _meta: { runtimeId: 'fixture' }
  })
  const pending = main(['lookup-adam-child', '--request-stdin', '--json'])
  await new Promise((resolve) => setImmediate(resolve))
  stream.end(Buffer.from(JSON.stringify(request())))
  await pending

  expect(calls).toHaveBeenCalledOnce()
  expect(calls).toHaveBeenCalledWith('adam.lookupApprovedIntent', request(), { timeoutMs: 10_000 })
  expect(JSON.stringify(calls.mock.calls)).not.toContain(adamBindingGrant().capability)
})
