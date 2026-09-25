// Why: a phone token is a bearer credential shown as a QR code. Every mobile
// method that can run code, destroy work, publish or merge is mapped to a grant
// category that stays off until the owner grants it on that device. Read-only
// and low-impact methods keep working without a grant.
//
// Grants live on the device entry in dobius-devices.json and are read once at
// startup; edit them with the app closed.
export const MOBILE_RPC_GRANTS = [
  // Typing into, starting or closing shells / agents.
  'terminal.send',
  'git.push',
  'git.discard',
  'worktree.create',
  // Removing worktrees or force-deleting branches.
  'worktree.rm',
  'settings.update',
  // Overwriting any text file whose path appeared in terminal output (can
  // reach shell rc files or scripts outside the worktree).
  'files.write',
  // Merging, auto-merging, closing or reopening PRs / MRs.
  'remote.merge'
] as const

export type MobileRpcGrant = (typeof MOBILE_RPC_GRANTS)[number]

export type MobileRpcRequirement = { rejected: string } | { grants: MobileRpcGrant[] }

const GRANT_SET: ReadonlySet<string> = new Set(MOBILE_RPC_GRANTS)

const METHOD_GRANTS: Readonly<Record<string, MobileRpcGrant>> = {
  'terminal.send': 'terminal.send',
  'terminal.close': 'terminal.send',
  // Why: both tear down live PTYs (running agents), same as terminal.close.
  'session.tabs.close': 'terminal.send',
  'worktree.sleep': 'terminal.send',
  'git.push': 'git.push',
  'git.discard': 'git.discard',
  'worktree.create': 'worktree.create',
  'worktree.rm': 'worktree.rm',
  'worktree.forceDeleteBranch': 'worktree.rm',
  'settings.update': 'settings.update',
  'files.writeTerminalArtifact': 'files.write',
  'github.mergePR': 'remote.merge',
  'github.setPRAutoMerge': 'remote.merge',
  'github.updatePRState': 'remote.merge',
  'gitlab.mergeMR': 'remote.merge',
  'gitlab.updateMRState': 'remote.merge'
}

// Why: these fields make the host spawn a caller-chosen command or agent, the
// same power as terminal.send, so they need that grant on top of the method's.
const TERMINAL_CREATE_METHODS = new Set(['terminal.create', 'session.tabs.createTerminal'])
const TERMINAL_STARTUP_FIELDS = ['command', 'env', 'launchConfig']
const WORKTREE_STARTUP_FIELDS = [
  'startupCommand',
  'startupEnv',
  'startupLaunchConfig',
  'startupAgent',
  'startupPrompt',
  'startupDraft'
]

// Why: caller-supplied AI/agent command settings are spawned by the host. Phones
// must use the stored settings; no grant unlocks these, so they are rejected.
const AI_GENERATION_METHODS = new Set([
  'git.generateCommitMessage',
  'git.generatePullRequestFields',
  'git.discoverCommitMessageModels'
])
const AI_OVERRIDE_FIELDS = [
  'commitMessageAi',
  'sourceControlAi',
  'sourceControlAiResolvedParams',
  'agentCmdOverrides'
]
// Why: hook scripts and custom AI commands stored here run on a later create or
// generate; path fields redirect where worktrees and symlinks land.
const REPO_UPDATE_REJECTED_FIELDS = [
  'hookSettings',
  'sourceControlAi',
  'worktreeBasePath',
  'symlinkPaths'
]

export function isMobileRpcGrant(value: unknown): value is MobileRpcGrant {
  return typeof value === 'string' && GRANT_SET.has(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function presentFields(record: Record<string, unknown>, fields: readonly string[]): string[] {
  return fields.filter((field) => record[field] !== undefined && record[field] !== null)
}

export function mobileRpcRequirement(method: string, params: unknown): MobileRpcRequirement {
  const record = asRecord(params)
  if (AI_GENERATION_METHODS.has(method)) {
    const fields = presentFields(record, AI_OVERRIDE_FIELDS)
    if (fields.length > 0) {
      return { rejected: `mobile clients cannot override ${fields.join(', ')}` }
    }
  }
  if (method === 'repo.update') {
    const fields = presentFields(asRecord(record.updates), REPO_UPDATE_REJECTED_FIELDS)
    if (fields.length > 0) {
      return { rejected: `mobile clients cannot change ${fields.join(', ')}` }
    }
  }

  const grants = new Set<MobileRpcGrant>()
  const methodGrant = METHOD_GRANTS[method]
  if (methodGrant) {
    grants.add(methodGrant)
  }
  if (
    TERMINAL_CREATE_METHODS.has(method) &&
    presentFields(record, TERMINAL_STARTUP_FIELDS).length > 0
  ) {
    grants.add('terminal.send')
  }
  if (
    method === 'worktree.create' &&
    (presentFields(record, WORKTREE_STARTUP_FIELDS).length > 0 ||
      record.runHooks === true ||
      record.setupDecision === 'run')
  ) {
    grants.add('terminal.send')
  }
  return { grants: [...grants] }
}

export function deviceHasMobileRpcGrant(
  device: { grants?: readonly MobileRpcGrant[] },
  grant: MobileRpcGrant
): boolean {
  return device.grants?.includes(grant) === true
}
