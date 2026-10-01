import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ADMITTED_CONTEXT_FILE,
  deliverAdmittedContext,
  withContextBanner
} from './agent-run-context-delivery'

const pack = { projectId: 'dobius-plus', digest: 'sha256:0123456789abcdefdeadbeef' }

describe('deliverAdmittedContext (B5 context delivery)', () => {
  let base = ''

  beforeEach(() => {
    base = mkdtempSync(path.join(os.tmpdir(), 'context-delivery-'))
  })

  afterEach(() => {
    chmodSync(base, 0o700)
    rmSync(base, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('builds the env vars, banner and current.json for an admitted run', () => {
    const cwd = path.join(base, 'repo')
    mkdirSync(path.join(cwd, '.git'), { recursive: true })
    const delivery = deliverAdmittedContext({
      cwd,
      pack,
      context: { correlationId: 'run-1', worktreeId: 'wt-7' },
      origin: 'agent-run',
      now: 1_700_000_000_000
    })
    expect(delivery.env).toEqual({
      DOBIUS_PROJECT_ID: 'dobius-plus',
      DOBIUS_CONTEXT_DIGEST: 'sha256:0123456789abcdefdeadbeef',
      DOBIUS_WORKTREE_ID: 'wt-7'
    })
    expect(delivery.banner).toBe('Dobius context: project=dobius-plus digest=sha256:01234567')
    expect(delivery.filePath).toBe(path.join(cwd, ADMITTED_CONTEXT_FILE))
    expect(JSON.parse(readFileSync(delivery.filePath as string, 'utf-8'))).toEqual({
      projectId: 'dobius-plus',
      contextDigest: 'sha256:0123456789abcdefdeadbeef',
      worktree: 'wt-7',
      origin: 'agent-run',
      admittedAt: '2023-11-14T22:13:20.000Z'
    })
    // Nothing left beside the renamed file (the atomic helper's temp is `current.json.<pid>.<hex>.tmp`).
    expect(readdirSync(path.join(cwd, '.dobius', 'context'))).toEqual(['current.json'])
  })

  it('still writes current.json when .gitignore cannot be updated', () => {
    const cwd = path.join(base, 'ignore-locked')
    mkdirSync(path.join(cwd, '.git'), { recursive: true })
    writeFileSync(path.join(cwd, '.gitignore'), 'node_modules\n')
    chmodSync(path.join(cwd, '.gitignore'), 0o400)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const delivery = deliverAdmittedContext({
      cwd,
      pack,
      context: { correlationId: 'r' },
      origin: 'agent-run'
    })
    expect(delivery.filePath).toBe(path.join(cwd, ADMITTED_CONTEXT_FILE))
    expect(existsSync(delivery.filePath as string)).toBe(true)
    expect(readFileSync(path.join(cwd, '.gitignore'), 'utf-8')).toBe('node_modules\n')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[agents] could not add .dobius/ to'),
      expect.anything()
    )
  })

  it('omits the digest and worktree surfaces when ADAM gave no digest and there is no worktree', () => {
    const cwd = path.join(base, 'plain')
    mkdirSync(cwd)
    const delivery = deliverAdmittedContext({
      cwd,
      pack: { projectId: 'pcif' },
      context: { correlationId: 'run-2' },
      origin: 'dispatch-build'
    })
    expect(delivery.env).toEqual({ DOBIUS_PROJECT_ID: 'pcif' })
    expect(delivery.banner).toBe('Dobius context: project=pcif')
    expect(JSON.parse(readFileSync(delivery.filePath as string, 'utf-8'))).toMatchObject({
      projectId: 'pcif',
      contextDigest: null,
      worktree: null,
      origin: 'dispatch-build'
    })
  })

  it('adds .dobius/ to .gitignore at a checkout root only when it is missing', () => {
    const cwd = path.join(base, 'repo')
    mkdirSync(path.join(cwd, '.git'), { recursive: true })
    writeFileSync(path.join(cwd, '.gitignore'), 'node_modules')
    deliverAdmittedContext({ cwd, pack, context: { correlationId: 'r' }, origin: 'agent-run' })
    expect(readFileSync(path.join(cwd, '.gitignore'), 'utf-8')).toBe('node_modules\n.dobius/\n')

    // Already covered (either spelling): the file is left byte-for-byte alone.
    writeFileSync(path.join(cwd, '.gitignore'), '.dobius\n')
    deliverAdmittedContext({ cwd, pack, context: { correlationId: 'r' }, origin: 'agent-run' })
    expect(readFileSync(path.join(cwd, '.gitignore'), 'utf-8')).toBe('.dobius\n')
  })

  it('never creates a .gitignore outside a checkout root', () => {
    const cwd = path.join(base, 'not-a-repo')
    mkdirSync(cwd)
    deliverAdmittedContext({ cwd, pack, context: { correlationId: 'r' }, origin: 'agent-run' })
    expect(existsSync(path.join(cwd, '.gitignore'))).toBe(false)
    expect(existsSync(path.join(cwd, ADMITTED_CONTEXT_FILE))).toBe(true)
  })

  it('logs and continues when the cwd is read-only; env and banner still reach the run', () => {
    const cwd = path.join(base, 'locked')
    mkdirSync(path.join(cwd, '.git'), { recursive: true })
    chmodSync(cwd, 0o500)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const delivery = deliverAdmittedContext({
      cwd,
      pack,
      context: { correlationId: 'r' },
      origin: 'agent-run'
    })
    chmodSync(cwd, 0o700)
    expect(delivery.filePath).toBeUndefined()
    expect(delivery.env.DOBIUS_PROJECT_ID).toBe('dobius-plus')
    expect(delivery.banner).toContain('project=dobius-plus')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[agents] could not write admitted context'),
      expect.anything()
    )
  })
})

describe('withContextBanner', () => {
  it('appends the banner to an existing system prompt', () => {
    expect(withContextBanner('## Role\n\nAtlas', 'Dobius context: project=p')).toBe(
      '## Role\n\nAtlas\n\nDobius context: project=p'
    )
  })

  it('keeps the default Claude Code prompt when the agent has none of its own', () => {
    expect(withContextBanner('', 'Dobius context: project=p')).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: 'Dobius context: project=p'
    })
  })

  it('leaves the prompt untouched without a banner', () => {
    expect(withContextBanner('## Role', undefined)).toBe('## Role')
    expect(withContextBanner('', undefined)).toBeUndefined()
  })
})
