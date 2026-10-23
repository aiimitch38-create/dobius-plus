import type { Readable } from 'node:stream'
import {
  AdamLookupApprovedIntentRequest,
  AdamSealApprovedIntentRequest,
  AdamSubmitApprovedIntentRequest
} from '../../shared/cloud-job-adam-intent-wire'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import type { CommandHandler } from '../dispatch'

const MAX_ADAM_REQUEST_BYTES = 131_072

export function readAdamIntentRequest(input: Readable, timeoutMs = 5_000): Promise<unknown> {
  if ((input as Readable & { isTTY?: boolean }).isTTY) {
    return Promise.reject(
      new RuntimeClientError('invalid_argument', 'A piped ADAM request is required.')
    )
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      input.off('data', onData)
      input.off('end', onEnd)
      input.off('error', onError)
      input.pause()
    }
    const fail = () => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(
        new RuntimeClientError(
          'invalid_argument',
          'Invalid, oversized, or incomplete ADAM request.'
        )
      )
    }
    const onData = (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += data.length
      if (bytes > MAX_ADAM_REQUEST_BYTES) {
        return fail()
      }
      chunks.push(data)
    }
    const onError = () => fail()
    const onEnd = () => {
      if (settled) {
        return
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
        const value: unknown = JSON.parse(text)
        settled = true
        cleanup()
        resolve(value)
      } catch {
        fail()
      }
    }
    const timer = setTimeout(fail, timeoutMs)
    input.on('data', onData)
    input.once('end', onEnd)
    input.once('error', onError)
  })
}

function parseRequest<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  value: unknown
): T {
  try {
    const result = schema.safeParse(value)
    if (result.success && result.data !== undefined) {
      return result.data
    }
  } catch {
    // Caller controlled object behavior is redacted at this CLI boundary.
  }
  throw new RuntimeClientError('invalid_argument', 'Invalid ADAM request.')
}

export const ADAM_CLOUD_CHILD_HANDLERS: Record<string, CommandHandler> = {
  'seal-adam-intent': async ({ client, flags, json }) => {
    if (flags.get('request-stdin') !== true) {
      throw new RuntimeClientError('invalid_argument', 'Use --request-stdin for an ADAM request.')
    }
    const request = parseRequest(
      AdamSealApprovedIntentRequest,
      await readAdamIntentRequest(process.stdin)
    )
    const response = await client.call('adam.sealApprovedIntent', request, { timeoutMs: 10_000 })
    printResult(response, json, () => 'ADAM intent sealed.')
  },
  'submit-adam-child': async ({ client, flags, json }) => {
    if (flags.get('request-stdin') !== true) {
      throw new RuntimeClientError('invalid_argument', 'Use --request-stdin for an ADAM request.')
    }
    const request = parseRequest(
      AdamSubmitApprovedIntentRequest,
      await readAdamIntentRequest(process.stdin)
    )
    const response = await client.call<{ job: { id: string; state: string } }>(
      'adam.submitApprovedIntent',
      request,
      { timeoutMs: 10_000 }
    )
    printResult(response, json, (value) => `Cloud child ${value.job.id}: ${value.job.state}`)
  },
  'lookup-adam-child': async ({ client, flags, json }) => {
    if (flags.get('request-stdin') !== true) {
      throw new RuntimeClientError('invalid_argument', 'Use --request-stdin for an ADAM request.')
    }
    const request = parseRequest(
      AdamLookupApprovedIntentRequest,
      await readAdamIntentRequest(process.stdin)
    )
    const response = await client.call<{ job: { id: string; state: string } | null }>(
      'adam.lookupApprovedIntent',
      request,
      { timeoutMs: 10_000 }
    )
    printResult(response, json, (value) =>
      value.job ? `Cloud child ${value.job.id}: ${value.job.state}` : 'No committed ADAM child.'
    )
  }
}
