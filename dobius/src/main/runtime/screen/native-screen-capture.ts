import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { DesktopScreenError } from '../../../shared/desktop-screen-errors'
import { DESKTOP_SCREEN_MAX_JPEG_BYTES } from '../../../shared/desktop-screen-protocol'
import { resolveMacOSComputerUseExecutablePath } from '../../computer/macos-native-provider-paths'
import type { ScreenCapabilities, ScreenStreamParams } from './screen-contracts'
import type {
  ScreenCaptureBackend,
  ScreenCaptureFrame,
  ScreenProducer
} from './screen-session-service'

class NativeScreenProducer implements ScreenProducer {
  private child?: ChildProcessWithoutNullStreams
  private stopped = false
  private clearBuffer?: () => void
  constructor(
    private readonly executable: string,
    private readonly params: ScreenStreamParams
  ) {}
  start(frame: (frame: ScreenCaptureFrame) => void, failed: () => void): void {
    if (this.stopped) {
      return
    }
    const child = spawn(
      this.executable,
      ['--screen-stream', String(this.params.width), String(this.params.fps)],
      {
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    this.child = child
    let buffer = Buffer.alloc(0)
    this.clearBuffer = () => {
      buffer = Buffer.alloc(0)
    }
    const fail = (): void => {
      if (!this.stopped) {
        this.stop()
        failed()
      }
    }
    child.on('error', fail)
    child.on('close', fail)
    child.stderr.resume() // Never forward native error objects, pixel bytes or exception descriptions.
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.stopped) {
        return
      }
      if (buffer.length + chunk.length > DESKTOP_SCREEN_MAX_JPEG_BYTES + 16 + 65536) {
        fail()
        return
      }
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 16 && !this.stopped) {
        const length = buffer.readUInt32LE(0)
        if (length < 4 || length > DESKTOP_SCREEN_MAX_JPEG_BYTES) {
          fail()
          return
        }
        if (buffer.length < length + 16) {
          break
        }
        const current = buffer.subarray(0, length + 16)
        const image = current.subarray(16)
        buffer = buffer.subarray(length + 16)
        frame({
          displayId: current.readUInt32LE(4),
          width: current.readUInt16LE(8),
          height: current.readUInt16LE(10),
          image
        })
      }
    })
    child.stdout.on('close', () => {
      buffer = Buffer.alloc(0)
    })
  }
  stop(): void {
    this.stopped = true
    this.clearBuffer?.()
    this.clearBuffer = undefined
    this.child?.stdout.removeAllListeners('data')
    this.child?.stdin.destroy()
    this.child?.stdout.destroy()
    this.child?.stderr.destroy()
    this.child?.kill('SIGTERM')
    this.child = undefined
  }
}

export function createNativeScreenCaptureBackend(): ScreenCaptureBackend {
  const executable = process.platform === 'darwin' ? resolveMacOSComputerUseExecutablePath() : null
  return {
    supported: executable !== null,
    status: () =>
      new Promise<ScreenCapabilities>((resolve, reject) => {
        if (!executable) {
          reject(new DesktopScreenError('screen_unsupported'))
          return
        }
        // Own display-only check: never Computer Use's combined Accessibility/status path.
        execFile(
          executable,
          ['--screen-status'],
          { timeout: 15000, maxBuffer: 4096 },
          (error, stdout) => {
            if (error) {
              reject(new DesktopScreenError('screen_unsupported'))
              return
            }
            try {
              const value: unknown = JSON.parse(stdout)
              if (!value || typeof value !== 'object') {
                throw new Error('invalid_status')
              }
              const status = value as Record<string, unknown>
              if (
                typeof status.granted !== 'boolean' ||
                !Number.isInteger(status.id) ||
                !Number.isInteger(status.width) ||
                !Number.isInteger(status.height) ||
                (status.width as number) <= 0 ||
                (status.height as number) <= 0
              ) {
                throw new Error('invalid_status')
              }
              resolve({
                supported: true,
                permission: status.granted ? 'granted' : 'missing',
                maxFps: 10,
                maxWidth: 1280,
                display: {
                  id: status.id as number,
                  width: status.width as number,
                  height: status.height as number
                }
              })
            } catch {
              reject(new DesktopScreenError('screen_unsupported'))
            }
          }
        )
      }),
    create: (params) => {
      if (!executable) {
        throw new DesktopScreenError('screen_unsupported')
      }
      return new NativeScreenProducer(executable, params)
    }
  }
}
