import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { DOBIUS_SERVICES_DISCONNECTED } from './dobius-disconnect'
import type { UpdateDisabledReason } from '../shared/types'

export type UpdatePolicy = { enabled: true } | { enabled: false; reason: UpdateDisabledReason }

export type UpdatePolicyInputs = {
  disconnected: boolean
  enableFlag: string | undefined
  isPackaged: boolean
  isDev: boolean
}

// Why: one decision for every updater entry point (setup, startup/wake/timer
// checks, manual check, download, install). Setup used to check only the env
// opt-in while background checks ignored the disconnect switch, so an opted-in
// disconnected build could show "update available" with a dead Download button.
// The disconnect switch wins over the opt-in: the gated install script is the
// only thing allowed to replace the installed app.
export function resolveUpdatePolicy(inputs: UpdatePolicyInputs): UpdatePolicy {
  if (inputs.disconnected) {
    return { enabled: false, reason: 'disconnected' }
  }
  if (inputs.enableFlag !== '1') {
    return { enabled: false, reason: 'not-enabled' }
  }
  if (!inputs.isPackaged || inputs.isDev) {
    return { enabled: false, reason: 'dev-build' }
  }
  return { enabled: true }
}

export function getUpdatePolicy(): UpdatePolicy {
  return resolveUpdatePolicy({
    disconnected: DOBIUS_SERVICES_DISCONNECTED,
    enableFlag: process.env.DOBIUS_ENABLE_DOBIUS_UPDATES,
    isPackaged: app.isPackaged,
    isDev: is.dev
  })
}
