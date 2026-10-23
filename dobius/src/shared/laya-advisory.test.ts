import { describe, expect, it } from 'vitest'
import {
  LayaAdvisoryIdentity,
  LayaAuthoritySnapshot,
  LayaDeploymentGate,
  LayaProviderDecision
} from './laya-advisory'

describe('Laya advisory shared contracts', () => {
  it('accepts identifier-only requests and rejects caller-supplied facts', () => {
    expect(LayaAdvisoryIdentity.parse({ surface: 'agents', subjectIds: ['session-1'] })).toEqual({
      surface: 'agents',
      subjectIds: ['session-1']
    })
    expect(
      LayaAdvisoryIdentity.safeParse({
        surface: 'agents',
        subjectIds: ['session-1'],
        facts: { heartbeatFresh: true }
      }).success
    ).toBe(false)
  })

  it('permits only bounded enum and scalar authority facts, never text payloads', () => {
    const base = {
      schemaVersion: 1,
      surface: 'verification',
      subjectIds: ['job-1'],
      sourceRevision: 'job-1:v3',
      capturedAt: 100,
      expiresAt: 200,
      evidenceRefs: ['a'.repeat(64)],
      eligibleChoices: [],
      facts: {
        hardFailure: true,
        evidenceIncomplete: false,
        testsFailed: 1,
        httpFailure: false,
        consoleErrors: 0
      }
    }
    expect(LayaAuthoritySnapshot.safeParse(base).success).toBe(true)
    expect(
      LayaAuthoritySnapshot.safeParse({
        ...base,
        facts: { ...base.facts, transcript: 'build passed' }
      }).success
    ).toBe(false)
    expect(
      LayaAuthoritySnapshot.safeParse({
        ...base,
        facts: { ...base.facts, result: 'arbitrary-user-text' }
      }).success
    ).toBe(false)
  })

  it('requires all surfaces and provenance gates to be explicit', () => {
    const surfaces = ['job-routing', 'kanban', 'agents', 'data', 'storage', 'verification'] as const
    const thresholds = Object.fromEntries(surfaces.map((surface) => [surface, 0.9]))
    const samples = Object.fromEntries(surfaces.map((surface) => [surface, 20]))
    const gate = {
      status: 'accepted',
      deploymentId: 'deployment-1',
      issuedAt: 100,
      expiresAt: 200,
      sourceRevision: 'b'.repeat(40),
      checkpointRevision: 'c'.repeat(40),
      evaluationReportSha256: 'd'.repeat(64),
      schemaVersion: 1,
      policyVersion: '1',
      heldoutKind: 'independent-human-labeled',
      samplesPerSurface: samples,
      confidenceThresholds: thresholds,
      thresholdsPassed: true,
      policyViolationCount: 0,
      calibrationReviewed: true,
      fallbackTested: true,
      providerAuthenticated: true,
      twoClientReadback: true,
      privacyReviewed: true
    }
    expect(LayaDeploymentGate.safeParse(gate).success).toBe(true)
    const { verification: _verification, ...missingSurface } = samples
    expect(
      LayaDeploymentGate.safeParse({
        ...gate,
        samplesPerSurface: missingSurface
      }).success
    ).toBe(false)
    expect(LayaDeploymentGate.safeParse({ ...gate, providerAuthenticated: false }).success).toBe(
      false
    )
    expect(
      LayaDeploymentGate.safeParse({ ...gate, confidenceThresholds: { ...thresholds, data: 1.5 } })
        .success
    ).toBe(false)
  })

  it('rejects provider fields outside the versioned contract', () => {
    const response = {
      schemaVersion: 1,
      surface: 'verification',
      requestDigest: 'a'.repeat(64),
      snapshotRevision: 'e'.repeat(64),
      sourceRevision: 'b'.repeat(40),
      checkpointRevision: 'c'.repeat(40),
      evaluationReportSha256: 'd'.repeat(64),
      policyVersion: '1',
      decision: 'deep-review',
      confidence: 0.9,
      probabilities: { 'deep-review': 0.9, 'needs-human': 0.2 },
      elapsedMs: 5,
      providerMeasuredAt: 100
    }
    expect(LayaProviderDecision.safeParse(response).success).toBe(true)
    expect(
      LayaProviderDecision.safeParse({ ...response, snapshotRevision: 'job-1:v1' }).success
    ).toBe(false)
    expect(LayaProviderDecision.safeParse({ ...response, action: 'delete' }).success).toBe(false)
  })
})
