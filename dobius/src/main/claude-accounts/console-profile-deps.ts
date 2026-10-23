import { join } from 'node:path'
import type { Store } from '../persistence'
import { getSystemCodexHomePath } from '../codex/codex-home-paths'
import { getUserDataRoot } from '../storage/user-data-root'
import type { ConsoleProfileDeps } from './console-profile'

export function getConsoleProfilesRoot(): string {
  return join(getUserDataRoot(), 'console-profiles')
}

export function createConsoleProfileDeps(
  store: Store,
  getClaudeRuntimeConfigDir: () => string
): ConsoleProfileDeps {
  return {
    profilesRoot: getConsoleProfilesRoot(),
    sharedConfigDir: (agent) =>
      agent === 'claude' ? getClaudeRuntimeConfigDir() : getSystemCodexHomePath(),
    getClaudeAccounts: () => store.getSettings().claudeManagedAccounts ?? [],
    getCodexAccounts: () => store.getSettings().codexManagedAccounts ?? [],
    platform: process.platform,
    warn: (message, error) => console.warn(message, error)
  }
}
