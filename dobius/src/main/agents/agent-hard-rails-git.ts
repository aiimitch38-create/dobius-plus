// Git rails for agent Bash commands: force-push and pushes whose force-ness the
// rail cannot verify. Known limit (CX12): a git alias or config written by an
// EARLIER tool call (`git config alias.p 'push -f'`, then `git p`) cannot be
// seen by a per-command text rail; the alias/push-refspec write itself is denied
// here, and the SDK sandbox build (SBX) is the process-level answer.

export const SHELL_SEGMENT_SEPARATOR = /&&|\|\||[;|&\n()`]/

export const UNVERIFIABLE_PUSH_REASON =
  'Hard rail: git push with shell variables, command substitution, GIT_* overrides, -c overrides or xargs cannot be checked for force; write the push out literally.'

export const GIT_CONFIG_WRITE_REASON =
  'Hard rail: agents may not set git aliases or push refspecs (alias.*, remote.*.push); they can turn a later push into a force-push.'

// Tokens the way the shell sees them after quote removal: `"--fo"rce` is
// `--force`, `''+main` is `+main`, `\git` is `git`.
function shellTokens(segment: string): string[] {
  return segment
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/["'\\]/g, ''))
    .filter(Boolean)
}

function isGitToken(token: string): boolean {
  return token === 'git' || token.endsWith('/git')
}

type GitSegment = { raw: string; tokens: string[]; gitIndex: number }

function gitSegments(command: string): GitSegment[] {
  return command.split(SHELL_SEGMENT_SEPARATOR).flatMap((raw) => {
    const tokens = shellTokens(raw)
    const gitIndex = tokens.findIndex(isGitToken)
    return gitIndex === -1 ? [] : [{ raw, tokens, gitIndex }]
  })
}

// Why (CX12 r3): fail closed — any `push` word after git in the same segment
// counts, whatever git options sit between (-C, --config-env, --attr-source...).
function pushIndexOf({ tokens, gitIndex }: GitSegment): number {
  return tokens.indexOf('push', gitIndex + 1)
}

// `+branch` is refspec-syntax force-push; --mirror, --delete/-d and `:branch`
// destroy remote refs too.
function isForcePushArgument(token: string): boolean {
  return (
    token.startsWith('--force') ||
    token === '--mirror' ||
    token === '--delete' ||
    /^-[A-Za-z]*[fd][A-Za-z]*$/.test(token) ||
    /^[+:]\S/.test(token)
  )
}

// Why: flags belong to the command in their own shell segment only, so
// `git push && rm -rf dist` must not read rm's `-rf` as a push flag. Every
// token after git counts, so no git option can hide a force flag.
export function isForcePush(command: string): boolean {
  return gitSegments(command).some(
    (segment) =>
      pushIndexOf(segment) !== -1 &&
      segment.tokens.slice(segment.gitIndex + 1).some(isForcePushArgument)
  )
}

const GIT_ENV_ASSIGNMENT = /(?:^|[\s;&|(])(?:export\s+|env\s+)?GIT_[A-Za-z0-9_]*\+?=/
const GIT_FUNCTION_OR_ALIAS = /(?:^|[\s;&|(])(?:function\s+git\b|git\s*\(\s*\)|alias\s+git=)/

function isConfigKeyThatRewritesPush(token: string): boolean {
  return /^(?:alias\.|remote\.[^=]*\.(?:push|mirror)(?:=|$))/i.test(token)
}

/**
 * CX12 F7/F3: `F=--force; git push "$F"` hides the flag in a variable. A push
 * is unverifiable when its own segment holds an expansion or a leading
 * assignment, it runs under xargs/parallel/-exec, a GIT_* variable is set
 * anywhere in the command, git is redefined as a function/alias, or `-c` /
 * `--config-env` precedes push.
 */
export function isUnverifiablePush(command: string): boolean {
  const pushes = gitSegments(command).filter((segment) => pushIndexOf(segment) !== -1)
  if (pushes.length === 0) {
    return false
  }
  if (GIT_ENV_ASSIGNMENT.test(command) || GIT_FUNCTION_OR_ALIAS.test(command)) {
    return true
  }
  // Coarse segments keep `$(..)` and backticks attached to the push they feed.
  const substitutedPush = command
    .split(/&&|\|\||[;|&\n]/)
    .some((raw) => /[$`]/.test(raw) && gitSegments(raw).some((part) => pushIndexOf(part) !== -1))
  if (substitutedPush) {
    return true
  }
  return pushes.some((segment) => {
    const { raw, tokens, gitIndex } = segment
    const before = tokens.slice(0, gitIndex)
    const globals = tokens.slice(gitIndex + 1, pushIndexOf(segment))
    return (
      raw.includes('$') ||
      before.some((token) => /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(token)) ||
      before.some((token) => ['xargs', 'parallel', '-exec', '-execdir'].includes(token)) ||
      globals.some((token) => token === '-c' || token.startsWith('--config-env'))
    )
  })
}

/** `git config alias.x ...`, `git -c alias.x=...`, `git --config-env alias.x=VAR`. */
export function writesPushRewritingGitConfig(command: string): boolean {
  return gitSegments(command).some(({ tokens, gitIndex }) => {
    const rest = tokens.slice(gitIndex + 1)
    const configIndex = rest.indexOf('config')
    const configKeys = configIndex === -1 ? [] : rest.slice(configIndex + 1)
    const overrideKeys = rest.flatMap((token, index) => {
      if (rest[index - 1] === '-c' || rest[index - 1] === '--config-env') {
        return [token]
      }
      if (token.startsWith('--config-env=')) {
        return [token.slice('--config-env='.length)]
      }
      return token.startsWith('-c') ? [token.slice(2)] : []
    })
    return [...configKeys, ...overrideKeys].some(isConfigKeyThatRewritesPush)
  })
}
