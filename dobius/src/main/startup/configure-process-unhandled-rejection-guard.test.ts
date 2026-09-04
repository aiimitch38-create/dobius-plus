import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  return {
    app: {
      getPath: vi.fn(() => ''),
      setPath: vi.fn(),
      quit: vi.fn(),
      exit: vi.fn(),
      isPackaged: false,
      disableHardwareAcceleration: vi.fn(),
      commandLine: {
        appendSwitch: vi.fn(),
        getSwitchValue: vi.fn(() => '')
      }
    }
  }
})

describe('installUnhandledRejectionGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs an unhandled rejection instead of letting it crash the process', async () => {
    const { installUnhandledRejectionGuard } = await import('./configure-process')
    const originalOn = process.on.bind(process)
    let handler: ((reason: unknown) => void) | null = null
    vi.spyOn(process, 'on').mockImplementation(((event, listener) => {
      if (event === 'unhandledRejection') {
        handler = listener as (reason: unknown) => void
        return process
      }
      return originalOn(event, listener)
    }) as typeof process.on)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    installUnhandledRejectionGuard()

    const reason = new Error('SDK retry failed')
    expect(() => handler?.(reason)).not.toThrow()
    expect(errorSpy).toHaveBeenCalledWith(
      '[main] Unhandled promise rejection (recovered):',
      reason
    )
  })
})
