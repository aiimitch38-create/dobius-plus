// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  AGENT_HOOK_TARGETS,
  type AgentHookInstallStatus
} from '../../../../shared/agent-hook-types'
import type { PreloadApi } from '../../../../preload/api-types'
import {
  AgentHookInstallStatusList,
  createAgentHookStatusLoader
} from './AgentHookInstallStatusList'

afterEach(cleanup)

function status(
  agent: AgentHookInstallStatus['agent'],
  state: AgentHookInstallStatus['state'],
  extra: Partial<AgentHookInstallStatus> = {}
): AgentHookInstallStatus {
  return {
    agent,
    state,
    configPath: `/home/me/.${agent}/settings.json`,
    managedHooksPresent: state === 'installed',
    detail: null,
    ...extra
  }
}

function row(agent: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-agent-hook="${agent}"]`)
  if (!element) {
    throw new Error(`missing row ${agent}`)
  }
  return element
}

describe('AgentHookInstallStatusList', () => {
  it('shows each agent with its install state, config path and detail', async () => {
    const load = vi.fn(async () => [
      status('claude', 'installed'),
      status('codex', 'partial', { detail: 'Stop hook missing' }),
      status('gemini', 'not_installed'),
      status('cursor', 'error', { configPath: '', detail: 'Permission denied' })
    ])
    render(<AgentHookInstallStatusList loadStatuses={load} />)
    await waitFor(() => expect(row('claude').textContent).toContain('Installed'))
    expect(row('claude').textContent).toContain('Claude')
    expect(row('claude').textContent).toContain('/home/me/.claude/settings.json')
    expect(row('codex').textContent).toContain('Partly installed')
    expect(row('codex').textContent).toContain('Stop hook missing')
    expect(row('gemini').textContent).toContain('Not installed')
    expect(row('cursor').textContent).toContain('Could not check')
    expect(row('cursor').textContent).toContain('Permission denied')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('disables Check again while a read is in flight and re-reads on click', async () => {
    let resolveSecond: (value: AgentHookInstallStatus[]) => void = () => {}
    const load = vi
      .fn<() => Promise<AgentHookInstallStatus[]>>()
      .mockResolvedValueOnce([status('claude', 'not_installed')])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          })
      )
    render(<AgentHookInstallStatusList loadStatuses={load} />)
    const button = await screen.findByRole('button', { name: 'Check again' })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    const busy = screen.getByRole('button', { name: 'Checking…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    fireEvent.click(busy)
    expect(load).toHaveBeenCalledTimes(2)
    resolveSecond([status('claude', 'installed')])
    await waitFor(() => expect(row('claude').textContent).toContain('Installed'))
    expect(
      (screen.getByRole('button', { name: 'Check again' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('re-reads when the hooks switch is saved (reloadKey changes)', async () => {
    const load = vi.fn(async () => [status('claude', 'installed')])
    const view = render(<AgentHookInstallStatusList loadStatuses={load} reloadKey={0} />)
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    view.rerender(<AgentHookInstallStatusList loadStatuses={load} reloadKey={1} />)
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  })

  it('reads every hook target through status calls only, isolating one failing agent', async () => {
    const calls: string[] = []
    const api = Object.fromEntries(
      [
        'claudeStatus',
        'openClaudeStatus',
        'codexStatus',
        'geminiStatus',
        'antigravityStatus',
        'ampStatus',
        'cursorStatus',
        'droidStatus',
        'commandCodeStatus',
        'grokStatus',
        'copilotStatus',
        'hermesStatus',
        'devinStatus',
        'kimiStatus'
      ].map((name, index) => [
        name,
        async () => {
          calls.push(name)
          if (name === 'codexStatus') {
            throw new Error('config unreadable')
          }
          return status(AGENT_HOOK_TARGETS[index], 'installed')
        }
      ])
    ) as unknown as PreloadApi['agentHooks']
    const result = await createAgentHookStatusLoader(api)()
    expect(calls).toHaveLength(AGENT_HOOK_TARGETS.length)
    expect(result.map((entry) => entry.agent)).toEqual([...AGENT_HOOK_TARGETS])
    expect(result.find((entry) => entry.agent === 'codex')).toMatchObject({
      state: 'error',
      detail: 'config unreadable'
    })
    expect(result.find((entry) => entry.agent === 'kimi')?.state).toBe('installed')
  })

  it('reports every agent as unchecked when the window has no hook API', async () => {
    const result = await createAgentHookStatusLoader(null)()
    expect(result).toHaveLength(AGENT_HOOK_TARGETS.length)
    expect(result.every((entry) => entry.state === 'error')).toBe(true)
  })
})
