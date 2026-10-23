import { defineMethod, type RpcMethod } from '../core'

export const SYSTEM_MONITOR_METHODS: readonly RpcMethod[] = [
  defineMethod({
    name: 'system.monitor.status',
    params: null,
    handler: (_params, { systemMonitor }) => {
      if (!systemMonitor) {
        return { configured: false, status: null }
      }
      return { configured: true, status: systemMonitor.status() }
    }
  })
]
