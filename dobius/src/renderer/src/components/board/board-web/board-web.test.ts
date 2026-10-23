import { describe, expect, it } from 'vitest'
import type { BoardCard } from '@/store/slices/board'
import type { WorkspacePort } from '../../../../../shared/workspace-ports'
import {
  boardShowsOrigin,
  devServerUrlForPort,
  isLoopbackUrl,
  worktreeDevServers
} from './dev-server-url'
import { deviceFitScale, findWebTileDevice, mobileUserAgent } from './web-tile-devices'

const owner = (worktreeId: string) => ({
  worktreeId,
  repoId: 'r',
  displayName: 'x',
  path: '/x',
  confidence: 'cwd' as const
})
const port = (p: number, worktreeId: string, extra: Partial<WorkspacePort> = {}): WorkspacePort =>
  ({
    id: `p${p}`,
    bindHost: '0.0.0.0',
    connectHost: 'localhost',
    port: p,
    protocol: 'http',
    kind: 'workspace',
    owner: owner(worktreeId),
    ...extra
  }) as WorkspacePort

describe('devServerUrlForPort', () => {
  it('prefers the advertised origin, else builds one, and ignores other worktrees', () => {
    const ports = [
      port(5173, 'wt', { advertisedUrl: 'https://app.test:5173/' } as Partial<WorkspacePort>),
      port(3000, 'wt'),
      port(8080, 'other')
    ]
    expect(devServerUrlForPort(ports, 'wt', 5173)).toBe('https://app.test:5173/')
    expect(devServerUrlForPort(ports, 'wt', 3000)).toBe('http://localhost:3000/')
    expect(devServerUrlForPort(ports, 'wt', 8080)).toBeNull()
    expect(worktreeDevServers(ports, 'wt').map((s) => s.port)).toEqual([3000, 5173])
  })
})

describe('boardShowsOrigin', () => {
  const tile = (url: string): BoardCard => ({
    id: url,
    kind: 'web',
    url,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    z: 1,
    title: ''
  })
  it('treats loopback names as the same host and ignores paths', () => {
    const board = { cards: [tile('http://127.0.0.1:3000/dashboard')] }
    expect(boardShowsOrigin(board, 'http://localhost:3000/')).toBe(true)
    expect(boardShowsOrigin(board, 'http://localhost:3001/')).toBe(false)
    expect(boardShowsOrigin({ cards: [tile('')] }, 'http://localhost:3000/')).toBe(false)
    expect(isLoopbackUrl('http://0.0.0.0:8000')).toBe(true)
    expect(isLoopbackUrl('https://example.com')).toBe(false)
  })
})

describe('web tile devices', () => {
  it('fits a device into the tile without upscaling', () => {
    const phone = findWebTileDevice('iphone-se')!
    expect(deviceFitScale(phone, { width: 2000, height: 2000 })).toBe(1)
    expect(deviceFitScale(phone, { width: 375, height: 333.5 })).toBe(0.5)
    expect(findWebTileDevice('nope')).toBeNull()
  })
})

describe('mobileUserAgent', () => {
  it('adds a phone platform and the Mobile token once', () => {
    const desktop =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36'
    const phone = mobileUserAgent(desktop)
    expect(phone).toContain('(Linux; Android 14; Pixel 7)')
    expect(phone).toContain('Mobile Safari/537.36')
    expect(mobileUserAgent(phone)).toBe(phone)
  })
})
