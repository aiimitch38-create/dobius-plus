import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  getAgentRuntimeMetadataPath,
  getRuntimeMetadataPath,
  type RuntimeMetadata
} from '../../shared/runtime-bootstrap'
import { AGENT_RPC_METHOD_ALLOWLIST } from './agent-rpc-scope'
import { DobiusRuntimeService } from './dobius-runtime'
import { ALL_RPC_METHODS } from './rpc/methods'
import { DobiusRuntimeRpcServer } from './runtime-rpc'

type RpcReply = { ok: boolean; error?: { code: string; message: string } }

function readJson(path: string): RuntimeMetadata {
  return JSON.parse(readFileSync(path, 'utf8')) as RuntimeMetadata
}

async function send(endpoint: string, request: Record<string, unknown>): Promise<RpcReply> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection(endpoint)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.once('error', reject)
    socket.on('data', (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline === -1) {
        return
      }
      socket.end()
      resolve(JSON.parse(buffer.slice(0, newline)) as RpcReply)
    })
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
  })
}

async function startServer(): Promise<{
  server: DobiusRuntimeRpcServer
  full: RuntimeMetadata
  agent: RuntimeMetadata
}> {
  const userDataPath = mkdtempSync(join(tmpdir(), 'dobius-agent-scope-'))
  const server = new DobiusRuntimeRpcServer({ runtime: new DobiusRuntimeService(), userDataPath })
  await server.start()
  return {
    server,
    full: readJson(getRuntimeMetadataPath(userDataPath)),
    agent: readJson(getAgentRuntimeMetadataPath(userDataPath))
  }
}

describe('runtime RPC agent key', () => {
  it('publishes a separate agent key with the same endpoint', async () => {
    const { server, full, agent } = await startServer()
    try {
      expect(agent.authToken).toBeTruthy()
      expect(agent.authToken).not.toBe(full.authToken)
      expect(agent.transports).toEqual(full.transports)
      expect(agent.runtimeId).toBe(full.runtimeId)
    } finally {
      await server.stop()
    }
  })

  it('lets the full key reach a host-command method but refuses the agent key', async () => {
    const { server, full, agent } = await startServer()
    const endpoint = full.transports[0]!.endpoint
    const runWithCheck = {
      method: 'agent.run',
      params: { id: 'no-such-agent', prompt: 'x', check: 'touch /tmp/pwned' }
    }
    try {
      const asFull = await send(endpoint, { id: '1', authToken: full.authToken, ...runWithCheck })
      // Reaches the handler (which fails for its own reasons in a test runtime).
      expect(asFull.error?.code).not.toBe('forbidden')
      expect(asFull.error?.code).not.toBe('unauthorized')

      const asAgent = await send(endpoint, { id: '2', authToken: agent.authToken, ...runWithCheck })
      expect(asAgent.ok).toBe(false)
      expect(asAgent.error?.code).toBe('forbidden')
      expect(asAgent.error?.message).toContain("'agent.run' is not allowed with the agent key")

      for (const method of ['settings.update', 'terminal.create', 'computer.click', 'browser.eval']) {
        const reply = await send(endpoint, { id: method, authToken: agent.authToken, method })
        expect(reply.error?.code, method).toBe('forbidden')
      }
    } finally {
      await server.stop()
    }
  })

  it('serves allowlisted methods to the agent key over the socket', async () => {
    const { server, agent } = await startServer()
    const endpoint = agent.transports[0]!.endpoint
    try {
      const status = await send(endpoint, {
        id: '1',
        authToken: agent.authToken,
        method: 'status.get'
      })
      expect(status.ok).toBe(true)
      const terminals = await send(endpoint, {
        id: '2',
        authToken: agent.authToken,
        method: 'terminal.list',
        params: {}
      })
      expect(terminals.error?.code).not.toBe('forbidden')
    } finally {
      await server.stop()
    }
  })

  it('passes every allowlisted method through auth for the agent key', async () => {
    const { server, agent } = await startServer()
    const parseAndAuth = (
      server as unknown as {
        parseAndAuth: (raw: string) => { error?: RpcReply }
      }
    ).parseAndAuth.bind(server)
    try {
      for (const method of [
        'board.listConsoles',
        'board.resolveConsole',
        'terminal.read',
        'terminal.send',
        'terminal.wait',
        'orchestration.send',
        'orchestration.ask',
        'orchestration.check',
        'orchestration.reply',
        ...AGENT_RPC_METHOD_ALLOWLIST
      ]) {
        const result = parseAndAuth(JSON.stringify({ id: '1', method, authToken: agent.authToken }))
        expect(result.error, method).toBeUndefined()
      }
    } finally {
      await server.stop()
    }
  })

  it('refuses tasks.attach by file path for the agent key only', async () => {
    const { server, full, agent } = await startServer()
    const parseAndAuth = (
      server as unknown as {
        parseAndAuth: (raw: string) => { error?: RpcReply }
      }
    ).parseAndAuth.bind(server)
    const request = (authToken: string | null) =>
      JSON.stringify({
        id: '1',
        method: 'tasks.attach',
        authToken,
        params: { id: 't', file: '/etc/hosts' }
      })
    try {
      expect(parseAndAuth(request(agent.authToken)).error?.error?.code).toBe('forbidden')
      expect(parseAndAuth(request(full.authToken)).error).toBeUndefined()
    } finally {
      await server.stop()
    }
  })

  it('only allowlists methods that are registered', () => {
    const registered = new Set(ALL_RPC_METHODS.map((method) => method.name))
    expect([...AGENT_RPC_METHOD_ALLOWLIST].filter((name) => !registered.has(name))).toEqual([])
  })
})
