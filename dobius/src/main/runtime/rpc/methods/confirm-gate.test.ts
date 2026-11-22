import { describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import {
  CONFIRM_TEXT_LIMIT,
  confirmText,
  createConfirmationGate,
  decisionConfirmRequest
} from './confirm-gate'

const request = { title: 't', message: 'm', detail: 'd', confirmLabel: 'OK' }
const ctx = {} as RpcContext

describe('confirmation gate', () => {
  it('closes the dialog and refuses once the time window passes', async () => {
    const dialog = vi.fn(
      (_request: unknown, signal: AbortSignal) =>
        new Promise<boolean>((resolve) => signal.addEventListener('abort', () => resolve(true)))
    )
    const gate = createConfirmationGate(dialog, { windowMs: 5, cooldownMs: 0 })
    await expect(gate(request, ctx)).rejects.toThrow('Not confirmed in time')
  })

  it('waits out a cooldown after a decline', async () => {
    let clock = 1000
    const dialog = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const gate = createConfirmationGate(dialog, { cooldownMs: 10_000, now: () => clock })
    await expect(gate(request, ctx)).rejects.toThrow('Not confirmed')
    await expect(gate(request, ctx)).rejects.toThrow('declined')
    expect(dialog).toHaveBeenCalledTimes(1)
    clock += 10_001
    await expect(gate(request, ctx)).resolves.toBeUndefined()
  })

  it('does not act when the caller has gone', async () => {
    const controller = new AbortController()
    controller.abort()
    const gate = createConfirmationGate(vi.fn().mockResolvedValue(true))
    await expect(gate(request, { signal: controller.signal } as RpcContext)).rejects.toThrow(
      'cancelled'
    )
  })
})

describe('confirmText', () => {
  it('strips control and invisible characters and collapses whitespace', () => {
    expect(confirmText('rm\u0000 -rf‮\n\n  /tmp​/x', 'input')).toBe('rm -rf /tmp /x')
  })

  it.each(['\u00ad', '\u061c', '\u2060', '\u200b', '\u202e', '\u2066', '\ufeff', '\u0007'])(
    'strips the hidden character %j',
    (hidden) => {
      expect(confirmText(`a${hidden}b`, 'input')).toBe('a b')
    }
  )

  it('refuses text over the limit instead of clipping it', () => {
    expect(() => confirmText('a'.repeat(CONFIRM_TEXT_LIMIT + 1), 'draft')).toThrow(
      'too long to confirm here'
    )
  })

  it('shows the folder, tool and full input of a decision', () => {
    const shown = decisionConfirmRequest(
      {
        id: 'd',
        runId: 'r',
        agentId: 'a',
        toolName: 'Bash',
        input: { command: 'ls' },
        cwd: '/repo',
        createdAt: 0
      },
      'approve',
      undefined,
      ctx
    )
    expect(shown.detail).toContain('Folder: /repo')
    expect(shown.detail).toContain('Input: {"command":"ls"}')
  })
})
