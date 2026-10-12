import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Monitor } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
export function DesktopHostButton({
  disabled,
  onPress,
  compact = false
}: {
  disabled: boolean
  onPress(): void
  compact?: boolean
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Desktop — View my screen"
      disabled={disabled}
      onPress={onPress}
      style={[compact ? styles.compact : styles.host, disabled && styles.disabled]}
    >
      <Text style={styles.label}>Desktop</Text>
    </Pressable>
  )
}
export function DesktopQuickAction({ hostId }: { hostId?: string }): React.JSX.Element {
  const router = useRouter()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Desktop — View my screen"
      disabled={!hostId}
      style={({ pressed }) => [styles.quick, !hostId && styles.disabled, pressed && styles.pressed]}
      onPress={() => {
        if (hostId) {
          router.push(`/h/${hostId}/desktop`)
        }
      }}
    >
      <View style={styles.icon}>
        <Monitor size={16} color={colors.textSecondary} />
      </View>
      <Text style={styles.label}>Desktop</Text>
    </Pressable>
  )
}
const styles = StyleSheet.create({
  compact: {
    flex: 1,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button
  },
  host: { padding: spacing.xs },
  label: { color: colors.textSecondary, fontSize: typography.metaSize },
  quick: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.card,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    gap: spacing.sm + 2
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: radii.row,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  disabled: { opacity: 0.45 },
  pressed: { backgroundColor: colors.bgRaised }
})
