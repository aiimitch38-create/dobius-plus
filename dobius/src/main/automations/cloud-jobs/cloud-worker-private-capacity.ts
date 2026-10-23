import { join } from 'node:path'
import { z } from 'zod'
import { CloudWorkerCapacitySample } from '../../../shared/cloud-worker-enrollment'
import { WorkerId } from '../../../shared/workstation-worker'
import { readBoundedPrivateJson } from '../../system-monitor/private-json'

const CapacityReceipt = z
  .object({
    schemaVersion: z.literal(1),
    deviceId: WorkerId,
    sample: CloudWorkerCapacitySample
  })
  .strict()

/** The trusted host collector must explicitly account for external reservations. */
export function createPrivateCloudWorkerCapacityReader(
  baseDirectory: string,
  deviceId: string,
  now: () => number = Date.now
) {
  const file = join(baseDirectory, 'worker-capacity.json')
  return (requestedDevice: string) => {
    if (requestedDevice !== deviceId) {
      throw new Error('Capacity request targets another device.')
    }
    const receipt = CapacityReceipt.parse(readBoundedPrivateJson(file))
    const age = now() - receipt.sample.sampledAt
    if (receipt.deviceId !== deviceId || age < 0 || age > 5_000) {
      throw new Error('Trusted worker capacity receipt is missing, stale, or misbound.')
    }
    return receipt.sample
  }
}
