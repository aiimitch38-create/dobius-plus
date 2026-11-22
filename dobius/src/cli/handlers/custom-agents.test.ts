import { describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import { formatAgentRuns } from '../custom-agent-format'
import { CUSTOM_AGENT_HANDLERS } from './custom-agents'

async function runAgentsRun(flags: Record<string, string | boolean>) {
  const call = vi.fn(async () => ({ result: { runId: 'run-1' } }))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await CUSTOM_AGENT_HANDLERS['agents run']({
    flags: new Map(Object.entries(flags)),
    client: { call },
    json: true
  } as unknown as HandlerContext)
  return call
}

describe('agents run --check', () => {
  it('sends no check unless one is asked for', async () => {
    const call = await runAgentsRun({ id: 'a1', prompt: 'go' })
    expect(call).toHaveBeenCalledWith('agent.run', { id: 'a1', prompt: 'go' })
  })

  it('sends the check command and timeout', async () => {
    const call = await runAgentsRun({
      id: 'a1',
      prompt: 'go',
      check: ' npm test ',
      'check-timeout': '300'
    })
    expect(call).toHaveBeenCalledWith('agent.run', {
      id: 'a1',
      prompt: 'go',
      postcheck: { command: 'npm test', timeoutSeconds: 300 }
    })
  })

  it.each([
    ['a bare --check', { check: true }],
    ['a blank --check', { check: '   ' }],
    ['--check-timeout without --check', { 'check-timeout': '30' }],
    ['a non-numeric --check-timeout', { check: 'npm test', 'check-timeout': 'soon' }]
  ])('refuses %s', async (_label, extra) => {
    await expect(runAgentsRun({ id: 'a1', prompt: 'go', ...extra })).rejects.toMatchObject({
      code: 'invalid_argument'
    })
  })
})

describe('formatAgentRuns', () => {
  it('prints a run with no check exactly as before', () => {
    expect(
      formatAgentRuns({
        runs: [{ id: 'r1', agentId: 'a1', prompt: 'go', startedAt: 0, status: 'success', summary: 'ok' }]
      })
    ).toBe('r1  a1  success  1970-01-01T00:00:00.000Z\nok')
  })

  it('shows the attempt, check result and outcome of a checked run', () => {
    const text = formatAgentRuns({
      runs: [
        {
          id: 'r2',
          agentId: 'a1',
          prompt: 'go',
          startedAt: 0,
          status: 'success',
          attempt: 2,
          rootRunId: 'r1',
          outcome: 'blocked',
          postcheck: {
            command: 'npm test',
            exitCode: 1,
            timedOut: false,
            durationMs: 1,
            stdout: '',
            stderr: '',
            stdoutTruncated: false,
            stderrTruncated: false,
            error: null,
            startedAt: 1,
            completedAt: 2
          }
        }
      ]
    })
    expect(text).toContain('success (attempt 2, check failed, blocked)')
  })
})
