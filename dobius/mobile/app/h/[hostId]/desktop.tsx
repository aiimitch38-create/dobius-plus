import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { ChevronLeft, Monitor } from 'lucide-react-native'
import { useHostClient } from '../../../src/transport/client-context'
import { desktopViewStore, useDesktopViewSnapshot } from '../../../src/desktop/desktop-view-store'
import { colors, radii, spacing, typography } from '../../../src/theme/mobile-theme'

export default function DesktopScreen(): React.JSX.Element {
  const { hostId } = useLocalSearchParams<{ hostId: string }>()
  const router = useRouter()
  const { client, state } = useHostClient(hostId)
  const nativeImage = useRef<Image>(null)
  const { image, badge, message } = useDesktopViewSnapshot()
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)
  const clearGesture = useCallback(() => {
    nativeImage.current?.setNativeProps({ source: [] })
    scale.value = 1
    savedScale.value = 1
    x.value = 0
    y.value = 0
    savedX.value = 0
    savedY.value = 0
  }, [scale, savedScale, x, y, savedX, savedY])
  useFocusEffect(
    useCallback(() => {
      if (client) {
        desktopViewStore.enterPage(hostId, client)
      }
      return () => {
        desktopViewStore.leavePage(hostId)
      }
    }, [client, hostId])
  )
  useEffect(() => {
    if (state !== 'connected') {
      desktopViewStore.setConnectionState(hostId, state)
    }
  }, [hostId, state])
  useLayoutEffect(
    () =>
      desktopViewStore.onClear(() => {
        nativeImage.current?.setNativeProps({ source: [] })
        clearGesture()
      }),
    [clearGesture]
  )
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
                ref={nativeImage}
                source={{ uri: image.uri, cache: 'reload' }}
                resizeMode="contain"
                style={styles.image}
                onLoad={() => desktopViewStore.imageLoaded(image)}
                onError={() => {
                  desktopViewStore.stop()
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
          onPress={() => void desktopViewStore.start()}
        >
          <Text style={styles.buttonText}>View my screen</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => desktopViewStore.stop()}
        >
          <Text style={styles.buttonText}>Stop viewing</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => {
            desktopViewStore.showWidget()
            router.back()
          }}
        >
          <Text style={styles.buttonText}>Float</Text>
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
