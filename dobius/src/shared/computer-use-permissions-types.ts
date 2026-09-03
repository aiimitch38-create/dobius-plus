export type ComputerUsePermissionId = 'accessibility' | 'screenshots'

export type ComputerUsePermissionStatus = 'granted' | 'not-granted' | 'unsupported'

export type ComputerUsePermissionState = {
  id: ComputerUsePermissionId
  status: ComputerUsePermissionStatus
}

export type ComputerUseCodeSignatureStatus = {
  adhoc: boolean
  teamId: string | null
  // Why: true when the codesign probe failed or its output could not be
  // parsed. Callers must not treat adhoc:false as proof of a stable identity.
  unknown?: boolean
}

export type ComputerUsePermissionStatusResult = {
  platform: NodeJS.Platform
  helperAppPath: string | null
  helperUnavailableReason: string | null
  permissions: ComputerUsePermissionState[]
  signature?: ComputerUseCodeSignatureStatus
}

export type ComputerUsePermissionSetupResult = {
  platform: NodeJS.Platform
  helperAppPath: string | null
  permissionId?: ComputerUsePermissionId
  openedSettings: boolean
  launchedHelper: boolean
  permissions?: ComputerUsePermissionState[]
  nextStep?: string | null
}

export type ComputerUsePermissionResetResult = ComputerUsePermissionStatusResult & {
  bundleId: string | null
}
