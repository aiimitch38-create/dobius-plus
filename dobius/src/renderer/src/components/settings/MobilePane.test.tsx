// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GlobalSettings } from '../../../../shared/types'
import { TooltipProvider } from '../ui/tooltip'

const toastMocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMocks }))

type MockState = {
  settingsSearchQuery: string
  settings: Partial<GlobalSettings> | null
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void>
  recordFeatureInteraction: (id: string) => void
}

const storeState: MockState = {
  settingsSearchQuery: '',
  settings: null,
  updateSettings: vi.fn(async () => undefined),
  recordFeatureInteraction: vi.fn()
}

vi.mock('../../store', () => {
  const useAppStore = (selector: (state: MockState) => unknown) => selector(storeState)
  useAppStore.getState = () => storeState
  return { useAppStore }
})

import { MobilePane } from './MobilePane'

const LISTENER_OFF_TEXT =
  'The phone listener is off, so phones cannot pair or connect. Turn on Phone Listener above, then restart Dobius+.'
const PENDING_RESTART_TEXT =
  'The phone listener is turned on but only starts the next time Dobius+ launches. Restart Dobius+ to pair a phone.'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function installMobileApi(args: { listenerRunning: boolean }) {
  const mobile = {
    listDevices: vi.fn(async () => ({ devices: [] })),
    listNetworkInterfaces: vi.fn(async () => ({
      interfaces: [{ name: 'en0', address: '192.168.1.24' }]
    })),
    isWebSocketReady: vi.fn(async () => ({
      ready: args.listenerRunning,
      endpoint: args.listenerRunning ? 'ws://0.0.0.0:6768' : null
    })),
    getPairingQR: vi.fn(async () => ({ available: false as const })),
    revokeDevice: vi.fn()
  }
  Object.defineProperty(window, 'api', {
    configurable: true,
    writable: true,
    value: { mobile }
  })
  return mobile
}

function renderPane(settings: Partial<GlobalSettings>) {
  storeState.settings = settings
  const user = userEvent.setup()
  render(
    <TooltipProvider>
      <MobilePane />
    </TooltipProvider>
  )
  return { user }
}

async function clickGenerate(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole('button', { name: /Generate QR Code/ })
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
}

describe('MobilePane with the phone listener off', () => {
  it('explains the listener is off instead of showing a raw error toast', async () => {
    const mobile = installMobileApi({ listenerRunning: false })
    const { user } = renderPane({ mobileListenerEnabled: false })

    expect(await screen.findByText(LISTENER_OFF_TEXT)).toBeInTheDocument()

    await clickGenerate(user)
    await waitFor(() => expect(mobile.getPairingQR).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mobile.isWebSocketReady).toHaveBeenCalledTimes(2))
    expect(toastMocks.error).not.toHaveBeenCalled()
    expect(screen.getByText(LISTENER_OFF_TEXT)).toBeInTheDocument()
  })

  it('says a restart is needed when the setting is on but the listener is not running yet', async () => {
    installMobileApi({ listenerRunning: false })
    renderPane({ mobileListenerEnabled: true })

    expect(await screen.findByText(PENDING_RESTART_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(LISTENER_OFF_TEXT)).not.toBeInTheDocument()
  })

  it('shows no listener notice and keeps the error toast when the listener is running', async () => {
    const mobile = installMobileApi({ listenerRunning: true })
    const { user } = renderPane({ mobileListenerEnabled: true })

    await clickGenerate(user)
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledTimes(1))
    expect(mobile.getPairingQR).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(LISTENER_OFF_TEXT)).not.toBeInTheDocument()
    expect(screen.queryByText(PENDING_RESTART_TEXT)).not.toBeInTheDocument()
  })
})
