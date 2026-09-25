// Why: on macOS the Claude OAuth token (and git/gh tokens) live in the login
// keychain, and the sandbox must keep the SecurityServer reachable for git's
// credential helper. `security find-*-password -w` would print them, so the
// secret-printing subcommands are refused by text.
const KEYCHAIN_SECRET_COMMAND =
  /(?:^|[\s;&|`(){}!]|\/)security['"]?\s+(?:-\S+\s+)*['"]?(?:find-generic-password|find-internet-password|dump-keychain|export)\b/

export function readsKeychainSecret(command: string): boolean {
  return KEYCHAIN_SECRET_COMMAND.test(command)
}
