// Why: a phone token is a bearer credential shown as a QR code. Every mobile
// method that can run code, destroy work, publish or merge is mapped to a grant
// category that stays off until the owner grants it on that device. Read-only
// and low-impact methods keep working without a grant.
//
// Grants live on the device entry in dobius-devices.json and are read once at
// startup; edit them with the app closed.
import { normalizeBrowserNavigationUrl } from '../../shared/browser-url'
import { DOBIUS_BROWSER_BLANK_URL } from '../../shared/constants'
import { MOBILE_RPC_METHOD_CLASSES } from './mobile-rpc-method-classes'
import { isProtectedMobileWritePath } from './mobile-write-path-guard'

export const MOBILE_RPC_GRANTS = [
  // Typing into, starting or closing shells / agents.
  'terminal.send',
  'git.push',
  'git.discard',
  // Importing other refs or remotes (checkout, pull, fast-forward, rebase):
  // brings in a fork's agent files, hooks or package scripts.
  'git.sync',
  'worktree.create',
  // Removing worktrees or force-deleting branches.
  'worktree.rm',
  'settings.update',
  // Overwriting any text file whose path appeared in terminal output (can
  // reach shell rc files or scripts outside the worktree).
  'files.write',
  // Merging, auto-merging, closing or reopening PRs / MRs.
  'remote.merge',
  // Outward tracker writes: issues, PRs/MRs, comments, reviewers, projects.
  'remote.write',
  // Driving or watching the in-app browser, which carries desktop logins.
  'browser.control'
] as const

export type MobileRpcGrant = (typeof MOBILE_RPC_GRANTS)[number]

export type MobileRpcRequirement = { rejected: string } | { grants: MobileRpcGrant[] }

const GRANT_SET: ReadonlySet<string> = new Set(MOBILE_RPC_GRANTS)

// Why: these fields make the host spawn a caller-chosen command or agent, the
// same power as terminal.send, so they need that grant on top of the method's.
const TERMINAL_CREATE_METHODS = new Set(['terminal.create', 'session.tabs.createTerminal'])
// `agent`/`launchAgent` start an agent (and mark the folder trusted).
const TERMINAL_STARTUP_FIELDS = ['command', 'env', 'launchConfig', 'agent', 'launchAgent', 'launchToken']
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
  'symlinkPaths',
  // Why: these redirect which remote fork sync and issue sources talk to.
  'forkSyncMode',
  'upstream'
]

// Why: worktree push target / parent redirect where the owner's later pushes
// and PRs go; a phone must not be able to repoint them.
const WORKTREE_SET_REJECTED_FIELDS = ['pushTarget', 'parentWorktree', 'baseRef']
// Why: worktree.create from a caller-chosen base or remote imports that ref's
// content (and runs its checkout hooks), same as git.sync.
const WORKTREE_CREATE_SYNC_FIELDS = ['baseBranch', 'pushTarget']
// Why: hook trust / setup-prompt dismissal would silence the dobius.yaml
// setup prompt; browser defaults and custom pets/sidekicks feed privileged
// renderer surfaces; update dismissals would hide security updates.
const UI_SET_REJECTED_FIELDS = [
  'trustedDobiusHooks',
  'setupScriptPromptDismissedRepoIds',
  'browserDefaultUrl',
  'browserKagiSessionLink',
  'customPets',
  'customSidekicks',
  'dismissedUpdateVersion',
  'dismissedUpdateNudgeId',
  'pendingUpdateNudgeId'
]

// Why: the in-app browser also opens file: URLs and bare paths (local
// previews), which would let a phone read any local file over the screencast.
// A URL starting with '-' would also be read as a flag by agent-browser.
function isAllowedMobileBrowserUrl(url: unknown, optional: boolean): boolean {
  if (url === undefined || url === null) {
    return optional
  }
  if (typeof url !== 'string' || url.trim().startsWith('-')) {
    return false
  }
  if (optional && (url.trim() === '' || url.trim() === 'about:blank')) {
    return true
  }
  const normalized = normalizeBrowserNavigationUrl(url)
  if (!normalized || normalized === DOBIUS_BROWSER_BLANK_URL) {
    return false
  }
  return normalized.startsWith('http:') || normalized.startsWith('https:')
}

function mobileRejection(method: string, record: Record<string, unknown>): string | null {
  if (method === 'browser.goto' && !isAllowedMobileBrowserUrl(record.url, false)) {
    return 'mobile clients may only open http(s) URLs'
  }
  if (method === 'browser.tabCreate' && !isAllowedMobileBrowserUrl(record.url, true)) {
    return 'mobile clients may only open http(s) URLs'
  }
  if (method === 'ui.set') {
    const fields = presentFields(record, UI_SET_REJECTED_FIELDS)
    if (fields.length > 0) {
      return `mobile clients cannot change ${fields.join(', ')}`
    }
  }
  if (method === 'worktree.set') {
    const fields = presentFields(record, WORKTREE_SET_REJECTED_FIELDS)
    if (fields.length > 0) {
      return `mobile clients cannot change ${fields.join(', ')}`
    }
  }
  // Why: early refusal on the relative path; the host-side guard
  // (mobile-write-path-guard.ts) re-checks against the real filesystem.
  if (
    method === 'files.createFile' &&
    typeof record.relativePath === 'string' &&
    isProtectedMobileWritePath(record.relativePath)
  ) {
    return 'mobile clients cannot write agent-instruction, hook, script or .git files'
  }
  return null
}

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
  const rejection = mobileRejection(method, record)
  if (rejection) {
    return { rejected: rejection }
  }
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

  const methodClass = Object.hasOwn(MOBILE_RPC_METHOD_CLASSES, method)
    ? MOBILE_RPC_METHOD_CLASSES[method]
    : undefined
  if (!methodClass) {
    // Why: default-deny; see mobile-rpc-method-classes.ts.
    return { rejected: 'method is not classified for mobile clients' }
  }
  const grants = new Set<MobileRpcGrant>()
  if (methodClass !== 'read' && methodClass !== 'benign-mutation') {
    grants.add(methodClass)
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
  if (method === 'worktree.create' && presentFields(record, WORKTREE_CREATE_SYNC_FIELDS).length > 0) {
    grants.add('git.sync')
  }
  // Why: a desktop-visible activation runs the renderer's activation flow,
  // which resumes sleeping agent sessions. The phone app sends false.
  if (method === 'worktree.activate' && record.notifyClients !== false) {
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
