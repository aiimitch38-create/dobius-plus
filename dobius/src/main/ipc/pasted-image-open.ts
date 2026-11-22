import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute } from 'node:path'
import { isRegisteredRendererWebContents } from '../window/renderer-window-registry'

// The exact name saveClipboardImageBufferAsTempFile gives a pasted image.
const PASTED_IMAGE_NAME = /^dobius-paste-\d+-[0-9a-f-]{36}\.png$/i

export type PastedImageFs = {
  lstat: (path: string) => Promise<{ isFile: () => boolean; isSymbolicLink: () => boolean }>
  realpath: (path: string) => Promise<string>
}

/**
 * The local file to open for a "Pasted image" chip, or null. The path comes
 * from transcript text, so it must be a regular file (not a symlink) that
 * Dobius itself named, sitting directly in this machine's temp folder. That
 * rules out network (UNC) paths, links to programs, and an SSH pane's remote
 * path, which names a file on the other machine.
 */
export async function resolvePastedImageToOpen(
  pathValue: unknown,
  tempDir: string,
  fs: PastedImageFs = { lstat, realpath }
): Promise<string | null> {
  if (typeof pathValue !== 'string' || !isAbsolute(pathValue) || pathValue.startsWith('\\\\')) {
    return null
  }
  if (!PASTED_IMAGE_NAME.test(basename(pathValue))) {
    return null
  }
  try {
    const info = await fs.lstat(pathValue)
    if (!info.isFile() || info.isSymbolicLink()) {
      return null
    }
    const [realDir, realTemp] = await Promise.all([
      fs.realpath(dirname(pathValue)),
      fs.realpath(tempDir)
    ])
    return realDir === realTemp ? pathValue : null
  } catch {
    // Missing or unreadable: there is nothing to open.
    return null
  }
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const sender = event.sender
  if (typeof sender?.isDestroyed !== 'function' || sender.isDestroyed()) {
    return false
  }
  if (!isRegisteredRendererWebContents(sender)) {
    return false
  }
  return event.senderFrame != null && event.senderFrame.parent === null
}

export function registerPastedImageOpenHandler(): void {
  ipcMain.removeHandler('shell:openPastedImage')
  ipcMain.handle('shell:openPastedImage', async (event, pathValue: unknown): Promise<boolean> => {
    if (!isTrustedSender(event)) {
      return false
    }
    const target = await resolvePastedImageToOpen(pathValue, app.getPath('temp'))
    if (!target) {
      return false
    }
    return (await shell.openPath(target)).length === 0
  })
}
