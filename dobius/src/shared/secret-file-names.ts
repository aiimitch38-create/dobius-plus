// Why shared: main's agent file guard and the CLI (checking a --from-file
// source on the caller's machine) must refuse exactly the same names.

// Why: APFS matches names case-insensitively after compatibility folding, so
// "ſecret" (long s) or a Kelvin-sign "K" open the same file. Same folding as
// foldApfsName in main/runtime/mobile-write-path-guard.ts.
export function foldSecretName(name: string): string {
  return name.normalize('NFKC').replaceAll('\u017F', 's').replaceAll('\u212A', 'k').toLowerCase()
}

// Matched against each folded file name (and the resolved name after symlinks).
const SECRET_FILE_NAME_PATTERNS: readonly RegExp[] = [
  /^\.env/,
  /key/,
  /secret/,
  /credential/,
  /token/,
  /password/,
  /^dobius-runtime.*\.json$/,
  /\.(pem|p12|pfx|keystore)$/,
  /^id_(rsa|dsa|ecdsa|ed25519)/,
  /^\.netrc$/,
  /^\.npmrc$/,
  /^\.pgpass$/
]
const SECRET_DIRECTORY_NAMES = new Set(['.ssh', '.aws', '.gnupg', '.docker', '.kube'])

/** The same rules as globs, so a search never even opens a secret file (a
 *  post-filter alone would leak through match counts and truncation). Passed
 *  as caseInsensitiveExcludeGlobs: rg --iglob, git grep :(exclude,icase,glob). */
export const SECRET_SEARCH_EXCLUDE_GLOBS: readonly string[] = [
  '**/.env*',
  '**/*key*',
  '**/*secret*',
  '**/*credential*',
  '**/*token*',
  '**/*password*',
  '**/dobius-runtime*.json',
  '**/*.pem',
  '**/*.p12',
  '**/*.pfx',
  '**/*.keystore',
  '**/id_rsa*',
  '**/id_dsa*',
  '**/id_ecdsa*',
  '**/id_ed25519*',
  '**/.netrc',
  '**/.npmrc',
  '**/.pgpass',
  ...[...SECRET_DIRECTORY_NAMES].map((name) => `**/${name}/**`)
]

export function segmentsOf(relativePath: string): string[] {
  return relativePath.replaceAll('\\', '/').split('/')
}

export function isSecretLookingPath(relativePath: string): boolean {
  const segments = segmentsOf(relativePath).map((segment) => foldSecretName(segment.trim()))
  const name = segments.at(-1) ?? ''
  if (SECRET_FILE_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return true
  }
  return segments.some((segment) => SECRET_DIRECTORY_NAMES.has(segment))
}

