export type OrbEntry = { kind: 'orb' }

/**
 * Matches the hash the main-process orb window loads (`#/orb`, see
 * floating-orb-window.ts). The orb carries no params, so the entry is a tag.
 */
export function parseOrbHash(hash: string): OrbEntry | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  return raw.replace(/\/+$/, '') === '/orb' ? { kind: 'orb' } : null
}
