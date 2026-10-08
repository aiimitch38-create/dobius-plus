import { Buffer } from 'buffer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { ChevronLeft, Monitor } from 'lucide-react-native'
import { useHostClient } from '../../../src/transport/client-context'
import {
  DesktopViewController,
  type DesktopBadge
} from '../../../src/desktop/desktop-view-controller'
import { colors, radii, spacing, typography } from '../../../src/theme/mobile-theme'

type ImageState = { uri: string; width: number; height: number; sequence: number }
export default function DesktopScreen(): React.JSX.Element {
  const { hostId } = useLocalSearchParams<{ hostId: string }>()
  const router = useRouter()
  const { client, state } = useHostClient(hostId)
  const focused = useRef(false)
  const active = useRef(AppState.currentState === 'active')
  const controller = useRef<DesktopViewController | null>(null)
  const nativeImage = useRef<Image>(null)
  const [image, setImage] = useState<ImageState | null>(null)
  const [badge, setBadge] = useState<DesktopBadge>('Paused')
  const [message, setMessage] = useState<string | null>(
    'Tap View my screen to request viewing, then approve your phone on the Mac.'
  )
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)
  const clear = useCallback(() => {
    nativeImage.current?.setNativeProps({ source: [] })
    setImage(null)
    scale.value = 1
    savedScale.value = 1
    x.value = 0
    y.value = 0
    savedX.value = 0
    savedY.value = 0
  }, [scale, savedScale, x, y, savedX, savedY])
  useFocusEffect(
    useCallback(() => {
      focused.current = true
      if (client) {
        controller.current = new DesktopViewController(client, {
          visible: () => focused.current && active.current,
          clear,
          badge: setBadge,
          message: setMessage,
          frame: (frame) =>
            setImage({
              uri: `data:image/jpeg;base64,${Buffer.from(frame.image).toString('base64')}`,
              width: frame.width,
              height: frame.height,
              sequence: frame.sequence
            })
        })
      }
      return () => {
        focused.current = false
        controller.current?.stop('Paused')
        controller.current = null
        clear()
      }
    }, [client, clear, hostId])
  )
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      active.current = next === 'active'
      if (!active.current) {
        controller.current?.stop('Paused')
      }
    })
    return () => subscription.remove()
  }, [])
  useEffect(() => {
    if (state !== 'connected') {
      controller.current?.stop('Reconnecting')
    }
  }, [state])
  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(6, Math.max(1, savedScale.value * event.scale))
    })
    .onEnd(() => {
      savedScale.value = scale.value
    })
  const pan = Gesture.Pan()
    .onUpdate((event) => {
      x.value = Math.min(1280, Math.max(-1280, savedX.value + event.translationX))
      y.value = Math.min(1280, Math.max(-1280, savedY.value + event.translationY))
    })
    .onEnd(() => {
      savedX.value = x.value
      savedY.value = y.value
    })
  const transform = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }]
  }))
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
        >
          <ChevronLeft color={colors.textPrimary} size={24} />
        </Pressable>
        <Monitor color={colors.textSecondary} size={18} />
        <Text style={styles.title}>Desktop</Text>
        <Text style={styles.badge}>{badge}</Text>
      </View>
      <View style={styles.viewport}>
        {image ? (
          <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
            <Animated.View style={[styles.image, transform]}>
              <Image
                key={image.sequence}
                ref={nativeImage}
                source={{ uri: image.uri, cache: 'reload' }}
                resizeMode="contain"
                style={styles.image}
                onLoad={() => controller.current?.imageLoaded(image.sequence)}
                onError={() => {
                  controller.current?.stop()
                  setMessage('Screen image could not load. Tap View my screen to try again.')
                }}
              />
            </Animated.View>
          </GestureDetector>
        ) : (
          <Text style={styles.hint}>
            Your Mac’s main screen appears here after you approve viewing.
          </Text>
        )}
      </View>
      {message ? (
        <Text style={styles.message}>{message}</Text>
      ) : (
        <Text style={styles.message}>
          Pinch to zoom · Drag to pan · Stop on the Mac ends viewing
        </Text>
      )}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={state !== 'connected'}
          style={[styles.button, state !== 'connected' && styles.disabled]}
          onPress={() => void controller.current?.start()}
        >
          <Text style={styles.buttonText}>View my screen</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => controller.current?.stop()}
        >
          <Text style={styles.buttonText}>Stop viewing</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgBase },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  title: { color: colors.textPrimary, fontSize: typography.titleSize, flex: 1 },
  badge: { color: colors.textSecondary, fontSize: typography.metaSize },
  viewport: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.bgPanel,
    justifyContent: 'center',
    alignItems: 'center'
  },
  image: { width: '100%', height: '100%' },
  hint: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    textAlign: 'center',
    padding: spacing.xl
  },
  message: { color: colors.textSecondary, fontSize: typography.metaSize, padding: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg },
  button: { padding: spacing.md, borderRadius: radii.button, backgroundColor: colors.bgRaised },
  buttonText: { color: colors.textPrimary, fontSize: typography.bodySize },
  disabled: { opacity: 0.5 }
})
