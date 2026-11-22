import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GIT_HANDLERS } from './git'
import { buildLineDiff } from '../git-line-diff'
import { normalizeCommandPositionals, parseArgs, validateCommandAndFlags } from '../args'
import { printHelp } from '../help'
import { COMMAND_SPECS } from '../specs'

const callMock = vi.fn()
let logSpy: ReturnType<typeof vi.spyOn>

function ok(result: unknown): {
  id: string
  ok: true
  result: unknown
  _meta: { runtimeId: string }
} {
  return { id: 'req', ok: true, result, _meta: { runtimeId: 'rt-1' } }
}

function ctx(flags: Record<string, string | boolean>, json = false, isRemote = false): never {
  return {
    flags: new Map(Object.entries(flags)),
    client: { call: callMock, isRemote },
    cwd: '/tmp',
    json
  } as never
}

function printed(): string {
  return logSpy.mock.calls.map((call) => String(call[0])).join('\n')
}

beforeEach(() => {
  callMock.mockReset()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
})

const status = {
  entries: [
    { path: 'a.ts', status: 'modified', area: 'staged', added: 2, removed: 1 },
    { path: 'b.ts', status: 'modified', area: 'unstaged' },
    { path: 'new.md', status: 'untracked', area: 'untracked' },
    { path: 'clash.ts', status: 'modified', area: 'unstaged', conflictStatus: 'unresolved' },
    { path: 'sub/x', status: 'modified', area: 'unstaged', submoduleRoot: 'sub' }
  ],
  conflictOperation: 'unknown',
  branch: 'refs/heads/feature',
  upstreamStatus: { hasUpstream: true, upstreamName: 'origin/feature', ahead: 1, behind: 0 }
}

describe('dobius git status', () => {
  it('calls git.status for the selected worktree and prints plain English', async () => {
    callMock.mockResolvedValueOnce(ok(status))
    await GIT_HANDLERS['git status'](ctx({ worktree: 'id:wt1' }))
    expect(callMock).toHaveBeenCalledWith('git.status', { worktree: 'id:wt1' })
    const out = printed()
    expect(out).toContain('On branch feature (tracking origin/feature: 1 ahead, 0 behind)')
    expect(out).toContain('Staged (will be in the next commit) (1):')
    expect(out).toContain('Conflicts to resolve (1):')
  })

  it('prints the raw RPC response with --json', async () => {
    callMock.mockResolvedValueOnce(ok(status))
    await GIT_HANDLERS['git status'](ctx({ worktree: 'id:wt1' }, true))
    expect(JSON.parse(printed())).toEqual(ok(status))
  })

  it('requires --worktree when talking to a remote runtime', async () => {
    await expect(GIT_HANDLERS['git status'](ctx({}, false, true))).rejects.toThrow(
      /require --worktree/
    )
    expect(callMock).not.toHaveBeenCalled()
  })

  it('passes runtime errors through unchanged', async () => {
    callMock.mockRejectedValueOnce(new Error('selector_not_found'))
    await expect(GIT_HANDLERS['git status'](ctx({ worktree: 'id:nope' }))).rejects.toThrow(
      'selector_not_found'
    )
  })
})

describe('dobius git diff', () => {
  it('calls git.diff with the path and staged flag', async () => {
    callMock.mockResolvedValueOnce(
      ok({
        kind: 'text',
        originalContent: 'one\ntwo\nthree\n',
        modifiedContent: 'one\n2\nthree\n',
        originalIsBinary: false,
        modifiedIsBinary: false
      })
    )
    await GIT_HANDLERS['git diff'](ctx({ worktree: 'id:wt1', path: 'a.ts', staged: true }))
    expect(callMock).toHaveBeenCalledWith('git.diff', {
      worktree: 'id:wt1',
      filePath: 'a.ts',
      staged: true
    })
    const out = printed()
    expect(out).toContain('Diff of a.ts (staged):')
    expect(out).toContain('-two')
    expect(out).toContain('+2')
  })

  it('needs a path', async () => {
    await expect(GIT_HANDLERS['git diff'](ctx({ worktree: 'id:wt1' }))).rejects.toThrow(
      /Say which file to diff/
    )
  })
})

