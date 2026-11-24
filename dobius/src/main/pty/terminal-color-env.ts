export function removeInheritedNoColor(env: Record<string, string>): void {
  // Why: Dobius can be launched by agent/dev shells that disable color for their
  // own logs. A terminal emulator should not inherit that parent-only choice;
  // if the user's login shell exports these, startup files can still set them.
  delete env.NO_COLOR
  if (env.FORCE_COLOR === '0') {
    delete env.FORCE_COLOR
  }
  if (env.CLICOLOR === '0') {
    delete env.CLICOLOR
  }
  // Why: a Dobius terminal used to export FORCE_HYPERLINK=1, so a Dobius
  // launched from one would hand it on; forced OSC 8 leaks xterm link markers.
  delete env.FORCE_HYPERLINK
}
