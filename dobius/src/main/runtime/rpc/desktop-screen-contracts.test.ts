import { describe, expect, it } from 'vitest'
import { RpcDispatcher } from './dispatcher'
import { DESKTOP_SCREEN_METHODS, ScreenStreamSchema } from './methods/desktop-screen'
import { ALL_RPC_METHODS } from './methods'
import { mobileRpcRequirement, deviceHasMobileRpcGrant } from '../mobile-rpc-grants'
import { DesktopScreenError } from '../../../shared/desktop-screen-errors'
import type { DobiusRuntimeService } from '../dobius-runtime'
import type { DesktopScreenEndpoint } from '../screen/screen-contracts'

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
          stop: () => {}
        } satisfies DesktopScreenEndpoint
      } as unknown as DobiusRuntimeService
      const dispatcher = new RpcDispatcher({ runtime, methods: DESKTOP_SCREEN_METHODS })
      const replies: string[] = []
      await dispatcher.dispatchStreaming(
        { id: 'request', authToken: 'token', method: 'screen.capabilities', params: {} },
        (reply) => replies.push(reply),
        { clientId: 'phone', connectionId: 'socket', clientKind: 'mobile' }
      )
      expect(JSON.parse(replies[0])).toMatchObject({ ok: false, error: { code } })
    }
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
