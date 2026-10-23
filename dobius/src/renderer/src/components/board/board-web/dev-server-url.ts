// Picks the URL to open when a console prints a dev-server address, using
// Dobius's workspace port scan (which already captures the advertised origin).
import type { BoardState } from '@/store/slices/board'
import type { WorkspacePort } from '../../../../../shared/workspace-ports'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'])

/** Open-able URL for the scanned listener on `port` owned by `worktreeId`, if any. */
export function devServerUrlForPort(
  ports: readonly WorkspacePort[],
  worktreeId: string,
  port: number
): string | null {
  const match = ports.find(
    (p) => p.port === port && p.kind === 'workspace' && p.owner.worktreeId === worktreeId
  )
  if (!match || match.kind !== 'workspace') {
    return null
  }
  if (match.advertisedUrl) {
    return match.advertisedUrl
  }
  const protocol = match.protocol === 'https' ? 'https' : 'http'
  return `${protocol}://${match.connectHost}:${match.port}/`
}

/** Listeners this worktree owns, for the tile's "rescan dev ports" menu. */
export function worktreeDevServers(
  ports: readonly WorkspacePort[],
  worktreeId: string
): { port: number; url: string; label: string }[] {
  return ports
    .filter((p) => p.kind === 'workspace' && p.owner.worktreeId === worktreeId)
    .map((p) => ({
      port: p.port,
      url: devServerUrlForPort(ports, worktreeId, p.port)!,
      label: p.processName ? `${p.processName} · ${p.port}` : String(p.port)
    }))
    .sort((a, b) => a.port - b.port)
}

function originKey(url: string): string | null {
  try {
    const u = new URL(url)
    const host = LOOPBACK.has(u.hostname) ? 'localhost' : u.hostname
    return `${u.protocol}//${host}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`
  } catch {
    return null
  }
}

/** True when a web tile on the board already shows this origin (loopback names are one host). */
export function boardShowsOrigin(board: Pick<BoardState, 'cards'>, url: string): boolean {
  const key = originKey(url)
  return key !== null && board.cards.some((c) => c.kind === 'web' && originKey(c.url) === key)
}

export function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK.has(new URL(url).hostname)
  } catch {
    return false
  }
}
