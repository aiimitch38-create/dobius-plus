// The ONE place in this slice where a raw private key is allowed to be
// displayed or typed by a human. Both flows (`get_nsec` reveal and
// `import_identity` entry) happen inside a small, ephemeral, main-process-
// owned BrowserWindow — never inside the vendored Buzz webview.
//
// Why nodeIntegration is on for this window specifically: the page it loads
// is a `data:` URL built entirely from a fixed template string this module
// owns, never fetched from the network or from vendor/buzz-desktop. There is
// no untrusted content for a compromised webview to inject here — the
// "renderer can't hold the key" threat model this whole slice defends
// against is specifically about the Buzz webview's JS context, which this
// window is completely separate from (its own BrowserWindow, its own
// process, destroyed immediately after use). See KEY_SAFETY in the build
// report for the full reasoning.
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function createEphemeralWindow(title: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 360,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webviewTag: false
    }
  })
  win.setMenuBarVisibility(false)
  // Why: this window only ever shows a page we authored ourselves; deny any
  // attempt to navigate away from or pop out of that page.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  return win
}

const REVEAL_DONE_CHANNEL = 'dobius-secure-key-entry:reveal-done'

/**
 * Shows `nsecBech32` in a trusted, main-owned window for the user to read or
 * copy. Resolves once the window is closed. The value never crosses into
 * any IPC reply or the Buzz webview.
 */
