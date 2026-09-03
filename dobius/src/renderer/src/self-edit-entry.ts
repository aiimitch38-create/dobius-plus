export type SelfEditEntry = { kind: 'self-edit' }

/**
 * Matches the hash the main-process review window loads (`#/self-edit`, see
 * src/main/window/self-edit-window.ts).
 */
export function parseSelfEditHash(hash: string): SelfEditEntry | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  return raw.replace(/\/+$/, '') === '/self-edit' ? { kind: 'self-edit' } : null
}
