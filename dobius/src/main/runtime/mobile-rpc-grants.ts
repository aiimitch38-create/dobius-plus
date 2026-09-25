// Why: a phone token is a bearer credential shown as a QR code. Methods that
// amount to "run anything on this Mac" (typing into a shell, pushing code,
// deleting worktrees, rewriting settings) stay off for mobile devices until
// the owner explicitly grants them on that device. Everything else on the
// mobile allowlist keeps working without a grant.
export const MOBILE_RPC_GRANTS = [
  'terminal.send',
  'git.push',
  'worktree.rm',
  'settings.update'
] as const

export type MobileRpcGrant = (typeof MOBILE_RPC_GRANTS)[number]

const GRANT_SET: ReadonlySet<string> = new Set(MOBILE_RPC_GRANTS)

// Why: these methods start a shell with caller-chosen startup input, which is
// the same power as terminal.send. The mobile app never sends these fields.
const TERMINAL_CREATE_METHODS = new Set(['terminal.create', 'session.tabs.createTerminal'])
const TERMINAL_STARTUP_INPUT_FIELDS = ['command', 'env', 'launchConfig'] as const

export function isMobileRpcGrant(value: unknown): value is MobileRpcGrant {
  return typeof value === 'string' && GRANT_SET.has(value)
}

export function requiredMobileRpcGrant(method: string, params: unknown): MobileRpcGrant | null {
  if (isMobileRpcGrant(method)) {
    return method
  }
  if (TERMINAL_CREATE_METHODS.has(method) && params !== null && typeof params === 'object') {
    const record = params as Record<string, unknown>
    if (TERMINAL_STARTUP_INPUT_FIELDS.some((field) => record[field] !== undefined)) {
      return 'terminal.send'
    }
  }
  return null
}

export function deviceHasMobileRpcGrant(
  device: { grants?: readonly MobileRpcGrant[] },
  grant: MobileRpcGrant
): boolean {
  return device.grants?.includes(grant) === true
}
