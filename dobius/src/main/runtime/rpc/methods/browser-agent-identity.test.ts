import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import { BROWSER_CORE_METHODS } from './browser-core'
import { BROWSER_EXTRA_METHODS } from './browser-extras'
import { BROWSER_SCREENCAST_METHODS } from './browser-screencast'
import { AGENT_BROWSER_METHOD_POLICY } from './browser-agent-policy'
import { getAgentCommandIdentity } from '../../../browser/agent-command-context'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('browser RPC agent identity', () => {
  it('runs browser handlers inside the agent identity carried by --as / DOBIUS_AGENT_ID', async () => {
    const seen: unknown[] = []
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      browserClick: vi.fn(async () => {
        seen.push(getAgentCommandIdentity())
        return { clicked: '@e1' }
      }),
      browserType: vi.fn(async () => {
        seen.push(getAgentCommandIdentity())
        return { typed: true }
      })
    } as unknown as DobiusRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: BROWSER_CORE_METHODS })

    await dispatcher.dispatch(
      makeRequest('browser.click', {
        page: 'web-tile:card-1',
        element: '@e1',
        agent: 'adam',
        agentName: 'Adam',
        fast: true
      })
    )
    await dispatcher.dispatch(makeRequest('browser.click', { page: 'web-tile:card-1', element: '@e1' }))
    await dispatcher.dispatch(
      makeRequest('browser.type', { page: 'web-tile:card-1', input: 'hi', agent: 'maya' })
    )
    // Why: identities must not survive outside the handler that carried them.
    expect(getAgentCommandIdentity()).toBeNull()

    expect(seen).toEqual([
      { agentId: 'adam', name: 'Adam', fast: true },
      null,
      { agentId: 'maya', name: 'Maya', fast: false }
    ])
  })

  it('ignores malformed agent ids instead of guessing an identity', async () => {
    const seen: unknown[] = []
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      browserClick: vi.fn(async () => {
        seen.push(getAgentCommandIdentity())
        return { clicked: '@e1' }
      })
    } as unknown as DobiusRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: BROWSER_CORE_METHODS })
    await dispatcher.dispatch(
      makeRequest('browser.click', { page: 'p', element: '@e1', agent: 'Not Valid!' })
    )
    expect(seen).toEqual([null])
  })

  it('rejects reserved or malformed display names and falls back to the id', async () => {
    const seen: unknown[] = []
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      browserClick: vi.fn(async () => {
        seen.push(getAgentCommandIdentity())
        return { clicked: '@e1' }
      })
    } as unknown as DobiusRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: BROWSER_CORE_METHODS })
    for (const agentName of [
      'Carson',
      'SYSTEM',
      'you',
      'Dobius',
      'Carson.',
      'Carson 2',
      'Dobius AI',
      'You-',
      '<b>x</b>',
      'a'.repeat(33)
    ]) {
      await dispatcher.dispatch(
        makeRequest('browser.click', { page: 'p', element: '@e1', agent: 'adam', agentName })
      )
    }
    await dispatcher.dispatch(
      makeRequest('browser.click', { page: 'p', element: '@e1', agent: 'carson' })
    )
    await dispatcher.dispatch(
      makeRequest('browser.click', { page: 'p', element: '@e1', agent: 'dobius-2' })
    )
    expect(seen.map((s) => (s as { name: string }).name)).toEqual([
      ...Array<string>(10).fill('Adam'),
      'Agent carson',
      'Agent dobius-2'
    ])
  })
})

