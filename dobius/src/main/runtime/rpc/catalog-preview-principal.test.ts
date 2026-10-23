import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { RpcDispatcher } from './dispatcher'
import { defineMethod } from './core'

const runtime = { getRuntimeId: () => 'runtime-fixture' }
const request = { id: 'rpc-1', authToken: 'opaque', method: 'preview.probe' }

describe('catalog preview RPC principal derivation', () => {
  it('builds a local principal only from main-provided WebContents identity', async () => {
    let observed: unknown
    const dispatcher = new RpcDispatcher({
      runtime: runtime as never,
      methods: [
        defineMethod({
          name: 'preview.probe',
          params: z.object({ principal: z.string().optional() }).strict(),
          handler: (_params, context) => {
            observed = context.catalogPreviewPrincipal
            return { accepted: true }
          }
        })
      ]
    })
    const controller = new AbortController()
    const connection = {
      kind: 'local-webcontents' as const,
      connectionId: 'local:44:document-token',
      webContentsId: 44,
      navigationId: 2,
      signal: controller.signal
    }

    await dispatcher.dispatch(
      { ...request, params: { principal: 'device:forged' } },
      { authenticatedLocal: true, localPreviewConnection: connection }
    )

    expect(observed).toMatchObject({
      kind: 'local-webcontents',
      principalId: 'desktop',
      connectionId: connection.connectionId,
      hostId: 'runtime-fixture',
      webContentsId: 44,
      navigationId: '2',
      signal: controller.signal
    })
  })

  it('derives phone authority from verified mobile context and refuses runtime, unix, or incomplete scope', async () => {
    const observed: unknown[] = []
    const dispatcher = new RpcDispatcher({
      runtime: runtime as never,
      methods: [
        defineMethod({
          name: 'preview.probe',
          params: null,
          handler: (_params, context) => {
            observed.push(context.catalogPreviewPrincipal ?? null)
            return { accepted: true }
          }
        })
      ]
    })
    const controller = new AbortController()
    const base = {
      connectionId: 'ws-connection-1',
      connectionSignal: controller.signal,
      clientDeviceId: '8b98d8e6-64c3-4a59-891e-8bd9058f1b22'
    }

    for (const clientKind of ['mobile', 'runtime'] as const) {
      await dispatcher.dispatchStreaming({ ...request, params: null }, () => undefined, {
        ...base,
        clientKind
      })
    }
    await dispatcher.dispatchStreaming({ ...request, params: null }, () => undefined, {
      connectionId: 'unix-request',
      clientDeviceId: base.clientDeviceId
    })
    await dispatcher.dispatchStreaming({ ...request, params: null }, () => undefined, {
      ...base,
      clientKind: 'mobile',
      connectionSignal: undefined
    })

    expect(observed[0]).toMatchObject({
      kind: 'paired-mobile',
      principalId: 'device:8b98d8e6-64c3-4a59-891e-8bd9058f1b22',
      deviceId: '8b98d8e6-64c3-4a59-891e-8bd9058f1b22',
      connectionId: 'ws-connection-1',
      hostId: 'runtime-fixture',
      scope: 'mobile',
      signal: controller.signal
    })
    expect(observed.slice(1)).toEqual([null, null, null])
  })
})
