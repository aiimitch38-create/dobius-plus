import {
  DataCatalogDeviceIds,
  type DataCatalogRootView
} from '../../../../shared/data-catalog-roots'

export type DataCatalogDevice = { deviceId: string; name: string }
const ROOT_KINDS: readonly [DataCatalogRootView['kind'], string][] = [
  ['repository', 'Repository'],
  ['folder-workspace', 'Workspace folder'],
  ['obsidian-vault', 'Obsidian vault'],
  ['artifact', 'Artifact folder']
]

export function catalogRootKindLabel(kind: DataCatalogRootView['kind']): string {
  return ROOT_KINDS.find(([value]) => value === kind)?.[1] ?? 'Folder'
}

export function isCatalogDeviceRoster(value: unknown): value is { devices: DataCatalogDevice[] } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('devices' in value) ||
    !Array.isArray(value.devices)
  ) {
    return false
  }
  return (
    DataCatalogDeviceIds.safeParse(
      value.devices.map((device) =>
        typeof device === 'object' && device !== null && 'deviceId' in device
          ? device.deviceId
          : null
      )
    ).success &&
    value.devices.every(
      (device) =>
        typeof device === 'object' &&
        device !== null &&
        'deviceId' in device &&
        typeof device.deviceId === 'string' &&
        'name' in device &&
        typeof device.name === 'string'
    )
  )
}

export function isCatalogRootRemoved(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'removed' in value && value.removed === true
}
