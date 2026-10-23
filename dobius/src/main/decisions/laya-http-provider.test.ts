import { describe, expect, it, vi } from 'vitest'
import {
  checkpointRevision,
  deploymentReceipt,
  evaluationDigest,
  health,
  jsonResponse,
  request,
  sourceRevision,
  systemOneResponse
} from './laya-http-provider.fixtures'
import { providerHarness as harness } from './laya-http-provider.test-support'

describe('Laya HTTP provider trust and request contract', () => {
  it('uses the pinned loopback SystemOne route, one typed choice, and facts-only state', async () => {
    const { provider, calls } = harness()
    const result = await provider.decide(request(), new AbortController().signal)

    expect(result).toMatchObject({
      surface: 'job-routing',
      requestDigest: '4'.repeat(64),
      snapshotRevision: '5'.repeat(64),
      sourceRevision,
      checkpointRevision,
      evaluationReportSha256: evaluationDigest,
      decision: 'opaque-target',
      confidence: 0.9,
      providerMeasuredAt: 2_000
    })
    expect(calls.map(({ url, init }) => [new URL(url).pathname, init.method])).toEqual([
      ['/health', 'GET'],
      ['/v1/systemone', 'POST'],
      ['/health', 'GET']
    ])
    const call = calls[1]!
    expect(call.url).toBe('http://127.0.0.1:8000/v1/systemone')
    expect(call.init.redirect).toBe('error')
    expect((call.init.headers as Record<string, string>).authorization).toBe('Bearer synthetic-key')
    const body = JSON.parse(String(call.init.body))
    expect(body).toEqual({
      model: 'multilingual',
      state: JSON.stringify({
        surface: 'job-routing',
        facts: {
          nativeAppleRequired: false,
          targetSupportsNativeApple: true,
          dependenciesReady: true
        }
      }),
      questions: {
        dobius_decision: { type: 'choice', criteria: ['opaque-target', 'needs-human'] }
      }
    })
    expect(JSON.stringify(body)).not.toMatch(
      /subjectIds|requestDigest|evidenceRefs|sourceRevision|checkpointRevision|evaluationReportSha256|notes|terminal/i
    )
  })

  it('requires an authenticated health response with the exact loaded checkpoint revision', async () => {
    const liveness = harness({
      fetch: vi.fn(async (input) =>
        new URL(String(input)).pathname === '/health'
          ? jsonResponse({ status: 'ok' })
          : jsonResponse(systemOneResponse())
      )
    })
    expect(await liveness.provider.availability('kanban', new AbortController().signal)).toBe(
      'unavailable'
    )

    const wrongRevision = harness({
      fetch: vi.fn(async (input) =>
        new URL(String(input)).pathname === '/health'
          ? jsonResponse(health({ revisions: { multilingual: 'f'.repeat(40) } }))
          : jsonResponse(systemOneResponse())
      )
    })
    expect(await wrongRevision.provider.availability('kanban', new AbortController().signal)).toBe(
      'unavailable'
    )
    expect(wrongRevision.calls.map(({ url }) => new URL(url).pathname)).toEqual(['/health'])
  })

  it('fails closed when authorization, receipt pins, endpoint, or epoch proof is missing', async () => {
    const noAuth = harness({ authorization: async () => null })
    expect(await noAuth.provider.availability('kanban', new AbortController().signal)).toBe(
      'unavailable'
    )
    expect(noAuth.calls).toHaveLength(0)

    const remote = harness({
      receipt: () => deploymentReceipt({ endpoint: 'https://example.test/' })
    })
    expect(await remote.provider.availability('kanban', new AbortController().signal)).toBe(
      'unavailable'
    )
    expect(remote.calls).toHaveLength(0)

    const wrongPin = harness({
      receipt: () =>
        deploymentReceipt({
          gate: {
            ...deploymentReceipt().gate,
            checkpointRevision: 'a'.repeat(40)
          }
        })
    })
    expect(await wrongPin.provider.availability('kanban', new AbortController().signal)).toBe(
      'unavailable'
    )
    expect(wrongPin.calls).toHaveLength(0)

    const invalidEpoch = harness({ epoch: () => Number.NaN })
    expect(await invalidEpoch.provider.availability('kanban', new AbortController().signal)).toBe(
      'unavailable'
    )
    await expect(
      invalidEpoch.provider.decide(request(), new AbortController().signal)
    ).rejects.toThrow(/epoch/)

    const mismatchedRequest = request({ checkpointRevision: 'f'.repeat(40) })
    const pinned = harness()
    await expect(
      pinned.provider.decide(mismatchedRequest, new AbortController().signal)
    ).rejects.toThrow(/pins do not match/)
    expect(pinned.calls).toHaveLength(0)
  })

  it('rejects epoch or trusted receipt changes while the inference request is in flight', async () => {
    let epoch = 4
    let receipt = deploymentReceipt()
    const changedEpoch = harness({
      epoch: () => epoch,
      fetch: async (input) => {
        if (new URL(String(input)).pathname === '/health') {
          return jsonResponse(health())
        }
        epoch += 1
        return jsonResponse(systemOneResponse())
      }
    })
    await expect(
      changedEpoch.provider.decide(request(), new AbortController().signal)
    ).rejects.toThrow(/epoch changed/)

    const changedReceipt = harness({
      receipt: () => receipt,
      fetch: async (input) => {
        if (new URL(String(input)).pathname === '/health') {
          return jsonResponse(health())
        }
        receipt = deploymentReceipt({
          gate: { ...deploymentReceipt().gate, evaluationReportSha256: 'f'.repeat(64) }
        })
        return jsonResponse(systemOneResponse())
      }
    })
    await expect(
      changedReceipt.provider.decide(request(), new AbortController().signal)
    ).rejects.toThrow(/pins do not match/)

    let changedGate = deploymentReceipt()
    const gateMutation = harness({
      receipt: () => changedGate,
      fetch: async (input) => {
        if (new URL(String(input)).pathname === '/health') {
          return jsonResponse(health())
        }
        changedGate = deploymentReceipt({
          gate: {
            ...deploymentReceipt().gate,
            confidenceThresholds: {
              ...deploymentReceipt().gate.confidenceThresholds,
              'job-routing': 0.85
            }
          }
        })
        return jsonResponse(systemOneResponse())
      }
    })
    await expect(
      gateMutation.provider.decide(request(), new AbortController().signal)
    ).rejects.toThrow(/receipt changed/)
  })
})
