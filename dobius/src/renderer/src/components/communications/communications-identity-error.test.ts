import { describe, expect, it } from 'vitest'
import { identityErrorView, sanitizeIdentityErrorDetail } from './communications-identity-error'

const QA_ERROR =
  "Error invoking remote method 'communications:getIdentity': ParticipantIdentityUnavailableError: Communications participant identity is unavailable (decrypt failed: Error while decrypting the ciphertext provided to safeStorage.decryptString.); the file at /Users/x/.dobius/communications-identity.enc was kept unchanged."

describe('identityErrorView', () => {
  it('recognises a Keychain unlock failure and drops the IPC prefix', () => {
    const view = identityErrorView(QA_ERROR)
    expect(view.unlockFailed).toBe(true)
    expect(view.details.startsWith('ParticipantIdentityUnavailableError')).toBe(true)
    expect(view.details).not.toContain('Error invoking remote method')
  })

  it('treats other failures as generic', () => {
    expect(identityErrorView('network down').unlockFailed).toBe(false)
  })
})

describe('sanitizeIdentityErrorDetail', () => {
  it('never shows key material', () => {
    const secretHex = 'a'.repeat(64)
    const out = sanitizeIdentityErrorDetail(
      `bad key nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqq and ${secretHex}`
    )
    expect(out).not.toContain('nsec1')
    expect(out).not.toContain(secretHex)
    expect(out).toContain('[redacted]')
  })
})
