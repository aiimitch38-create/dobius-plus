import { connect } from './rpc-client'
import { saveHost } from './host-store'
import type { HostProfile } from './types'

export function connectHostProfile(host: HostProfile) {
  return connect(host.endpoint, host.deviceToken, host.publicKeyB64, {
    onDeviceTokenRotated: (deviceToken) => {
      void saveHost({ ...host, deviceToken }).catch((err: unknown) => {
        console.warn('[host] could not save rotated device token', err)
      })
    }
  })
}
