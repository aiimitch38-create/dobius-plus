import { randomBytes } from 'node:crypto'
import { BrowserWindow, screen } from 'electron'
import { DesktopScreenError } from '../../../shared/desktop-screen-errors'

function escaped(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  )
}

export async function showScreenViewingBanner(
  name: string,
  stop: () => void,
  signal: AbortSignal
): Promise<() => void> {
  if (signal.aborted) {
    throw new DesktopScreenError('screen_not_authorized')
  }
  const area = screen.getPrimaryDisplay().workArea
  const width = Math.min(560, area.width - 32)
  const win = new BrowserWindow({
    width,
    height: 72,
    x: Math.round(area.x + (area.width - width) / 2),
    y: area.y + 12,
    show: false,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    title: 'Phone screen viewing',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: false
    }
  })
  win.setMenu(null)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (url.startsWith('dobius-screen-stop://')) {
      stop()
    }
  })
  win.once('closed', stop)
  win.on('hide', stop)
  win.webContents.once('render-process-gone', stop)
  const hide = (): void => {
    signal.removeEventListener('abort', hide)
    if (!win.isDestroyed()) {
      win.destroy()
    }
  }
  signal.addEventListener('abort', hide, { once: true })
  const nonce = randomBytes(16).toString('base64')
  // A sandboxed local status surface uses the documented light/dark tokens, without any preload or RPC bridge.
  const html = `<!doctype html><html><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
  <style>:root{--background:#fff;--foreground:#0a0a0a;--primary:#171717;--primary-foreground:#fafafa;--border:#e5e5e5;--radius:.625rem}
  @media(prefers-color-scheme:dark){:root{--background:#0a0a0a;--foreground:#fafafa;--primary:#e5e5e5;--primary-foreground:#171717;--border:rgb(255 255 255 / .07)}}
  body{margin:0;padding:12px 16px;font:12px/1.5 system-ui;background:var(--background);color:var(--foreground);display:flex;align-items:center;gap:12px}
  p{margin:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  button{font:inherit;background:var(--primary);color:var(--primary-foreground);border:1px solid var(--border);border-radius:var(--radius);padding:6px 16px;cursor:pointer}</style></head>
  <body><p title="${escaped(name)}">📱 ${escaped(name)} is viewing your screen</p><button id="stop" type="button">Stop</button>
  <script nonce="${nonce}">document.getElementById('stop').addEventListener('click',()=>{location.href='dobius-screen-stop://local'})</script></body></html>`
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    if (signal.aborted || win.isDestroyed()) {
      throw new DesktopScreenError('screen_not_authorized')
    }
    win.showInactive()
    return hide
  } catch (error) {
    hide()
    throw error
  }
}
