import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest, RpcResponse } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'

vi.mock('../../../storage/user-data-root', () => ({
  getUserDataRoot: () => '/nonexistent-dobius-user-data'
}))

import { AGENT_FILE_METHODS, withoutSecretFiles } from './files-agent'

let root: string
let runtime: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  root = join(realpathSync(mkdtempSync(join(tmpdir(), 'files-agent-'))), 'wt')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'app.ts'), 'ok')
  writeFileSync(join(root, '.env'), 'SECRET=1')
  runtime = {
    getRuntimeId: vi.fn().mockReturnValue('rt'),
    resolveMobileWriteRoot: vi.fn().mockResolvedValue({ root }),
    readMobileFile: vi.fn().mockResolvedValue({ content: 'ok' }),
    writeFileExplorerFile: vi.fn().mockResolvedValue({ ok: true }),
    searchRuntimeFiles: vi.fn()
  }
})

afterEach(() => {
  rmSync(join(root, '..'), { recursive: true, force: true })
})

async function call(method: string, params: Record<string, unknown>): Promise<RpcResponse> {
  const dispatcher = new RpcDispatcher({
    runtime: runtime as unknown as DobiusRuntimeService,
    methods: AGENT_FILE_METHODS
  })
  const request: RpcRequest = { id: 'r', authToken: 't', method, params }
  return dispatcher.dispatch(request)
}

describe('files.agentRead', () => {
  it('reads a worktree file through the runtime', async () => {
    const response = await call('files.agentRead', { worktree: 'id:wt', relativePath: 'src/app.ts' })
    expect(response.ok).toBe(true)
    expect(runtime.readMobileFile).toHaveBeenCalledWith('id:wt', 'src/app.ts')
  })

  it('refuses .env and .. without reading', async () => {
    for (const relativePath of ['.env', '../wt/src/app.ts']) {
      const response = await call('files.agentRead', { worktree: 'id:wt', relativePath })
      expect(response).toMatchObject({ ok: false })
    }
    expect(runtime.readMobileFile).not.toHaveBeenCalled()
  })
})

describe('files.agentWrite', () => {
  it('writes inside the worktree and reports the byte count', async () => {
    const response = await call('files.agentWrite', {
      worktree: 'id:wt',
      relativePath: 'src/new.ts',
      content: 'héllo'
    })
    expect(response).toMatchObject({ ok: true, result: { relativePath: 'src/new.ts', bytes: 6 } })
    expect(runtime.writeFileExplorerFile).toHaveBeenCalledWith('id:wt', 'src/new.ts', 'héllo')
  })

  it('refuses secrets, dot-files, escapes and a missing content without writing', async () => {
    for (const params of [
      { relativePath: 'dobius-runtime.json', content: '{}' },
      { relativePath: '.github/workflows/x.yml', content: 'x' },
      { relativePath: '../escape.txt', content: 'x' },
      { relativePath: 'src/app.ts' }
    ]) {
      const response = await call('files.agentWrite', { worktree: 'id:wt', ...params })
      expect(response).toMatchObject({ ok: false })
    }
    expect(runtime.writeFileExplorerFile).not.toHaveBeenCalled()
  })
})

describe('files.agentSearch', () => {
  it('drops hits in secret-looking files and recounts matches', async () => {
    const match = { line: 1, column: 1, matchLength: 3, lineContent: 'KEY' }
    runtime.searchRuntimeFiles.mockResolvedValue({
      files: [
        { filePath: `${root}/.env`, relativePath: '.env', matches: [match, match] },
        { filePath: `${root}/src/app.ts`, relativePath: 'src/app.ts', matches: [match] }
      ],
      totalMatches: 3,
      truncated: false
    })
    const response = await call('files.agentSearch', { worktree: 'id:wt', query: 'KEY' })
    expect(response).toMatchObject({
      ok: true,
      result: { totalMatches: 1, hiddenFiles: 1, files: [{ relativePath: 'src/app.ts' }] }
    })
    expect(runtime.searchRuntimeFiles).toHaveBeenCalledWith('id:wt', expect.objectContaining({ query: 'KEY', maxResults: 200 }))
  })

  it('caps maxResults', async () => {
    const response = await call('files.agentSearch', { worktree: 'id:wt', query: 'x', maxResults: 5000 })
    expect(response.ok).toBe(false)
    expect(runtime.searchRuntimeFiles).not.toHaveBeenCalled()
  })

  it('withoutSecretFiles uses matchCount when present', () => {
    expect(
      withoutSecretFiles({
        files: [{ filePath: 'a', relativePath: 'a.ts', matches: [], matchCount: 7 }],
        totalMatches: 7,
        truncated: true
      })
    ).toEqual({
      files: [{ filePath: 'a', relativePath: 'a.ts', matches: [], matchCount: 7 }],
      totalMatches: 7,
      truncated: true,
      hiddenFiles: 0
    })
  })
})
