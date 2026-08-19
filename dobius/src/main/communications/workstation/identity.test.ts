import { afterEach, describe, expect, it, vi } from 'vitest'

// Why: getGitIdentity reads *global* `git config`, which is real machine
// state (~/.gitconfig) — a test must never write to it. Stub the low-level
// runner instead of touching the developer's actual git identity.
const runGitMock = vi.fn()
vi.mock('./git-exec', () => ({ runGit: (...args: unknown[]) => runGitMock(...args) }))

const { getGitIdentity, discoverGitBashPrerequisite } = await import('./identity')

describe('getGitIdentity', () => {
  afterEach(() => {
    runGitMock.mockReset()
  })

  it('reads a configured global git identity', async () => {
    runGitMock.mockImplementation((args: string[]) => {
      const key = args.at(-1)
      if (key === 'user.name') {return Promise.resolve({ stdout: 'Workstation Test\n', stderr: '' })}
      if (key === 'user.email') {return Promise.resolve({ stdout: 'workstation-test@example.com\n', stderr: '' })}
      return Promise.reject(new Error('unexpected key'))
    })

    const identity = await getGitIdentity()
    expect(identity).toEqual({ name: 'Workstation Test', email: 'workstation-test@example.com' })
  })

  it('returns null (not a thrown error) when a key is unset — git config --get exits 1', async () => {
    runGitMock.mockRejectedValue(Object.assign(new Error('Command failed'), { code: 1 }))
    const identity = await getGitIdentity()
    expect(identity).toEqual({ name: null, email: null })
  })
})

describe('discoverGitBashPrerequisite', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('is not applicable outside Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    expect(await discoverGitBashPrerequisite()).toBeNull()
  })
})
