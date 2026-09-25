import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as Os from 'node:os'
import type { IMessageBridge } from './types'
import { handleConductorCliRequest, requestImessageApproval } from './conductor-cli-routing'
import type { ConductorCliDeps } from './cli-server'
import { CONDUCTOR_SYSTEM_PROMPT } from './conductor-system-prompt'

const state = vi.hoisted(() => ({ userData: '', home: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof Os>('node:os')
  return { ...actual, homedir: () => state.home }
})

function fakeImessage(answer: string | Error, reason: string | null = null): IMessageBridge & {
  ask: ReturnType<typeof vi.fn>
} {
  return {
    isAvailable: () => reason === null,
    unavailableReason: () => reason,
    send: vi.fn(async () => {}),
    ask: vi.fn(async () => {
      if (answer instanceof Error) {
        throw answer
      }
      return answer
    })
  }
}

function depsWith(imessage: IMessageBridge): ConductorCliDeps & {
  terminals: { spawnAgent: ReturnType<typeof vi.fn> }
} {
  return {
    imessage,
    terminals: { spawnAgent: vi.fn(async () => ({ runId: 'run-1' })) }
  } as unknown as ConductorCliDeps & { terminals: { spawnAgent: ReturnType<typeof vi.fn> } }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('#9 requestImessageApproval fails closed', () => {
  it('approves only an explicit approval word', async () => {
    for (const answer of ['yes', 'Y', 'ok', 'Approve.', 'confirm!']) {
      await expect(requestImessageApproval(fakeImessage(answer), 'git push')).resolves.toEqual({
        approved: true,
        reason: 'approved'
      })
    }
  })

  it('denies anything else', async () => {
    for (const answer of ['no', 'yes but wait', 'sure thing', 'why?', 'yes yes']) {
      const decision = await requestImessageApproval(fakeImessage(answer), 'git push')
      expect(decision.approved).toBe(false)
    }
  })

  it('denies on timeout and on a missing handle, naming the reason', async () => {
    await expect(requestImessageApproval(fakeImessage(''), 'x')).resolves.toEqual({
      approved: false,
      reason: 'no reply'
    })
    const missing = fakeImessage('yes', 'iMessage handle not configured')
    const decision = await requestImessageApproval(missing, 'x')
    expect(decision).toEqual({
      approved: false,
      reason: 'no confirmation channel: iMessage handle not configured'
    })
    expect(missing.ask).not.toHaveBeenCalled()
  })

  it('names the action in the question', async () => {
    const imessage = fakeImessage('yes')
    await requestImessageApproval(imessage, 'git push origin main')
    expect(imessage.ask.mock.calls[0][0]).toContain('git push origin main')
  })
})

describe('#9 /confirm and /spawn routes', () => {
  it('/confirm returns approved only for an explicit yes', async () => {
    const yes = await handleConductorCliRequest('/confirm', { action: 'git push' }, {
      authorized: true,
      deps: depsWith(fakeImessage('yes'))
    })
    expect(yes).toEqual({ status: 200, body: { ok: true, approved: true, reason: 'approved' } })
    const no = await handleConductorCliRequest('/confirm', { action: 'git push' }, {
      authorized: true,
      deps: depsWith(fakeImessage('yes please do it later'))
    })
    expect((no.body as { approved: boolean }).approved).toBe(false)
  })

  it('/confirm with no action, or a failed ask, never approves', async () => {
    const empty = await handleConductorCliRequest('/confirm', {}, {
      authorized: true,
      deps: depsWith(fakeImessage('yes'))
    })
    expect(empty.status).toBe(400)
    expect((empty.body as { approved: boolean }).approved).toBe(false)
    const failed = await handleConductorCliRequest('/confirm', { action: 'rm -rf x' }, {
      authorized: true,
      deps: depsWith(fakeImessage(new Error('rate limit')))
    })
    expect(failed.status).toBe(500)
    expect((failed.body as { approved?: boolean }).approved).toBeUndefined()
  })

  it('/spawn does not spawn on a hedged yes', async () => {
    const deps = depsWith(fakeImessage('yes but not now'))
    const result = await handleConductorCliRequest(
      '/spawn',
      { projectPath: '/repo', agentId: 'a1', initialPrompt: 'go' },
      { authorized: true, deps }
    )
    expect((result.body as { ok: boolean }).ok).toBe(false)
    expect(deps.terminals.spawnAgent).not.toHaveBeenCalled()
  })

  it('/ask reports a missing handle instead of an empty answer', async () => {
    const imessage = fakeImessage('yes', 'iMessage handle not configured')
    const result = await handleConductorCliRequest('/ask', { question: 'which one?' }, {
      authorized: true,
      deps: depsWith(imessage)
    })
    expect(result).toEqual({ status: 200, body: { ok: false, error: 'iMessage handle not configured' } })
    expect(imessage.ask).not.toHaveBeenCalled()
  })
})

describe('#9 installed dobius-confirm script exits 0 only on approval', () => {
  function installAndStubCurl(curlBody: string): { script: string; env: NodeJS.ProcessEnv } {
    state.home = mkdtempSync(path.join(tmpdir(), 'conductor-home-'))
    state.userData = mkdtempSync(path.join(tmpdir(), 'conductor-userdata-'))
    writeFileSync(path.join(state.userData, 'voice-conductor-cli-token'), 'a'.repeat(64))
    const stubBin = mkdtempSync(path.join(tmpdir(), 'conductor-stub-bin-'))
    // Why: a fake curl keeps the test off the network and lets it pick the reply.
    writeFileSync(path.join(stubBin, 'curl'), `#!/bin/bash\n${curlBody}\n`)
    chmodSync(path.join(stubBin, 'curl'), 0o755)
    return {
      script: path.join(state.home, '.local', 'bin', 'dobius-confirm'),
      env: { ...process.env, PATH: `${stubBin}:${process.env.PATH ?? ''}` }
    }
  }

  async function run(curlBody: string): Promise<{ code: number; out: string }> {
    const { installConductorClis } = await import('./cli-install')
    const { script, env } = installAndStubCurl(curlBody)
    installConductorClis()
    expect(readFileSync(script, 'utf8')).toContain('/confirm')
    try {
      const out = execFileSync('/bin/bash', [script, 'git push origin main'], {
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      return { code: 0, out }
    } catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string }
      return { code: failure.status, out: `${failure.stdout}${failure.stderr}` }
    }
  }

  it('approved response → exit 0', async () => {
    const result = await run(`echo '{"ok":true,"approved":true,"reason":"approved"}'`)
    expect(result).toEqual({ code: 0, out: 'APPROVED\n' })
  })

  it('denied response → non-zero with DENIED', async () => {
    const result = await run(`echo '{"ok":true,"approved":false,"reason":"rejected"}'`)
    expect(result.code).not.toBe(0)
    expect(result.out).toContain('DENIED: rejected')
  })

  it('server unreachable, error body or garbage → non-zero', async () => {
    for (const body of [
      'echo "curl: (7) Failed to connect" >&2; exit 7',
      `echo '{"ok":false,"error":"unauthorized"}'`,
      'echo "<html>"',
      `echo '{"ok":true,"approved":"true"}'`
    ]) {
      const result = await run(body)
      expect(result.code).not.toBe(0)
      expect(result.out).toContain('DENIED')
    }
  })
})

describe('#9 system prompt treats a missing or failed dobius-confirm as NO', () => {
  it('states the fail-closed rule and separates ask from confirm', () => {
    expect(CONDUCTOR_SYSTEM_PROMPT).toContain('dobius-confirm is missing, fails, times out or prints DENIED, the answer is NO')
    expect(CONDUCTOR_SYSTEM_PROMPT).toContain('It is NOT an approval: for risky actions use dobius-confirm.')
    expect(CONDUCTOR_SYSTEM_PROMPT).not.toContain("only proceed if Carson's answer matches yes/y/ok")
  })
})

describe('X5 dobius-ask help names the configured recipient', () => {
  it('no longer says it asks Sam', async () => {
    state.home = mkdtempSync(path.join(tmpdir(), 'conductor-home-'))
    state.userData = mkdtempSync(path.join(tmpdir(), 'conductor-userdata-'))
    const { installConductorClis } = await import('./cli-install')
    installConductorClis()
    const script = readFileSync(path.join(state.home, '.local', 'bin', 'dobius-ask'), 'utf8')
    expect(script).not.toContain('Ask Sam')
    expect(script).toContain('Settings (iMessage bridge)')
  })
})
