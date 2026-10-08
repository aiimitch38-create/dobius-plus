import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { DESKTOP_SCREEN_CAPABILITY } from '../../../src/shared/desktop-screen-protocol'
import DesktopScreen from '../../app/h/[hostId]/desktop'
import { desktopViewStore } from './desktop-view-store'

const mocks = vi.hoisted(() => ({
  dimensions: { width: 390, height: 844 },
  router: { back: vi.fn() },
  client: null as unknown
}))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    Image: React.forwardRef((_props: unknown, ref: React.ForwardedRef<unknown>) => {
      React.useImperativeHandle(ref, () => ({ setNativeProps: vi.fn() }))
      return React.createElement('NativeImage')
    }),
    Pressable: 'Pressable',
    StatusBar: 'StatusBar',
    StyleSheet: {
      create: (styles: unknown) => styles
    },
    Text: 'Text',
    View: 'View',
    useWindowDimensions: () => mocks.dimensions
  }
})

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 })
}))

vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    useFocusEffect: (effect: () => void | (() => void)) => React.useEffect(effect, [effect]),
    useLocalSearchParams: () => ({ hostId: 'host-a' }),
    useRouter: () => mocks.router
  }
})

vi.mock('react-native-gesture-handler', () => {
  const gesture = () => ({
    onEnd() {
      return this
    },
    onUpdate() {
      return this
    }
  })
  return {
    Gesture: { Pan: gesture, Pinch: gesture, Simultaneous: () => ({}) },
    GestureDetector: 'GestureDetector'
  }
})

vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView' },
  useAnimatedStyle: () => ({}),
  useSharedValue: (value: number) => ({ value })
}))

vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft', Monitor: 'Monitor' }))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: mocks.client, state: 'connected' })
}))

let activeRenderer: ReactTestRenderer | null = null

function fixture() {
  let event!: (value: unknown) => void
  let frame!: NonNullable<Parameters<RpcClient['subscribe']>[3]>['onDesktopFrame']
  const unsubscribe = vi.fn()
  const sendRequest = vi.fn(async (method: string) => ({
    id: 'req',
    ok: true as const,
    result:
      method === 'status.get'
        ? { capabilities: [DESKTOP_SCREEN_CAPABILITY] }
        : { supported: true, permission: 'granted' }
  }))
  const subscribe = vi.fn(
    (
      _method: string,
      _params: unknown,
      onEvent: (value: unknown) => void,
      options: Parameters<RpcClient['subscribe']>[3]
    ) => {
      event = onEvent
      frame = options?.onDesktopFrame
      return unsubscribe
    }
  )
  const client = {
    onStateChange: vi.fn(() => () => {}),
    getState: () => 'connected',
    sendRequest,
    subscribe
  } as unknown as RpcClient
  const ready = {
    type: 'ready',
    subscriptionId: '00000000-0000-4000-8000-000000000001',
    generation: '00000000-0000-4000-8000-000000000002',
    displayId: 7,
    width: 1280,
    height: 800
  }
  mocks.client = client
  return {
    sendRequest,
    unsubscribe,
    ready,
    start: async () => {
      await act(async () => {
        await desktopViewStore.start()
      })
      act(() => {
        event(ready)
        frame!({
          ...ready,
          sequence: 1,
          image: new Uint8Array([255, 216, 1, 255, 217])
        })
      })
    }
  }
}

function textContent(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType('Text')
    .flatMap((node) => node.props.children)
    .filter((child): child is string => typeof child === 'string')
    .join(' ')
}

afterEach(() => {
  if (activeRenderer) {
    act(() => activeRenderer?.unmount())
    activeRenderer = null
  }
  mocks.dimensions.width = 390
  mocks.dimensions.height = 844
  mocks.router.back.mockReset()
  mocks.client = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('desktop mirror route layout and Back cleanup', () => {
  it.each([
    { name: 'portrait', width: 390, height: 844, backLabel: 'Back' },
    {
      name: 'landscape',
      width: 844,
      height: 390,
      backLabel: 'Back from full-screen mirror'
    }
  ])('renders $name layout and stops the active stream from its Back control', async (layout) => {
    vi.useFakeTimers()
    const f = fixture()
    mocks.dimensions.width = layout.width
    mocks.dimensions.height = layout.height

    act(() => {
      activeRenderer = create(createElement(DesktopScreen))
    })
    const renderer = activeRenderer
    if (!renderer) {
      throw new Error('DesktopScreen did not render')
    }

    const safeArea = renderer.root.findByType('SafeAreaView')
    const statusBar = renderer.root.findByType('StatusBar')
    const back = renderer.root.findByProps({ accessibilityLabel: layout.backLabel })
    if (layout.name === 'portrait') {
      expect(safeArea.props.edges).toBeUndefined()
      expect(statusBar.props.hidden).toBe(false)
      expect(textContent(renderer)).toContain('Desktop')
      expect(textContent(renderer)).toContain('Float')
    } else {
      expect(safeArea.props.edges).toEqual([])
      expect(statusBar.props.hidden).toBe(true)
      expect(textContent(renderer)).not.toContain('Desktop')
      expect(textContent(renderer)).not.toContain('Float')
      expect(textContent(renderer)).toContain('View my screen')
      expect(textContent(renderer)).not.toContain('Stop viewing')
      expect(back.props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ top: 36 })])
      )
    }

    await f.start()
    expect(renderer.root.findByType('NativeImage')).toBeTruthy()
    expect(desktopViewStore.getSnapshot().image).not.toBeNull()

    act(() => back.props.onPress())
    expect(mocks.router.back).toHaveBeenCalledOnce()

    // Back navigates away; the route's focus cleanup runs as the screen unmounts.
    act(() => renderer.unmount())
    activeRenderer = null

    expect(f.unsubscribe).toHaveBeenCalledOnce()
    expect(desktopViewStore.getSnapshot().image).toBeNull()
    expect(desktopViewStore.getSnapshot().badge).toBe('Paused')
    const renewalsAtExit = f.sendRequest.mock.calls.filter(
      ([method]) => method === 'screen.lease.renew'
    ).length
    act(() => vi.advanceTimersByTime(30000))
    expect(
      f.sendRequest.mock.calls.filter(([method]) => method === 'screen.lease.renew')
    ).toHaveLength(renewalsAtExit)
  })
})
