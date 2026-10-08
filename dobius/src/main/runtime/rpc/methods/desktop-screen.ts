import { z } from 'zod'
import { DesktopScreenError } from '../../../../shared/desktop-screen-errors'
import { defineMethod, defineStreamingMethod, type RpcAnyMethod, type RpcContext } from '../core'
import type { DesktopScreenEndpoint, ScreenOwner } from '../../screen/screen-contracts'

export const ScreenStreamSchema = z
  .object({
    fps: z.number().int().min(1).max(10).default(3),
    width: z.number().int().min(320).max(1280).default(1280)
  })
  .strict()
export const ScreenReferenceSchema = z
  .object({ subscriptionId: z.uuid(), generation: z.uuid() })
  .strict()

function endpoint(ctx: RpcContext): DesktopScreenEndpoint {
  if (!ctx.runtime.desktopScreen?.supported) {
    throw new DesktopScreenError('screen_unsupported')
  }
  return ctx.runtime.desktopScreen
}
function owner(ctx: RpcContext): ScreenOwner {
  if (!ctx.clientId || !ctx.connectionId || ctx.clientKind !== 'mobile') {
    throw new DesktopScreenError('screen_not_authorized')
  }
  return {
    deviceId: ctx.clientId,
    connectionId: ctx.connectionId,
    requestId: ctx.requestId,
    signal: ctx.signal,
    sendBinary: ctx.sendBinary
  }
}

export const DESKTOP_SCREEN_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'screen.capabilities',
    params: z.object({}).strict(),
    handler: async (_, ctx) => endpoint(ctx).capabilities(owner(ctx))
  }),
  defineStreamingMethod({
    name: 'screen.stream',
    params: ScreenStreamSchema,
    handler: async (params, ctx, emit) => endpoint(ctx).stream(params, owner(ctx), emit)
  }),
  defineMethod({
    name: 'screen.stream.unsubscribe',
    params: z.union([
      ScreenReferenceSchema,
      z.object({ requestId: z.string().min(1).max(128) }).strict()
    ]),
    handler: (params, ctx) => endpoint(ctx).unsubscribe(params, owner(ctx))
  }),
  defineMethod({
    name: 'screen.lease.renew',
    params: ScreenReferenceSchema,
    handler: (params, ctx) => endpoint(ctx).renew(params, owner(ctx))
  })
]