describe('buildLineDiff', () => {
  it('keeps shared lines and marks removed and added ones', () => {
    expect(buildLineDiff('a\nb\nc\n', 'a\nx\nc\nd\n').map((op) => `${op.kind}${op.text}`)).toEqual([
      ' a',
      '-b',
      '+x',
      ' c',
      '+d'
    ])
  })
})

describe('dobius git log and branches', () => {
  it('defaults log to 20 commits and forwards --base', async () => {
    callMock.mockResolvedValueOnce(
      ok({
        items: [],
        hasIncomingChanges: false,
        hasOutgoingChanges: false,
        hasMore: false,
        limit: 20
      })
    )
    await GIT_HANDLERS['git log'](ctx({ worktree: 'id:wt1', base: 'origin/main' }))
    expect(callMock).toHaveBeenCalledWith('git.history', {
      worktree: 'id:wt1',
      limit: 20,
      baseRef: 'origin/main'
    })
    expect(printed()).toBe('No commits found.')
  })

  it('refuses a --limit over 200 before calling the runtime', async () => {
    await expect(
      GIT_HANDLERS['git log'](ctx({ worktree: 'id:wt1', limit: '500' }))
    ).rejects.toThrow(/at most 200/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('lists branches and stars the current one', async () => {
    callMock.mockResolvedValueOnce(ok({ current: 'main', branches: ['dev', 'main'] }))
    await GIT_HANDLERS['git branches'](ctx({ worktree: 'id:wt1' }))
    expect(callMock).toHaveBeenCalledWith('git.localBranches', { worktree: 'id:wt1' })
    expect(printed()).toBe('  dev\n* main')
  })
})

describe('dobius git stage / unstage', () => {
  it('stages one path with git.stage', async () => {
    callMock.mockResolvedValueOnce(ok({ ok: true }))
    await GIT_HANDLERS['git stage'](ctx({ worktree: 'id:wt1', path: 'b.ts' }))
    expect(callMock).toHaveBeenCalledWith('git.stage', { worktree: 'id:wt1', filePath: 'b.ts' })
  })

  it('--all bulk-stages changed files and skips conflicts and submodule files', async () => {
    callMock.mockResolvedValueOnce(ok(status)).mockResolvedValueOnce(ok({ ok: true }))
    await GIT_HANDLERS['git stage'](ctx({ worktree: 'id:wt1', all: true }, true))
    expect(callMock.mock.calls[1]).toEqual([
      'git.bulkStage',
      { worktree: 'id:wt1', filePaths: ['b.ts', 'new.md'] }
    ])
    const json = JSON.parse(printed())
    expect(json.result.skipped.map((entry: { path: string }) => entry.path)).toEqual([
      'clash.ts',
      'sub/x'
    ])
  })

  it('refuses both a path and --all, and neither', async () => {
    await expect(
      GIT_HANDLERS['git stage'](ctx({ worktree: 'id:wt1', path: 'a', all: true }))
    ).rejects.toThrow(/not both/)
    await expect(GIT_HANDLERS['git stage'](ctx({ worktree: 'id:wt1' }))).rejects.toThrow(
      /Say which file to stage/
    )
    expect(callMock).not.toHaveBeenCalled()
  })

  it('--all refuses when status was cut off at its limit', async () => {
    callMock.mockResolvedValueOnce(ok({ ...status, didHitLimit: true }))
    await expect(GIT_HANDLERS['git stage'](ctx({ worktree: 'id:wt1', all: true }))).rejects.toThrow(
      /too many changes/
    )
    expect(callMock).toHaveBeenCalledTimes(1)
  })

  it('unstage --all bulk-unstages only staged files', async () => {
    callMock.mockResolvedValueOnce(ok(status)).mockResolvedValueOnce(ok({ ok: true }))
    await GIT_HANDLERS['git unstage'](ctx({ worktree: 'id:wt1', all: true }))
    expect(callMock.mock.calls[1]).toEqual([
      'git.bulkUnstage',
      { worktree: 'id:wt1', filePaths: ['a.ts'] }
    ])
  })

  it('unstages one path with git.unstage', async () => {
    callMock.mockResolvedValueOnce(ok({ ok: true }))
    await GIT_HANDLERS['git unstage'](ctx({ worktree: 'id:wt1', path: 'a.ts' }))
    expect(callMock).toHaveBeenCalledWith('git.unstage', { worktree: 'id:wt1', filePath: 'a.ts' })
  })
})

describe('dobius git commit', () => {
  it('refuses an empty or blank message without calling the runtime', async () => {
    await expect(GIT_HANDLERS['git commit'](ctx({ worktree: 'id:wt1' }))).rejects.toThrow(
      /needs a message/
    )
    await expect(
      GIT_HANDLERS['git commit'](ctx({ worktree: 'id:wt1', message: '   ' }))
    ).rejects.toThrow(/needs a message/)
    // `--message` with no value parses as boolean true
    await expect(
      GIT_HANDLERS['git commit'](ctx({ worktree: 'id:wt1', message: true }))
    ).rejects.toThrow(/needs a message/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('commits with the given message', async () => {
    callMock.mockResolvedValueOnce(ok({ success: true }))
    await GIT_HANDLERS['git commit'](ctx({ worktree: 'id:wt1', message: 'Fix login' }, true))
    expect(callMock).toHaveBeenCalledWith('git.commit', {
      worktree: 'id:wt1',
      message: 'Fix login'
    })
    expect(JSON.parse(printed()).result).toEqual({
      success: true,
      message: 'Fix login',
      generated: false
    })
  })

  it('maps a failed commit to an error', async () => {
    callMock.mockResolvedValueOnce(ok({ success: false, error: 'nothing to commit' }))
    await expect(
      GIT_HANDLERS['git commit'](ctx({ worktree: 'id:wt1', message: 'x' }))
    ).rejects.toMatchObject({
      code: 'git_commit_failed',
      message: 'Commit failed: nothing to commit'
    })
  })

  it('--generate writes a message, then commits it', async () => {
    callMock
      .mockResolvedValueOnce(ok({ success: true, message: 'Add login retry' }))
      .mockResolvedValueOnce(ok({ success: true }))
    await GIT_HANDLERS['git commit'](ctx({ worktree: 'id:wt1', generate: true }))
    expect(callMock.mock.calls[0]).toEqual([
      'git.generateCommitMessage',
      { worktree: 'id:wt1' },
      { timeoutMs: 180_000 }
    ])
    expect(callMock.mock.calls[1]).toEqual([
      'git.commit',
      { worktree: 'id:wt1', message: 'Add login retry' }
    ])
    expect(printed()).toBe('Committed with a generated message: Add login retry')
  })

  it('--generate --dry-run only shows the message', async () => {
    callMock.mockResolvedValueOnce(ok({ success: true, message: 'Add login retry' }))
    await GIT_HANDLERS['git commit'](ctx({ worktree: 'id:wt1', generate: true, 'dry-run': true }))
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(printed()).toContain('nothing was committed')
  })

  it('does not commit when generation fails', async () => {
    callMock.mockResolvedValueOnce(ok({ success: false, error: 'No staged changes' }))
    await expect(
      GIT_HANDLERS['git commit'](ctx({ worktree: 'id:wt1', generate: true }))
    ).rejects.toMatchObject({ code: 'commit_message_failed' })
    expect(callMock).toHaveBeenCalledTimes(1)
  })

  it('refuses --message together with --generate, and --dry-run alone', async () => {
    await expect(
      GIT_HANDLERS['git commit'](ctx({ worktree: 'id:wt1', generate: true, message: 'x' }))
    ).rejects.toThrow(/not both/)
    await expect(
      GIT_HANDLERS['git commit'](ctx({ worktree: 'id:wt1', message: 'x', 'dry-run': true }))
    ).rejects.toThrow(/only works together with --generate/)
    expect(callMock).not.toHaveBeenCalled()
  })
})

describe('dobius git fetch / pull', () => {
  it('calls git.fetch and git.pull with only the worktree (no push target, no force)', async () => {
    callMock
      .mockResolvedValueOnce(ok({ ok: true }))
      .mockResolvedValueOnce(ok({ entries: [], conflictOperation: 'unknown' }))
      .mockResolvedValueOnce(ok({ ok: true }))
    await GIT_HANDLERS['git fetch'](ctx({ worktree: 'id:wt1' }))
    await GIT_HANDLERS['git pull'](ctx({ worktree: 'id:wt1' }))
    expect(callMock.mock.calls).toEqual([
      ['git.fetch', { worktree: 'id:wt1' }, { timeoutMs: 120_000 }],
      ['git.status', { worktree: 'id:wt1' }],
      ['git.pull', { worktree: 'id:wt1' }, { timeoutMs: 120_000 }]
    ])
  })

  it('pull refuses uncommitted changes unless --allow-dirty', async () => {
    callMock.mockResolvedValueOnce(ok(status))
    await expect(GIT_HANDLERS['git pull'](ctx({ worktree: 'id:wt1' }))).rejects.toMatchObject({
      code: 'git_pull_blocked',
      message: expect.stringMatching(/--allow-dirty/)
    })
    expect(callMock).toHaveBeenCalledTimes(1)
    callMock.mockReset()
    callMock.mockResolvedValueOnce(ok({ ok: true }))
    await GIT_HANDLERS['git pull'](ctx({ worktree: 'id:wt1', 'allow-dirty': true }))
    expect(callMock.mock.calls).toEqual([
      ['git.pull', { worktree: 'id:wt1' }, { timeoutMs: 120_000 }]
    ])
  })

  it('says a diff is too large instead of claiming no changes', async () => {
    callMock.mockResolvedValueOnce(
      ok({
        kind: 'text',
        originalContent: '',
        modifiedContent: '',
        originalIsBinary: false,
        modifiedIsBinary: false,
        largeDiffRenderLimit: {
          limited: true,
          reason: 'line-count',
          lineCounts: { original: 60000, modified: 60010 },
          characterCount: 1,
          limits: { maxLinesPerSide: 50000, maxCombinedCharacters: 1 }
        }
      })
    )
    await GIT_HANDLERS['git diff'](ctx({ worktree: 'id:wt1', path: 'big.json' }))
    expect(printed()).toContain('too large to show (120010 lines omitted)')
    expect(printed()).not.toContain('No not staged changes')
  })

  it('has no push command', () => {
    expect(Object.keys(GIT_HANDLERS).some((key) => key.includes('push'))).toBe(false)
  })
})

describe('git and pr command parsing', () => {
  function parse(argv: string[]): { commandPath: string[]; flags: Map<string, string | boolean> } {
    const parsed = normalizeCommandPositionals(COMMAND_SPECS, parseArgs(argv))
    validateCommandAndFlags(COMMAND_SPECS, parsed)
    return parsed
  }

  it('maps the file argument to --path and keeps boolean flags boolean', () => {
    const parsed = parse(['git', 'diff', 'src/a.ts', '--staged'])
    expect(parsed.commandPath).toEqual(['git', 'diff'])
    expect(parsed.flags.get('path')).toBe('src/a.ts')
    expect(parsed.flags.get('staged')).toBe(true)
    expect(parse(['git', 'commit', '--generate', '--json']).flags.get('generate')).toBe(true)
    expect(parse(['pr', 'comments', '--unresolved']).flags.get('unresolved')).toBe(true)
  })

  it('has no push, merge, or discard command, and rejects --force', () => {
    expect(() => parse(['git', 'push'])).toThrow(/Unknown command/)
    expect(() => parse(['pr', 'merge'])).toThrow(/Unknown command/)
    expect(() => parse(['git', 'discard', 'a.ts'])).toThrow(/Unknown command/)
    expect(() => parse(['git', 'pull', '--force'])).toThrow(/Unknown flag --force/)
    expect(() => parse(['git', 'status', '--page', 'p1'])).toThrow(/Unknown flag --page/)
  })

  it('lists git and pr in the root help so ADAM can discover them', () => {
    // Same line shape main/jarvis/agent-context.ts parseCommandGroups reads.
    const groups = new Set(
      captureHelp([])
        .split('\n')
        .map((line) => /^ {2}([a-z][a-z0-9-]*)\b.*\s{2,}\S/.exec(line)?.[1])
        .filter((group): group is string => group !== undefined)
    )
    expect(groups.has('git')).toBe(true)
    expect(groups.has('pr')).toBe(true)
    expect(captureHelp(['git'])).toContain('commit')
  })
})

function captureHelp(path: string[]): string {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    lines.push(String(line))
  })
  try {
    printHelp(COMMAND_SPECS, path)
  } finally {
    spy.mockRestore()
  }
  return lines.join('\n')
}

describe('fixes from the Codex review', () => {
  it('treats --dry-run=true as dry run, never committing', async () => {
    callMock.mockResolvedValueOnce(ok({ success: true, message: 'Msg' }))
    await GIT_HANDLERS['git commit'](ctx({ worktree: 'id:wt1', generate: true, 'dry-run': 'true' }))
    expect(callMock).toHaveBeenCalledTimes(1)
    await expect(
      GIT_HANDLERS['git commit'](ctx({ worktree: 'id:wt1', generate: true, 'dry-run': 'yes' }))
    ).rejects.toThrow(/takes no value/)
  })

  it('unstage --all includes both sides of a staged rename', async () => {
    callMock
      .mockResolvedValueOnce(
        ok({
          entries: [{ path: 'new.ts', oldPath: 'old.ts', status: 'renamed', area: 'staged' }],
          conflictOperation: 'unknown'
        })
      )
      .mockResolvedValueOnce(ok({ ok: true }))
    await GIT_HANDLERS['git unstage'](ctx({ worktree: 'id:wt1', all: true }))
    expect(callMock.mock.calls[1][1]).toEqual({
      worktree: 'id:wt1',
      filePaths: ['old.ts', 'new.ts']
    })
  })

  it('shows a change that only touches the final newline', async () => {
    callMock.mockResolvedValueOnce(
      ok({
        kind: 'text',
        originalContent: 'hello\n',
        modifiedContent: 'hello',
        originalIsBinary: false,
        modifiedIsBinary: false
      })
    )
    await GIT_HANDLERS['git diff'](ctx({ worktree: 'id:wt1', path: 'a.txt' }))
    expect(printed()).toContain('newline at the end of the file was removed')
  })

  it('caps diff output by size, not just line count', async () => {
    const huge = 'x'.repeat(2_000_000)
    callMock.mockResolvedValueOnce(
      ok({
        kind: 'text',
        originalContent: 'a\n',
        modifiedContent: `${huge}\n`,
        originalIsBinary: false,
        modifiedIsBinary: false
      })
    )
    await GIT_HANDLERS['git diff'](ctx({ worktree: 'id:wt1', path: 'min.js' }))
    expect(printed().length).toBeLessThan(5000)
    expect(printed()).toContain('line cut off')
  })

  it('strips escape codes from commit error text', async () => {
    callMock.mockResolvedValueOnce(ok({ success: false, error: 'hook \u001b[31mfailed' }))
    await expect(
      GIT_HANDLERS['git commit'](ctx({ worktree: 'id:wt1', message: 'x' }))
    ).rejects.toThrow('Commit failed: hook failed')
  })
})
