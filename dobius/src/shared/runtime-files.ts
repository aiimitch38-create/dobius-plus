/** Opening a resource and selecting it are separate client actions. */
export type RuntimeFileOpenOptions = { activate?: boolean }

export type RuntimeFileOpenNotification = RuntimeFileOpenOptions & {
  worktreeId: string
  filePath: string
  relativePath: string
  runtimeEnvironmentId?: string | null
}

export type RuntimeDiffOpenNotification = RuntimeFileOpenNotification & { staged: boolean }
