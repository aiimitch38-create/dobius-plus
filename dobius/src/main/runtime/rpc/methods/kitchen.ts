// `dobius kitchen status` over RPC: read-only. The kitchen is switched on and
// off in the app only (Settings, Agents), and cards are marked there too.
import { kitchenStatus, type KitchenStatus } from '../../../vertex/kitchen'
import { defineMethod, type RpcMethod } from '../core'

export const KITCHEN_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'kitchen.status',
    params: null,
    handler: (): KitchenStatus => {
      const status = kitchenStatus()
      if (!status) {
        throw new Error('Dobius+ is still starting; try again in a minute.')
      }
      return status
    }
  })
]
