// Shell text transforms shared by the agent hard rails: literal heredoc bodies
// and the inner command of `sh -c '<string>'`.

const QUOTED_CAT_HEREDOC =
  /\bcat[ \t]+<<-?[ \t]*(['"])([A-Za-z_][\w-]*)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|\)|$)/g
const EMPTIED_HEREDOC_SUBSTITUTION =
  /\$\([ \t]*cat[ \t]+<<-?[ \t]*(['"])([A-Za-z_][\w-]*)\1[ \t]*\n[ \t]*\2[ \t]*\n?[ \t]*\)/g

/**
 * Why (CX12 F5): `git commit -m "$(cat <<'EOF' ... EOF)"` is Claude Code's
 * standard commit/PR pattern. With a quoted delimiter the body is literal text
 * the shell never expands, so it is removed before the expansion and git rails
 * look at the command. A body piped on (`cat <<'EOF' | bash`) is kept.
 */
export function stripLiteralHeredocs(command: string): string {
  return command
    .replace(QUOTED_CAT_HEREDOC, (match, quote: string, tag: string, rest: string) =>
      rest.includes('|') ? match : `cat <<${quote}${tag}${quote}${rest}\n${tag}`
    )
    .replace(EMPTIED_HEREDOC_SUBSTITUTION, 'HEREDOC')
}

// `bash -c '...'`, `env sh -c "..."`, `xargs zsh -lc '...'`, `/bin/dash -c ...`.
const SHELL_C =
  /(?:^|[\s;&|(`])(?:\S*\/)?(?:ba|z|da|k|fi)?sh[ \t]+(?:-[A-Za-z]+[ \t]+)*-[A-Za-z]*c[A-Za-z]*[ \t]+(?:'([^']*)'|"((?:[^"\\]|\\.)*)"|([^\s;&|'"]+))/g

/** Inner command strings run by `sh|bash|zsh|dash|ksh -c` anywhere in `command`. */
export function shellCInnerCommands(command: string): string[] {
  return [...command.matchAll(SHELL_C)].map(
    ([, single, double, bare]) => single ?? double?.replace(/\\(["\\$`])/g, '$1') ?? bare ?? ''
  )
}
