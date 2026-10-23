import { describe, expect, it } from 'vitest'
import { getAgentResumeSpawnTarget } from '../../shared/agent-resume-owner'
import { createAgentResumeClaims } from './agent-resume-claims'

const owner = {
  authority: { kind: 'local' as const },
  worktreeId: 'worktree-a',
  tabId: 'tab-a',
  leafId: '11111111-1111-4111-8111-111111111111',
  paneKey: 'tab-a:11111111-1111-4111-8111-111111111111',
  ptyId: 'pty-a',
  launchToken: 'launch-a',
  agent: 'codex' as const,
  providerSession: { key: 'session_id' as const, id: 'codex-session-a' }
}

const duplicateOwner = {
  ...owner,
  worktreeId: 'worktree-b',
  tabId: 'tab-b',
  leafId: '22222222-2222-4222-8222-222222222222',
  paneKey: 'tab-b:22222222-2222-4222-8222-222222222222',
  ptyId: 'pty-b',
  launchToken: 'launch-b'
}

describe('main-process agent resume claims', () => {
  it('serializes simultaneous startup-sweep and cold-restore claims', async () => {
    let tokenSequence = 0
    const claims = createAgentResumeClaims(() => `token-${++tokenSequence}`)
    const results = await Promise.all([
      Promise.resolve().then(() => claims.claim(owner)),
      Promise.resolve().then(() => claims.claim(duplicateOwner))
    ])

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
  })

  it('fails closed for forged runtime input even when called outside IPC validation', () => {
    const claims = createAgentResumeClaims(() => 'token-a')
    expect(claims.claim({ ...owner, paneKey: 'other-pane' } as never)).toEqual({ ok: false })
  })

  it('allows only one owner across concurrent copied records and worktrees', () => {
    const claims = createAgentResumeClaims(() => 'token-a')

    expect(claims.claim(owner)).toEqual({
      ok: true,
      token: 'token-a',
      target: getAgentResumeSpawnTarget(owner)
    })
    expect(claims.claim(duplicateOwner)).toEqual({ ok: false })
  })

  it('keeps identical provider ids separate across distinct SSH authorities', () => {
    let tokenSequence = 0
    const claims = createAgentResumeClaims(() => `token-${++tokenSequence}`)
    const firstRemoteOwner = {
      ...owner,
      authority: { kind: 'ssh' as const, connectionId: 'ssh-a' }
    }
    const secondRemoteOwner = {
      ...owner,
      authority: { kind: 'ssh' as const, connectionId: 'ssh-b' }
    }
    const duplicateFirstRemoteOwner = {
      ...duplicateOwner,
      authority: { kind: 'ssh' as const, connectionId: 'ssh-a' }
    }

    expect(claims.claim(firstRemoteOwner)).toEqual({
      ok: true,
      token: 'token-1',
      target: getAgentResumeSpawnTarget(firstRemoteOwner)
    })
    expect(claims.claim(secondRemoteOwner)).toEqual({
      ok: true,
      token: 'token-2',
      target: getAgentResumeSpawnTarget(secondRemoteOwner)
    })
    expect(claims.claim(duplicateFirstRemoteOwner)).toEqual({ ok: false })
  })

  it('binds a spawn token to its exact authority, pane, PTY, and launch generation', () => {
    const claims = createAgentResumeClaims(() => 'token-a')
    const claim = claims.claim(owner)
    expect(claim).toEqual({ ok: true, token: 'token-a', target: getAgentResumeSpawnTarget(owner) })
    if (!claim.ok) {
      return
    }

    expect(claims.beginSpawn(claim.token, duplicateOwner, claim.target)).toBe(false)
    expect(claims.beginSpawn(claim.token, { ...owner, ptyId: 'pty-stale' }, claim.target)).toBe(
      false
    )
    expect(
      claims.beginSpawn(claim.token, owner, { ...claim.target, worktreeId: 'other-worktree' })
    ).toBe(false)
    expect(claims.beginSpawn(claim.token, owner, claim.target)).toBe(true)
    expect(claims.beginSpawn(claim.token, owner, claim.target)).toBe(false)
  })

  it('permits only an exact-owner retry after a failed or released claim', () => {
    let tokenSequence = 0
    const claims = createAgentResumeClaims(() => `token-${++tokenSequence}`)
    const first = claims.claim(owner)
    expect(first).toEqual({ ok: true, token: 'token-1', target: getAgentResumeSpawnTarget(owner) })
    if (!first.ok) {
      return
    }

    expect(claims.beginSpawn(first.token, owner, first.target)).toBe(true)
    expect(claims.finishSpawn(first.token, false)).toBe(true)
    expect(claims.claim(duplicateOwner)).toEqual({ ok: false })
    const retry = claims.claim(owner)
    expect(retry).toEqual({ ok: true, token: 'token-2', target: getAgentResumeSpawnTarget(owner) })
  })

  it('does not release a successful spawn for another owner to consume', () => {
    const claims = createAgentResumeClaims(() => 'token-a')
    const claim = claims.claim(owner)
    if (!claim.ok) {
      throw new Error('expected first claim')
    }

    expect(claims.beginSpawn(claim.token, owner, claim.target)).toBe(true)
    expect(claims.finishSpawn(claim.token, true)).toBe(true)
    expect(claims.claim(duplicateOwner)).toEqual({ ok: false })
  })
})
