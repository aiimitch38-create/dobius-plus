// Why: a phone token is a bearer credential shown as a QR code. Every mobile
// method that can run code, destroy work, publish or merge is mapped to a grant
// category that stays off until the owner grants it on that device. Read-only
// and low-impact methods keep working without a grant.
//
// Grants live on the device entry in dobius-devices.json and are read once at
// startup; edit them with the app closed.
import { normalizeBrowserNavigationUrl } from '../../shared/browser-url'
import { DOBIUS_BROWSER_BLANK_URL } from '../../shared/constants'

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
  'remote.merge',
  // Driving or watching the in-app browser, which carries desktop logins.
  'browser.control'
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
  // Why: fork sync pushes the updated default branch to origin.
  'git.forkSync': 'git.push',
  'git.discard': 'git.discard',
  'worktree.create': 'worktree.create',
  'worktree.rm': 'worktree.rm',
  'worktree.forceDeleteBranch': 'worktree.rm',
  'settings.update': 'settings.update',
  // Why: both store a phone-chosen Linear credential / workspace on the host.
  'linear.connect': 'settings.update',
  'linear.selectWorkspace': 'settings.update',
  'files.writeTerminalArtifact': 'files.write',
  'files.createFile': 'files.write',
  'markdown.saveTab': 'files.write',
  'github.mergePR': 'remote.merge',
  'github.setPRAutoMerge': 'remote.merge',
  'github.updatePRState': 'remote.merge',
  'gitlab.mergeMR': 'remote.merge',
  'gitlab.updateMRState': 'remote.merge',
  'browser.back': 'browser.control',
  'browser.dialogAccept': 'browser.control',
  'browser.dialogDismiss': 'browser.control',
  'browser.forward': 'browser.control',
  'browser.goto': 'browser.control',
  'browser.keyboardInsertText': 'browser.control',
  'browser.keypress': 'browser.control',
  'browser.mouseDown': 'browser.control',
  'browser.mouseClick': 'browser.control',
  'browser.mouseMove': 'browser.control',
  'browser.mouseUp': 'browser.control',
  'browser.mouseWheel': 'browser.control',
  'browser.reload': 'browser.control',
  'browser.screencast': 'browser.control',
  'browser.tabCreate': 'browser.control',
  'browser.viewport': 'browser.control'
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

// Why: worktree push target / parent redirect where the owner's later pushes
// and PRs go; a phone must not be able to repoint them.
const WORKTREE_SET_REJECTED_FIELDS = ['pushTarget', 'parentWorktree']

// Why: files that agents or the host execute or obey on a later run. A phone
// may never write them, even with files.write.
const PROTECTED_DIR_SEGMENTS = new Set(['.git', '.claude', '.codex', '.cursor', '.gemini', '.dobius'])
const PROTECTED_FILE_NAMES = new Set([
  'claude.md',
  'claude.local.md',
  'agents.md',
  'gemini.md',
  '.cursorrules',
  'dobius.yaml',
  '.envrc'
])

export function isProtectedMobileWritePath(filePath: string): boolean {
  const segments = filePath
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0)
  const fileName = segments.at(-1) ?? ''
  return (
    PROTECTED_FILE_NAMES.has(fileName) ||
    segments.some((segment) => PROTECTED_DIR_SEGMENTS.has(segment))
  )
}

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
  if (method === 'worktree.set') {
    const fields = presentFields(record, WORKTREE_SET_REJECTED_FIELDS)
    if (fields.length > 0) {
      return `mobile clients cannot change ${fields.join(', ')}`
    }
  }
  const writePath =
    method === 'files.createFile'
      ? record.relativePath
      : method === 'files.writeTerminalArtifact'
        ? record.absolutePath
        : undefined
  if (typeof writePath === 'string' && isProtectedMobileWritePath(writePath)) {
    return 'mobile clients cannot write agent-instruction, hook or .git files'
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
