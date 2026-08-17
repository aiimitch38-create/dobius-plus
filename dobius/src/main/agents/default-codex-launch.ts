export type PrepareCodexLaunch = (target?: {
  accountId?: string | null
}) => string | null

let defaultPrepareCodexLaunch: PrepareCodexLaunch | null = null

export function setDefaultPrepareCodexLaunch(prepare: PrepareCodexLaunch): void {
  defaultPrepareCodexLaunch = prepare
}

export function getDefaultPrepareCodexLaunch(): PrepareCodexLaunch | null {
  return defaultPrepareCodexLaunch
}
