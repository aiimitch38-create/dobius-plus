import { describe, expect, it } from 'vitest'
import { strictLayaProviderRequest } from './laya-http-provider'
import { health, jsonResponse, request, systemOneResponse } from './laya-http-provider.fixtures'
import { providerHarness as harness } from './laya-http-provider.test-support'

describe('Laya HTTP provider response and cancellation contract', () => {
  it.each([
    ['wrong model', systemOneResponse(undefined, { model: 'english' })],
    [
      'extra question',
      systemOneResponse(undefined, { answers: { dobius_decision: {}, other: {} } })
    ],
    [
      'unknown choice',
      systemOneResponse(undefined, {
        answers: {
          dobius_decision: {
            type: 'choice',
            choice: 'archive-candidate',
            probabilities: { 'opaque-target': 0.5, 'needs-human': 0.5 }
          }
        }
      })
    ],
    [
      'wrong probability labels',
      systemOneResponse(undefined, {
        answers: {
          dobius_decision: {
            type: 'choice',
            choice: 'opaque-target',
            probabilities: { 'opaque-target': 0.9, invalid: 0.1 }
          }
        }
      })
    ],
    [
      'non-normalized probabilities',
      systemOneResponse(undefined, {
        answers: {
          dobius_decision: {
            type: 'choice',
            choice: 'opaque-target',
            probabilities: { 'opaque-target': 0.9, 'needs-human': 0.2 }
          }
        }
      })
    ]
  ])('rejects %s from the response model', async (_name, output) => {
    const h = harness({
      fetch: async (input) =>
        new URL(String(input)).pathname === '/health'
          ? jsonResponse(health())
          : jsonResponse(output)
    })
    await expect(h.provider.decide(request(), new AbortController().signal)).rejects.toThrow()
  })

  it('rejects redirects and limits each decision to one in-flight call', async () => {
    const redirect = harness({
      fetch: async () =>
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9999/' } })
    })
    expect(await redirect.provider.availability('kanban', new AbortController().signal)).toBe(
      'unavailable'
    )

    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const serialized = harness({
      fetch: async (input) => {
        if (new URL(String(input)).pathname === '/health') {
          return jsonResponse(health())
        }
        await held
        return jsonResponse(systemOneResponse())
      }
    })
    const first = serialized.provider.decide(request(), new AbortController().signal)
    await Promise.resolve()
    await expect(
      serialized.provider.decide(request(), new AbortController().signal)
    ).rejects.toThrow(/one request/)
    release()
    await expect(first).resolves.toMatchObject({ decision: 'opaque-target' })
  })

  it('rejects oversized health or inference responses before accepting a decision', async () => {
    const nonJsonHealth = harness({
      fetch: async (input) => {
        if (new URL(String(input)).pathname === '/health') {
          return new Response(JSON.stringify(health()), {
            status: 200,
            headers: { 'content-type': 'text/plain' }
          })
        }
        return jsonResponse(systemOneResponse())
      }
    })
    expect(await nonJsonHealth.provider.availability('kanban', new AbortController().signal)).toBe(
      'unavailable'
    )

    const oversized = harness({
      fetch: async (input) => {
        if (new URL(String(input)).pathname === '/health') {
          return jsonResponse(health())
        }
        return new Response(JSON.stringify(systemOneResponse()), {
          status: 200,
          headers: { 'content-type': 'application/json', 'content-length': '32769' }
        })
      }
    })
    await expect(
      oversized.provider.decide(request(), new AbortController().signal)
    ).rejects.toThrow(/size limit/)
  })

  it('aborts network work at the local deadline and rejects invalid strict requests', async () => {
    const deadline = harness({
      deadlineMs: 50,
      fetch: async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
        if (new URL(String(input)).pathname === '/health') {
          return jsonResponse(health())
        }
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      }
    })
    await expect(
      deadline.provider.decide(request(), new AbortController().signal)
    ).rejects.toThrow()

    expect(() =>
      strictLayaProviderRequest(
        request({
          surface: 'kanban',
          facts: { hardFailure: false, verifiedCompleted: false },
          choices: ['priority-low', 'done']
        })
      )
    ).toThrow(/surface labels/)
    expect(() => strictLayaProviderRequest(request({ choices: ['opaque-target'] }))).toThrow(
      /surface labels/
    )
    expect(() => strictLayaProviderRequest({ ...request(), unexpected: 'field' })).toThrow()
  })

  it('propagates caller cancellation to the pending HTTP request', async () => {
    let markPostStarted!: () => void
    const postStarted = new Promise<void>((resolve) => {
      markPostStarted = resolve
    })
    const cancelled = harness({
      fetch: async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
        if (new URL(String(input)).pathname === '/health') {
          return jsonResponse(health())
        }
        markPostStarted()
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      }
    })
    const controller = new AbortController()
    const pending = cancelled.provider.decide(request(), controller.signal)
    await postStarted
    controller.abort()
    await expect(pending).rejects.toThrow()
  })
})
