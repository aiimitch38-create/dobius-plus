import { describe, expect, it } from 'vitest'
import { LayaAuthoritySnapshot, type LayaAdvisorySurface } from '../../shared/laya-advisory'
import { validateCandidateLabel } from './laya-advisory-policy'

function snapshot(
  surface: LayaAdvisorySurface,
  facts: Record<string, unknown>,
  eligibleChoices: string[] = []
) {
  const defaults: Record<LayaAdvisorySurface, Record<string, unknown>> = {
    'job-routing': {
      nativeAppleRequired: false,
      targetSupportsNativeApple: true,
      dependenciesReady: true
    },
    kanban: { hardFailure: false, verifiedCompleted: false },
    agents: {
      permissionPrompt: false,
      hardFailure: false,
      processIdentityKnown: true,
      heartbeatFresh: true,
      testsFailed: null
    },
    data: {
      dirty: false,
      pinned: false,
      activeLease: false,
      ownerKnown: true,
      remoteVerified: true,
      inactive: true
    },
    storage: { monitorFresh: true, rootIdentityKnown: true, freeBytesKnown: true },
    verification: {
      hardFailure: false,
      evidenceIncomplete: false,
      testsFailed: null,
      httpFailure: false,
      consoleErrors: null
    }
  }
  return LayaAuthoritySnapshot.parse({
    schemaVersion: 1,
    surface,
    subjectIds: ['subject-1'],
    sourceRevision: 'source:v1',
    capturedAt: 100,
    expiresAt: 200,
    evidenceRefs: ['a'.repeat(64)],
    facts: { ...defaults[surface], ...facts },
    eligibleChoices: surface === 'job-routing' || surface === 'storage' ? eligibleChoices : []
  })
}

describe('Laya deterministic policy', () => {
  it('permits only current eligible routing/storage aliases', () => {
    const routing = snapshot(
      'job-routing',
      { nativeAppleRequired: true, targetSupportsNativeApple: true },
      ['option-1']
    )
    expect(validateCandidateLabel(routing, 'option-1').accepted).toBe(true)
    expect(validateCandidateLabel(routing, 'option-2').veto).toBe(
      'decision-outside-authority-options'
    )
    const storage = snapshot('storage', {}, ['candidate-1'])
    expect(validateCandidateLabel(storage, 'candidate-1').accepted).toBe(true)
    expect(validateCandidateLabel(storage, 'needs-human').accepted).toBe(true)
  })

  it('preserves hard failures, permission gates, and prevents false working labels', () => {
    expect(
      validateCandidateLabel(snapshot('agents', { hardFailure: true }), 'working').accepted
    ).toBe(false)
    expect(
      validateCandidateLabel(snapshot('agents', { permissionPrompt: true }), 'failed').accepted
    ).toBe(false)
    expect(
      validateCandidateLabel(snapshot('agents', { heartbeatFresh: false }), 'working').veto
    ).toBe('missing-live-process-evidence')
    expect(validateCandidateLabel(snapshot('agents', {}), 'waiting-permission').veto).toBe(
      'permission-state-not-observed'
    )
  })

  it('escalates when dependencies, storage authority, or verification facts are incomplete', () => {
    expect(
      validateCandidateLabel(
        snapshot('job-routing', { dependenciesReady: false }, ['target-one']),
        'target-one'
      ).veto
    ).toBe('dependencies-not-ready')
    expect(
      validateCandidateLabel(
        snapshot('storage', { monitorFresh: false }, ['candidate-1']),
        'candidate-1'
      ).veto
    ).toBe('storage-authority-incomplete')
    expect(
      validateCandidateLabel(snapshot('verification', { testsFailed: 1 }), 'routine-review').veto
    ).toBe('observed-failure-requires-deep-review')
  })

  it('keeps protected data local and cannot mark a card done or verification passed', () => {
    expect(
      validateCandidateLabel(
        snapshot('data', { dirty: true, remoteVerified: true }),
        'archive-candidate'
      ).veto
    ).toBe('protected-data-must-remain-local')
    expect(
      validateCandidateLabel(snapshot('kanban', { hardFailure: true }), 'priority-low').accepted
    ).toBe(false)
    expect(validateCandidateLabel(snapshot('kanban', {}), 'done').accepted).toBe(false)
    expect(
      validateCandidateLabel(snapshot('verification', { hardFailure: true }), 'routine-review')
        .accepted
    ).toBe(false)
    expect(validateCandidateLabel(snapshot('verification', {}), 'passed').accepted).toBe(false)
  })

  it('returns human review when a provider abstains', () => {
    expect(validateCandidateLabel(snapshot('verification', {}), null)).toEqual({
      accepted: false,
      veto: null
    })
  })
})
