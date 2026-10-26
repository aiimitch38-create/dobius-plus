import { describe, expect, it } from 'vitest'
import { shouldRequeueStartupOnDispose, startupToRequeue } from './terminal-startup-requeue'

describe('shouldRequeueStartupOnDispose', () => {
  const startup = { command: 'claude --dangerously-skip-permissions' }

  it('requeues when the pane is torn down before its spawn was issued', () => {
    expect(
      shouldRequeueStartupOnDispose({ startup, spawnBound: false, tabStillOpen: true })
    ).toBe(true)
  })

  it('does not requeue once the spawn carried the command to the PTY', () => {
    expect(
      shouldRequeueStartupOnDispose({ startup, spawnBound: true, tabStillOpen: true })
    ).toBe(false)
  })

  it('does not requeue for a closed tab or a pane without a startup command', () => {
    expect(
      shouldRequeueStartupOnDispose({ startup, spawnBound: false, tabStillOpen: false })
    ).toBe(false)
    expect(
      shouldRequeueStartupOnDispose({ startup: null, spawnBound: false, tabStillOpen: true })
    ).toBe(false)
  })
})

describe('startupToRequeue', () => {
  it('drops the setup-split wait and keeps the connect launch token', () => {
    const requeued = startupToRequeue(
      {
        command: 'codex',
        launchAgent: 'codex',
        launchConfig: { agentCommand: 'codex', agentArgs: '--yolo', agentEnv: {} },
        waitForSetupSplitDirection: 'vertical'
      },
      'token-1'
    )
    expect(requeued).toEqual({
      command: 'codex',
      launchAgent: 'codex',
      launchConfig: { agentCommand: 'codex', agentArgs: '--yolo', agentEnv: {} },
      launchToken: 'token-1'
    })
    expect('waitForSetupSplitDirection' in requeued).toBe(false)
  })

  it('leaves plain startup commands without a synthetic launch token', () => {
    expect(startupToRequeue({ command: 'npm test' }, undefined)).toEqual({ command: 'npm test' })
  })
})
