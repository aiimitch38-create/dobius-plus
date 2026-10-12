/**
 * Path segments never writable even inside an allowed root. Compared
 * case-insensitively: the default macOS volume treats `.GIT` as `.git`.
 */
const FORBIDDEN_SEGMENTS = new Set(['.git', 'node_modules', 'out', 'dist', '.ssh', '.gnupg'])

/**
 * Sensitive-file policy: credential and secret files are never writable, in any
 * folder. Covers every `.env` variant (`.env.local`, `.env.production`, ...)
 * except the committed templates below, which carry no secrets,
 * package-manager and git credential files, private keys and certificates, and
 * the ADAM service token.
 */
const SENSITIVE_FILE_NAMES = new Set([
  '.envrc',
  '.npmrc',
  '.netrc',
  '.pypirc',
  '.git-credentials',
  'auth.json',
  'credentials',
  'credentials.json',
  'service-token',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519'
])
const ENV_TEMPLATE_NAMES = new Set(['.env.example', '.env.sample', '.env.template'])
const SENSITIVE_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx', '.enc', '.keystore', '.jks']

export function isSensitiveFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower === '.env' ||
    (lower.startsWith('.env.') && !ENV_TEMPLATE_NAMES.has(lower)) ||
    SENSITIVE_FILE_NAMES.has(lower) ||
    SENSITIVE_EXTENSIONS.some((extension) => lower.endsWith(extension))
  )
}

/**
 * Why: Windows silently drops a trailing dot or space (`.git.` opens `.git`) and
 * reads `name::$DATA` as the file itself, so such names would slip past the
 * policy. Refused on every platform; they are never ordinary source names.
 */
function isAliasedName(segment: string): boolean {
  return /[. ]$/.test(segment) || segment.includes(':')
}

/**
 * `rootRelative` segments are the canonical path below an allowed root; only
 * those are checked for aliased names, since the root's own absolute segments
 * (a drive like `C:`) are not the model's choice.
 */
export function protectedReason(
  segments: string[],
  requested: string,
  options: { rootRelative?: boolean } = {}
): string | null {
  const parts = segments.filter(Boolean)
  if (options.rootRelative && parts.some(isAliasedName)) {
    return `"${requested}" has a name Windows would read as a different file.`
  }
  if (parts.some((segment) => FORBIDDEN_SEGMENTS.has(segment.toLowerCase()))) {
    return `"${requested}" is in a protected directory.`
  }
  const leaf = parts.at(-1)
  if (leaf && isSensitiveFileName(leaf)) {
    return `"${requested}" is a secrets or credentials file.`
  }
  return null
}
