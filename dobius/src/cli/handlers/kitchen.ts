import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'

type KitchenStatus = {
  enabled: boolean
  crewRunning: boolean
  cooking: number
  waiting: number
  maxCooks: number
  maxMinutes: number
}

export function formatKitchenStatus(status: KitchenStatus): string {
  return [
    status.enabled ? 'Kitchen is on.' : 'Kitchen is off.',
    ...(status.enabled && !status.crewRunning
      ? ['The crew is paused, so no new cook starts.']
      : []),
    `Cooks running: ${status.cooking} of ${status.maxCooks}.`,
    `Cards waiting for a cook: ${status.waiting}.`,
    `Time cap per card: ${status.maxMinutes} minutes.`
  ].join('\n')
}

export const KITCHEN_HANDLERS: Record<string, CommandHandler> = {
  'kitchen status': async ({ client, json }) => {
    const result = await client.call<KitchenStatus>('kitchen.status')
    printResult(result, json, formatKitchenStatus)
  }
}
