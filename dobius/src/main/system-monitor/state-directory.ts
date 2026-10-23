import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export function defaultSystemMonitorStateDirectory(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Dobius System Monitor')
  }
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? homedir(), 'Dobius', 'System Monitor')
  }
  const xdg = process.env.XDG_STATE_HOME
  return join(
    xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.local', 'state'),
    'dobius-system-monitor'
  )
}
