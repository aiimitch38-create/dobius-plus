import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { desktopViewStore, useDesktopViewSnapshot } from './desktop-view-store'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

const LABEL_HEIGHT = 28
const MARGIN = spacing.sm

export function DesktopFloatingWidget(): React.JSX.Element | null {
  const snapshot = useDesktopViewSnapshot()
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    const host = pathname.match(/^\/h\/([^/]+)/)?.[1]
    if (host) {
      desktopViewStore.routeChanged(decodeURIComponent(host))
    }
  }, [pathname])
  const insets = useSafeAreaInsets()
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  const imageRef = useRef<Image>(null)
  const initialized = useRef(false)
  const widgetWidth = Math.max(120, Math.min(screenWidth * 0.35, 220))
  const ratio = snapshot.image ? snapshot.image.height / Math.max(1, snapshot.image.width) : 0.625
  const widgetHeight = widgetWidth * ratio + LABEL_HEIGHT
  const x = useSharedValue(Math.max(MARGIN, screenWidth - widgetWidth - MARGIN))
  const y = useSharedValue(insets.top + MARGIN)
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)

  useEffect(() => {
    desktopViewStore.setAppActive(AppState.currentState === 'active')
    const subscription = AppState.addEventListener('change', (state) => {
      desktopViewStore.setAppActive(state === 'active')
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    const left = MARGIN
    const right = Math.max(left, screenWidth - widgetWidth - MARGIN)
    const top = insets.top + MARGIN
    const bottom = Math.max(top, screenHeight - insets.bottom - widgetHeight - MARGIN)
    if (!initialized.current) {
      x.value = right
      y.value = top
      initialized.current = true
      return
    }
    x.value = Math.min(right, Math.max(left, x.value))
    y.value = Math.min(bottom, Math.max(top, y.value))
  }, [insets.bottom, insets.top, screenHeight, screenWidth, widgetHeight, widgetWidth, x, y])

  useLayoutEffect(
    () =>
      desktopViewStore.onClear(() => {
        imageRef.current?.setNativeProps({ source: [] })
      }),
    []
  )

  const pan = Gesture.Pan()
    .minDistance(8)
    .onBegin(() => {
      startX.value = x.value
      startY.value = y.value
    })
    .onUpdate((event) => {
      const maxX = Math.max(MARGIN, screenWidth - widgetWidth - MARGIN)
      const maxY = Math.max(
        insets.top + MARGIN,
        screenHeight - insets.bottom - widgetHeight - MARGIN
      )
      x.value = Math.min(maxX, Math.max(MARGIN, startX.value + event.translationX))
      y.value = Math.min(maxY, Math.max(insets.top + MARGIN, startY.value + event.translationY))
    })
    .onEnd(() => {
      const left = x.value + widgetWidth / 2 < screenWidth / 2
      const top = y.value + widgetHeight / 2 < screenHeight / 2
      x.value = left ? MARGIN : Math.max(MARGIN, screenWidth - widgetWidth - MARGIN)
      y.value = top
        ? insets.top + MARGIN
        : Math.max(insets.top + MARGIN, screenHeight - insets.bottom - widgetHeight - MARGIN)
    })

  const animatedStyle = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    width: widgetWidth,
    height: widgetHeight
  }))

  if (!snapshot.widgetVisible || !snapshot.hostId) {
    return null
  }
  const badge = snapshot.badge === 'Paused' ? 'Stopped' : snapshot.badge

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.widget, animatedStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open full screen mirror"
          style={styles.body}
          onPress={() => {
            const hostId = snapshot.hostId
            if (!hostId) {
              return
            }
            desktopViewStore.handoffWidgetToPage(hostId)
            router.push({ pathname: '/h/[hostId]/desktop', params: { hostId } })
          }}
        >
          <View style={styles.label}>
            <Text style={styles.badge} numberOfLines={1}>
              {badge}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close floating screen mirror"
              hitSlop={8}
              onPress={() => desktopViewStore.dismissWidget()}
              style={styles.close}
            >
              <X color={colors.textPrimary} size={14} />
            </Pressable>
          </View>
          <View style={[styles.preview, { height: widgetHeight - LABEL_HEIGHT }]}>
            {snapshot.image ? (
              <Image
                ref={imageRef}
                source={{ uri: snapshot.image.uri, cache: 'reload' }}
                resizeMode="contain"
                style={styles.image}
                onLoad={() => snapshot.image && desktopViewStore.imageLoaded(snapshot.image)}
                onError={() => desktopViewStore.stop()}
              />
            ) : (
              <Text style={styles.placeholder}>{badge}</Text>
            )}
          </View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  widget: {
    position: 'absolute',
    zIndex: 1000,
    overflow: 'hidden',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    shadowColor: colors.bgBase,
    shadowOpacity: 0.35,
    shadowRadius: spacing.md,
    elevation: 12
  },
  body: { flex: 1 },
  label: {
    height: LABEL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    backgroundColor: colors.bgRaised
  },
  badge: { color: colors.textPrimary, fontSize: typography.metaSize, flex: 1 },
  close: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  preview: {
    width: '100%',
    backgroundColor: colors.bgBase,
    alignItems: 'center',
    justifyContent: 'center'
  },
  image: { width: '100%', height: '100%' },
  placeholder: { color: colors.textSecondary, fontSize: typography.metaSize }
})
