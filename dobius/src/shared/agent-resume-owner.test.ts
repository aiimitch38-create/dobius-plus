import { describe, expect, it } from 'vitest'
import {
  getAgentResumeClaimKey,
  getAgentResumeOwnerFingerprint,
  getAgentResumeSpawnTarget,
  encodeAgentResumeSpawnClaim,
  parseAgentResumeOwner,
  parseAgentResumeSpawnClaim
} from './agent-resume-owner'

const owner = {
  authority: { kind: 'local' as const },
  worktreeId: 'worktree-a',
  tabId: 'tab-a',
  leafId: '11111111-1111-4111-8111-111111111111',
  paneKey: 'tab-a:11111111-1111-4111-8111-111111111111',
  ptyId: 'pty-a',
  launchToken: 'launch-a',
  terminalHandle: 'terminal-a',
  agent: 'codex' as const,
  providerSession: { key: 'session_id' as const, id: 'codex-session-a' }
}

describe('agent resume owner', () => {
  it('requires stable tab/leaf, PTY, launch, and provider identity as one tuple', () => {
    expect(parseAgentResumeOwner(owner)).toEqual(owner)
    expect(parseAgentResumeOwner({ ...owner, tabId: 'tab-b' })).toBeNull()
    expect(parseAgentResumeOwner({ ...owner, ptyId: '' })).toBeNull()
    expect(parseAgentResumeOwner({ ...owner, launchToken: '' })).toBeNull()
    expect(parseAgentResumeOwner({ ...owner, ptyId: 'pty\0a' })).toBeNull()
    expect(
      parseAgentResumeOwner({
        ...owner,
        authority: { kind: 'ssh', connectionId: 'ssh\nother' }
      })
    ).toBeNull()
  })

  it('deduplicates by execution authority and provider session, not worktree or pane', () => {
    const sameSessionElsewhere = {
      ...owner,
      worktreeId: 'worktree-b',
      tabId: 'tab-b',
      leafId: '22222222-2222-4222-8222-222222222222',
      paneKey: 'tab-b:22222222-2222-4222-8222-222222222222',
      ptyId: 'pty-b',
      launchToken: 'launch-b'
    }
    expect(getAgentResumeClaimKey(owner)).toBe(getAgentResumeClaimKey(sameSessionElsewhere))
    expect(getAgentResumeOwnerFingerprint(owner)).not.toBe(
      getAgentResumeOwnerFingerprint(sameSessionElsewhere)
    )
    expect(
      getAgentResumeClaimKey({
        ...owner,
        authority: { kind: 'ssh', connectionId: 'ssh-other' }
      })
    ).not.toBe(getAgentResumeClaimKey(owner))
  })

  it('requires the server-approved same-worktree target in the spawn envelope', () => {
    const claim = { token: 'claim-token', owner, target: getAgentResumeSpawnTarget(owner) }
    expect(parseAgentResumeSpawnClaim(encodeAgentResumeSpawnClaim(claim))).toEqual(claim)
    expect(
      parseAgentResumeSpawnClaim(
        JSON.stringify({ ...claim, target: { ...claim.target, worktreeId: 'other' } })
      )
    ).not.toBeNull()
    expect(parseAgentResumeSpawnClaim(JSON.stringify({ token: claim.token, owner }))).toBeNull()
  })
})
