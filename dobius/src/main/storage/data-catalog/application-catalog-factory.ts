import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ApplicationDataCatalog, type CatalogPairedDevice } from './application-catalog'
import { createDescriptorDirectoryBridge } from './descriptor-directory-bridge'

export type ApplicationCatalogOptions = {
  registryPath: string
  pairedDevices: () => readonly CatalogPairedDevice[]
  pairedMobileDevices?: () => readonly CatalogPairedDevice[]
  onPreviewInvalidated?: (connectionId: string, event: unknown) => void
  chooseDirectory: () => Promise<string | null>
  packaged: boolean
  resourcesPath: string
  applicationPath: string
}

/** Resolve only application-owned helper paths; callers cannot supply executable arguments. */
export function createApplicationDataCatalog(options: ApplicationCatalogOptions) {
  const scriptPath = options.packaged
    ? join(options.resourcesPath, 'data-catalog', 'descriptor-directory-bridge.py')
    : join(
        options.applicationPath,
        'config',
        'scripts',
        'data-catalog',
        'descriptor-directory-bridge.py'
      )
  const candidates =
    process.platform === 'darwin'
      ? [
          join(homedir(), 'homebrew', 'bin', 'python3'),
          '/opt/homebrew/bin/python3',
          '/usr/local/bin/python3',
          '/usr/bin/python3'
        ]
      : process.platform === 'linux'
        ? ['/usr/bin/python3', '/usr/local/bin/python3']
        : []
  const pythonExecutable = candidates.find((path) => isAccessible(path, constants.X_OK))
  // Unavailable platforms/interpreters retain registration but refuse unsafe path-only scans.
  const bridge =
    pythonExecutable && isAccessible(scriptPath, constants.R_OK)
      ? createDescriptorDirectoryBridge({ pythonExecutable, scriptPath })
      : undefined
  return new ApplicationDataCatalog({
    ...options,
    fileSystem: bridge,
    disposeFileSystem: bridge ? () => bridge.dispose() : undefined
  })
}

function isAccessible(path: string, mode: number): boolean {
  try {
    accessSync(path, mode)
    return true
  } catch {
    return false
  }
}
