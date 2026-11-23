import { describe, expect, it, vi } from 'vitest'
import type { AdamProgressStep } from '../../shared/adam-progress'
import { AdamHermesVoice } from './adam-hermes-voice'
import type { HermesDesktopEvent, HermesRpc } from './hermes-desktop-rpc'

const runtime = { python: '/runtime/python', root: '/runtime', profileHome: '/profiles/adam' }

function harness() {
  let emit: (event: HermesDesktopEvent) => void = () => undefined
  let compress: ((value: Record<string, unknown>) => void) | null = null
  const request = vi.fn(async (method: string): Promise<Record<string, unknown>> => {
    if (method === 'session.create') {
      return { session_id: 'voice-1' }
    }
    if (method === 'session.compress') {
      return new Promise((resolve) => {
        compress = resolve
      })
    }
    return { status: 'streaming' }
  })
  const steps: AdamProgressStep[] = []
  const compacting: boolean[] = []
  const client = new AdamHermesVoice({
    sessionFile: '/nonexistent/adam-voice-session.json',
    runtime: () => runtime,
    connect: (_r, onEvent) => {
      emit = onEvent
      return { ready: Promise.resolve(), request, close: vi.fn(async () => undefined) } as HermesRpc
    },
    onProgress: (step) => steps.push(step),
    onCompacting: (value) => compacting.push(value)
  })
  const submits = (): number => request.mock.calls.filter(([m]) => m === 'prompt.submit').length
  return {
    client,
    request,
    steps,
    compacting,
    submits,
    emit: (event: HermesDesktopEvent) => emit(event),
    finishCompress: (value: Record<string, unknown>) => compress?.(value)
  }
}

async function firstTurn(h: ReturnType<typeof harness>) {
  const answer = h.client.ask('hello')
  await vi.waitFor(() => expect(h.submits()).toBe(1))
  return { answer }
}

describe('AdamHermesVoice progress and idle tidy (7.13)', () => {
  it('reports progress steps only for the running turn of its own session', async () => {
    const h = harness()
    const { answer } = await firstTurn(h)
    h.emit({ type: 'tool.start', session_id: 'voice-1', payload: { name: 'read_file', args: { path: '/x' } } })
    h.emit({ type: 'tool.start', session_id: 'other', payload: { name: 'terminal' } })
    h.emit({ type: 'status.update', session_id: 'voice-1', payload: { kind: 'compacting' } })
    h.emit({
      type: 'message.complete',
      session_id: 'voice-1',
      payload: { text: 'hi', status: 'complete', usage: { context_percent: 55 } }
    })
    await expect(answer).resolves.toEqual({ kind: 'answer', text: 'hi' })
    h.emit({ type: 'tool.start', session_id: 'voice-1', payload: { name: 'terminal' } })
    expect(h.steps).toEqual(['reading', 'tidying'])
    expect(h.client.contextPercent).toBe(55)
    await h.client.close()
  })

  it('tidy compacts an idle session, and refuses while a turn runs or with no session', async () => {
    const h = harness()
    await expect(h.client.tidy()).resolves.toBe(false)
    const { answer } = await firstTurn(h)
    await expect(h.client.tidy()).resolves.toBe(false)
    h.emit({ type: 'message.complete', session_id: 'voice-1', payload: { text: 'ok', status: 'complete' } })
    await answer
    const tidy = h.client.tidy()
    expect(h.request).toHaveBeenCalledWith('session.compress', { session_id: 'voice-1' }, 720_000)
    h.finishCompress({ status: 'compressed', info: { usage: { context_percent: 8 } } })
    await expect(tidy).resolves.toBe(true)
    expect(h.client.contextPercent).toBe(8)
    expect(h.compacting).toEqual([true, false])
    await h.client.close()
  })

  it('a turn asked during an idle tidy waits for it before submitting', async () => {
    const h = harness()
    const { answer } = await firstTurn(h)
    h.emit({ type: 'message.complete', session_id: 'voice-1', payload: { text: 'ok', status: 'complete' } })
    await answer
    const tidy = h.client.tidy()
    const next = h.client.ask('what is running?')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(h.submits()).toBe(1)
    expect(h.client.compacting).toBe(true)
    h.finishCompress({ status: 'compressed' })
    await tidy
    await vi.waitFor(() => expect(h.submits()).toBe(2))
    h.emit({ type: 'message.complete', session_id: 'voice-1', payload: { text: 'two', status: 'complete' } })
    await expect(next).resolves.toEqual({ kind: 'answer', text: 'two' })
    await h.client.close()
  })
})
