// Turns a raw identity-load failure into what the Communications error view
// shows: a plain sentence for everyone, plus details for whoever needs them.

export type IdentityErrorView = {
  /** True when the stored identity exists but cannot be unlocked here (Keychain / safeStorage). */
  unlockFailed: boolean
  /** Sanitized technical detail for the disclosure; never key material. */
  details: string
}

const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*/
// Why: details may be copied into bug reports, so anything shaped like a
// secret is masked even though the main process should never send one.
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bnsec1[0-9a-z]{20,}\b/gi,
  /\b[0-9a-f]{64,}\b/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
]

export function sanitizeIdentityErrorDetail(raw: string): string {
  let text = raw.replace(IPC_PREFIX, '').trim()
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '[redacted]')
  }
  return text
}

export function identityErrorView(raw: string): IdentityErrorView {
  return {
    unlockFailed: /ParticipantIdentityUnavailable|decrypt failed|safeStorage|Keychain/i.test(raw),
    details: sanitizeIdentityErrorDetail(raw)
  }
}