describe('browser RPC agent method policy', () => {
  // Why: BROWSER_CORE_METHODS already spreads the text methods (fill/type/insertText).
  const allMethods = [...BROWSER_CORE_METHODS, ...BROWSER_EXTRA_METHODS, ...BROWSER_SCREENCAST_METHODS]

  it('classifies every browser method as staged, read or deny (no silent bypass)', () => {
    const names = new Set(allMethods.map((m) => m.name))
    expect(names.size).toBeGreaterThan(70)
    const missing = [...names].filter((name) => !(name in AGENT_BROWSER_METHOD_POLICY))
    expect(missing).toEqual([])
    const stale = Object.keys(AGENT_BROWSER_METHOD_POLICY).filter((name) => !names.has(name))
    expect(stale).toEqual([])
  })

  it("every browser method's params schema accepts agent / agentName / fast", () => {
    for (const method of allMethods) {
      expect(method.params, method.name).not.toBeNull()
      const shape = (method.params as unknown as { shape?: Record<string, unknown> }).shape
      expect(shape && 'agent' in shape && 'agentName' in shape && 'fast' in shape, method.name).toBe(true)
    }
  })

  it('sees the identity on methods that previously had no params, and denies tab/profile mutations', async () => {
    const seen: unknown[] = []
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      browserProfileList: vi.fn(async () => {
        seen.push(getAgentCommandIdentity())
        return { profiles: [] }
      }),
      browserTabClose: vi.fn(async () => ({ closed: true })),
      browserTabList: vi.fn(async () => {
        seen.push(getAgentCommandIdentity())
        return { tabs: [] }
      })
    } as unknown as DobiusRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: allMethods })
    await dispatcher.dispatch(makeRequest('browser.profileList', { agent: 'adam' }))
    await dispatcher.dispatch(makeRequest('browser.tabList', { agent: 'adam' }))
    expect(seen).toEqual([
      { agentId: 'adam', name: 'Adam', fast: false },
      { agentId: 'adam', name: 'Adam', fast: false }
    ])
    const closed = await dispatcher.dispatch(makeRequest('browser.tabClose', { index: 0, agent: 'adam' }))
    expect(JSON.stringify(closed)).toContain('agent_action_forbidden')
    expect((runtime as unknown as { browserTabClose: ReturnType<typeof vi.fn> }).browserTabClose).not.toHaveBeenCalled()
  })

  it('keeps raw DOM / blind input / file / tab-management methods on the deny list', () => {
    for (const name of [
      'browser.eval',
      'browser.exec',
      'browser.find',
      'browser.mouseDown',
      'browser.mouseUp',
      'browser.upload',
      'browser.download',
      'browser.tabClose',
      'browser.cookie.set',
      'browser.setCredentials',
      'browser.clipboardWrite'
    ]) {
      expect(AGENT_BROWSER_METHOD_POLICY[name]).toBe('deny')
    }
    for (const name of [
      'browser.click',
      'browser.dblclick',
      'browser.type',
      'browser.fill',
      'browser.keypress',
      'browser.scroll',
      'browser.drag',
      'browser.hover',
      'browser.select',
      'browser.goto',
      'browser.back',
      'browser.forward',
      'browser.reload',
      'browser.highlight',
      'browser.mouseClick',
      'browser.dialogAccept'
    ]) {
      expect(AGENT_BROWSER_METHOD_POLICY[name]).toBe('staged')
    }
  })

  it('refuses denied methods for an identified agent before the runtime runs, but not for humans', async () => {
    const browserEval = vi.fn(async () => ({ result: 'x', origin: 'o' }))
    const browserExec = vi.fn(async () => ({}))
    const browserMouseDown = vi.fn(async () => ({}))
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      browserEval,
      browserExec,
      browserMouseDown
    } as unknown as DobiusRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: allMethods })

    const denied = await dispatcher.dispatch(
      makeRequest('browser.eval', { page: 'web-tile:c', expression: '1', agent: 'adam' })
    )
    expect(JSON.stringify(denied)).toContain('agent_action_forbidden')
    expect(browserEval).not.toHaveBeenCalled()

    const deniedExec = await dispatcher.dispatch(
      makeRequest('browser.exec', { page: 'web-tile:c', command: 'click @e1', agent: 'adam' })
    )
    expect(JSON.stringify(deniedExec)).toContain('agent_action_forbidden')
    expect(browserExec).not.toHaveBeenCalled()

    const deniedExtra = await dispatcher.dispatch(
      makeRequest('browser.mouseDown', { page: 'web-tile:c', agent: 'adam' })
    )
    expect(JSON.stringify(deniedExtra)).toContain('agent_action_forbidden')
    expect(browserMouseDown).not.toHaveBeenCalled()

    await dispatcher.dispatch(makeRequest('browser.eval', { page: 'tab-1', expression: '1' }))
    expect(browserEval).toHaveBeenCalledTimes(1)
  })
})
