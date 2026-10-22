import type { TelegramConnectionContext } from './connection'

/** Keep shutdown cleanup fenced from a newer lifecycle operation. */
export async function stopTelegramClient(context: TelegramConnectionContext): Promise<number> {
  const generation = context.beginOperation()
  context.cancelAuthorization()
  await context.replies.stop()
  await context.replies.drainSends()
  if (!context.isGenerationCurrent(generation)) {
    return generation
  }
  const client = context.getClient()
  context.setClient(null)
  if (client) {
    await client.disconnect().catch(() => undefined)
  }
  return generation
}