export function revealNsecInSecureWindow(nsecBech32: string, pubkeyHex: string): Promise<void> {
  return new Promise((resolve) => {
    const win = createEphemeralWindow('Reveal Communications Private Key')
    const channel = `${REVEAL_DONE_CHANNEL}:${win.webContents.id}`

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font: 13px -apple-system, sans-serif; padding: 16px; background: #16181d; color: #e6e8ec; }
  h2 { font-size: 14px; margin: 0 0 8px; }
  p { color: #9aa0aa; margin: 0 0 12px; }
  textarea { width: 100%; height: 72px; box-sizing: border-box; font-family: monospace; font-size: 12px;
    background: #0d0f13; color: #e6e8ec; border: 1px solid #2a2e37; border-radius: 6px; padding: 8px; resize: none; }
  .pubkey { font-family: monospace; font-size: 11px; color: #6f7480; word-break: break-all; margin-top: 8px; }
  button { margin-top: 14px; padding: 8px 14px; border-radius: 6px; border: none; cursor: pointer;
    background: #3b6ef2; color: white; font-size: 13px; }
  button.secondary { background: #2a2e37; color: #e6e8ec; margin-right: 8px; }
</style></head>
<body>
  <h2>Your Communications private key</h2>
  <p>Anyone with this key can post as you. Copy it somewhere safe, then close this window.</p>
  <textarea id="nsec" readonly>${escapeHtml(nsecBech32)}</textarea>
  <div class="pubkey">pubkey: ${escapeHtml(pubkeyHex)}</div>
  <div>
    <button class="secondary" id="copy">Copy to clipboard</button>
    <button id="done">Done</button>
  </div>
  <script>
    const { clipboard, ipcRenderer } = require('electron')
    document.getElementById('copy').addEventListener('click', () => {
      clipboard.writeText(document.getElementById('nsec').value)
    })
    document.getElementById('done').addEventListener('click', () => {
      ipcRenderer.send(${JSON.stringify(channel)})
      window.close()
    })
  </script>
</body></html>`

    // Why: ipcMain listens for messages from EVERY renderer in the app, not
    // only this ephemeral window — without this check, any other renderer
    // (including the Communications webview this window exists to keep keys
    // away from) could send on this channel and race/forge the "done" signal.
    const expectedSenderId = win.webContents.id
    let settled = false
    const finishFromWindow = (event: IpcMainEvent): void => {
      if (event.sender.id !== expectedSenderId) {return}
      finish()
    }
    const finish = (): void => {
      if (settled) {return}
      settled = true
      ipcMain.removeListener(channel, finishFromWindow)
      resolve()
    }

    ipcMain.on(channel, finishFromWindow)
    win.on('closed', finish)
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  })
}

const IMPORT_SUBMIT_CHANNEL = 'dobius-secure-key-entry:import-submit'
const IMPORT_CANCEL_CHANNEL = 'dobius-secure-key-entry:import-cancel'

export type SecureImportResult =
  | { cancelled: true }
  | { cancelled: false; input: string; password: string }

/**
 * Opens a trusted, main-owned window that collects an nsec (or an ncryptsec
 * backup + its password) directly from the user. The typed value is sent to
 * main over a private, per-window IPC channel that only this ephemeral
 * window's own inline script can reach — it is never routed through the
 * Buzz webview or any shared IPC surface.
 */
export function promptForIdentityImport(): Promise<SecureImportResult> {
  return new Promise((resolve) => {
    const win = createEphemeralWindow('Import Communications Identity')
    const submitChannel = `${IMPORT_SUBMIT_CHANNEL}:${win.webContents.id}`
    const cancelChannel = `${IMPORT_CANCEL_CHANNEL}:${win.webContents.id}`

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font: 13px -apple-system, sans-serif; padding: 16px; background: #16181d; color: #e6e8ec; }
  h2 { font-size: 14px; margin: 0 0 8px; }
  p { color: #9aa0aa; margin: 0 0 12px; }
  label { display: block; font-size: 12px; color: #9aa0aa; margin: 10px 0 4px; }
  textarea, input { width: 100%; box-sizing: border-box; font-family: monospace; font-size: 12px;
    background: #0d0f13; color: #e6e8ec; border: 1px solid #2a2e37; border-radius: 6px; padding: 8px; }
  textarea { height: 64px; resize: none; }
  button { margin-top: 16px; padding: 8px 14px; border-radius: 6px; border: none; cursor: pointer;
    background: #3b6ef2; color: white; font-size: 13px; }
  button.secondary { background: #2a2e37; color: #e6e8ec; margin-right: 8px; }
</style></head>
<body>
  <h2>Import a Communications identity</h2>
  <p>Paste an <code>nsec1...</code> key, or an <code>ncryptsec1...</code> backup with its password.</p>
  <label for="input">nsec or ncryptsec</label>
  <textarea id="input" placeholder="nsec1... or ncryptsec1..."></textarea>
  <label for="password">Password (only needed for an ncryptsec backup)</label>
  <input id="password" type="password" />
  <div>
    <button class="secondary" id="cancel">Cancel</button>
    <button id="submit">Import</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron')
    document.getElementById('cancel').addEventListener('click', () => {
      ipcRenderer.send(${JSON.stringify(cancelChannel)})
      window.close()
    })
    document.getElementById('submit').addEventListener('click', () => {
      const input = document.getElementById('input').value.trim()
      const password = document.getElementById('password').value
      if (!input) return
      ipcRenderer.send(${JSON.stringify(submitChannel)}, { input, password })
      window.close()
    })
  </script>
</body></html>`

    // Why: same sender-verification rationale as revealNsecInSecureWindow —
    // ipcMain would otherwise accept a submit/cancel from ANY renderer,
    // letting the Communications webview inject a key or race the real
    // window's submit. See the security note in the module header.
    const expectedSenderId = win.webContents.id
    let settled = false
    const isPayloadShapeValid = (value: unknown): value is { input: string; password: unknown } =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Record<string, unknown>).input === 'string' &&
      ((value as Record<string, unknown>).input as string).length > 0

    const onSubmit = (event: IpcMainEvent, payload: unknown): void => {
      if (event.sender.id !== expectedSenderId) {return}
      if (settled) {return}
      if (!isPayloadShapeValid(payload)) {return}
      const password = typeof payload.password === 'string' ? payload.password : ''
      settled = true
      cleanup()
      resolve({ cancelled: false, input: payload.input, password })
    }
    const onCancel = (event: IpcMainEvent): void => {
      if (event.sender.id !== expectedSenderId) {return}
      finishCancelled()
    }
    const onClosed = (): void => {
      finishCancelled()
    }
    const finishCancelled = (): void => {
      if (settled) {return}
      settled = true
      cleanup()
      resolve({ cancelled: true })
    }
    function cleanup(): void {
      ipcMain.removeListener(submitChannel, onSubmit)
      ipcMain.removeListener(cancelChannel, onCancel)
      win.removeListener('closed', onClosed)
    }

    ipcMain.on(submitChannel, onSubmit)
    ipcMain.on(cancelChannel, onCancel)
    win.on('closed', onClosed)
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  })
}
