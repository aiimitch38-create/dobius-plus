import type { RuntimeClientTarget } from '../../runtime/runtime-rpc-client'
export const CLOUD_JOB_AUTHORITY_KEY = 'dobius:cloudJobAuthority:v1'
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
export function loadCloudJobAuthority(storage: Storage): string | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(CLOUD_JOB_AUTHORITY_KEY) ?? 'null')
    return typeof value === 'string' && value.trim() ? value : null
  } catch {
    return null
  }
}
export function saveCloudJobAuthority(storage: Storage, id: string | null): void {
  storage.setItem(CLOUD_JOB_AUTHORITY_KEY, JSON.stringify(id))
}
export function resolveCloudJobAuthority(
  id: string | null,
  registered: readonly { id: string }[]
): Extract<RuntimeClientTarget, { kind: 'environment' }> | null {
  // Never derive this from active terminal/runtime state or fall back to local.
  return id && registered.some((environment) => environment.id === id)
    ? { kind: 'environment', environmentId: id }
    : null
}
