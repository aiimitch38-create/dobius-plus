import { describe, expect, it } from 'vitest'
import { RpcDispatcher } from './dispatcher'
import { DESKTOP_SCREEN_METHODS, ScreenStreamSchema } from './methods/desktop-screen'
import { ALL_RPC_METHODS } from './methods'
import { mobileRpcRequirement, deviceHasMobileRpcGrant } from '../mobile-rpc-grants'
import { DesktopScreenError } from '../../../shared/desktop-screen-errors'
import type { DobiusRuntimeService } from '../dobius-runtime'
import type { DesktopScreenEndpoint } from '../screen/screen-contracts'
import { ScreenSessionService } from '../screen/screen-session-service'

describe('desktop screen contracts', () => {
  it('registers every screen method and gates viewing while allowing owner cleanup after revoke', () => {
    for (const name of ['screen.capabilities', 'screen.stream', 'screen.lease.renew']) {
      expect(ALL_RPC_METHODS.some((method) => method.name === name)).toBe(true)
      expect(mobileRpcRequirement(name, {})).toEqual({ grants: ['screen.view'] })
    }
    expect(mobileRpcRequirement('screen.stream.unsubscribe', {})).toEqual({ grants: [] })
    expect(deviceHasMobileRpcGrant({}, 'screen.view')).toBe(false)
  })
  it('enforces defaults and rejects out-of-bounds / nonfinite capture requests', () => {
    expect(ScreenStreamSchema.parse({})).toEqual({ fps: 3, width: 1280 })
    for (const params of [
      { fps: 11 },
      { fps: NaN },
      { fps: 1.5 },
      { width: 1281 },
      { width: 319 },
      { height: 99999 }
    ]) {
      expect(ScreenStreamSchema.safeParse(params).success).toBe(false)
    }
  })
  it('preserves safe typed errors through the actual streaming dispatcher', async () => {
    for (const code of [
      'screen_permission_missing',
      'screen_not_authorized',
      'screen_busy'
    ] as const) {
      const runtime = {
        getRuntimeId: () => 'host',
        desktopScreen: {
          supported: true,
          capabilities: async () => {
            throw new DesktopScreenError(code)
          },
          stream: async () => {},
          unsubscribe: () => ({ unsubscribed: true }),
          renew: () => ({ renewed: true }),
          stop: () => {},
          revokeDevice: () => {}
        } satisfies DesktopScreenEndpoint
      } as unknown as DobiusRuntimeService
      const dispatcher = new RpcDispatcher({ runtime, methods: DESKTOP_SCREEN_METHODS })
      const replies: string[] = []
      await dispatcher.dispatchStreaming(
        { id: 'request', authToken: 'token', method: 'screen.capabilities', params: {} },
        (reply) => replies.push(reply),
        { clientId: 'token', clientDeviceId: 'phone', connectionId: 'socket', clientKind: 'mobile' }
      )
      expect(JSON.parse(replies[0])).toMatchObject({ ok: false, error: { code } })
    }
  })
  it('looks up screen grants by stable device ID, not the bearer token', async () => {
    const screen = new ScreenSessionService(
      {
        supported: true,
        status: async () => ({
          supported: true,
          permission: 'granted',
          display: { id: 1, width: 1440, height: 900 },
          maxFps: 10,
          maxWidth: 1280
        }),
        create: () => {
          throw new Error('capture is not used by capabilities')
        }
      },
      (id) =>
        id === 'stable-device-id'
          ? { name: 'Stored phone', scope: 'mobile', grants: ['screen.view'] }
          : null
    )
    const runtime = {
      getRuntimeId: () => 'host',
      desktopScreen: screen
    } as unknown as DobiusRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: DESKTOP_SCREEN_METHODS })
    const replies: string[] = []
    await dispatcher.dispatchStreaming(
      { id: 'request', authToken: 'paired-token', method: 'screen.capabilities', params: {} },
      (reply) => replies.push(reply),
      {
        clientId: 'paired-token',
        clientDeviceId: 'stable-device-id',
        connectionId: 'socket',
        clientKind: 'mobile'
      }
    )
    expect(JSON.parse(replies[0])).toMatchObject({ ok: true, result: { supported: true } })
  })
  it('fails safely on a headless host instead of importing a capture implementation', async () => {
    const runtime = { getRuntimeId: () => 'headless' } as DobiusRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: DESKTOP_SCREEN_METHODS })
    expect(
      await dispatcher.dispatch({
        id: 'request',
        authToken: 'token',
        method: 'screen.capabilities',
        params: {}
      })
    ).toMatchObject({ ok: false, error: { code: 'screen_unsupported' } })
  })
})
