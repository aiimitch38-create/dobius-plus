import { useMemo } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft, RefreshCw } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import { useHostClient } from '../transport/client-context'
import { colors, spacing } from '../theme/mobile-theme'
import { useMobileDataCatalog } from './use-mobile-data-catalog'
import type { PreviewInvalidationSource } from '../../../src/shared/data-catalog-preview-invalidation'

export function MobileDataCatalogPanel({ hostId }: { hostId: string }) {
  const router = useRouter()
  const { client, state } = useHostClient(hostId)
  const subscribePreviewInvalidations = useMemo<PreviewInvalidationSource | null>(
    () => (client ? (listener) => client.onDataCatalogPreviewInvalidated(listener) : null),
    [client]
  )
  const catalog = useMobileDataCatalog(
    hostId,
    client,
    state === 'connected',
    subscribePreviewInvalidations
  )
  const label = catalog.selectedRoot?.label ?? 'Registered files'
  const connected = state === 'connected'
  const visibleEntries = useMemo(() => catalog.page.entries, [catalog.page.entries])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgBase }} edges={['top', 'bottom']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.borderSubtle
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to files"
          onPress={() => router.back()}
          style={{ padding: spacing.sm, marginRight: spacing.sm }}
        >
          <ChevronLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '600' }}>
            Registered files
          </Text>
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12 }}>
            {label}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh registered folders"
          onPress={() => void catalog.refreshRoots()}
          disabled={!connected || catalog.roots.phase === 'loading'}
          style={{ padding: spacing.sm }}
        >
          <RefreshCw size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
          File names and basic metadata only. Original files stay in their folders; backup coverage
          is unknown.
        </Text>
        {catalog.roots.phase === 'loading' ? (
          <StatusText>Loading registered folders…</StatusText>
        ) : null}
        {catalog.roots.phase === 'idle' || !connected ? (
          <StatusText>Connect to this host to view its registered folders.</StatusText>
        ) : null}
        {catalog.roots.phase === 'denied' ? (
          <StatusText error>This host denied catalog access.</StatusText>
        ) : null}
        {catalog.roots.phase === 'unavailable' ? (
          <StatusText error>
            {catalog.roots.error ?? 'Catalog is unavailable on this host.'}
          </StatusText>
        ) : null}
        {catalog.roots.phase === 'ready' && catalog.roots.roots.length === 0 ? (
          <StatusText>No folders are registered on this host.</StatusText>
        ) : null}

        {catalog.roots.roots.map((root) => {
          const selected = catalog.selectedRoot?.rootId === root.rootId
          return (
            <Pressable
              key={root.rootId}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${root.label}, ${root.kind}`}
              onPress={() => catalog.selectRoot(root.rootId)}
              style={{
                borderWidth: 1,
                borderColor: selected ? colors.textPrimary : colors.borderSubtle,
                borderRadius: 10,
                padding: spacing.md,
                gap: spacing.xs
              }}
            >
              <Text style={{ color: colors.textPrimary, fontSize: 14, fontWeight: '600' }}>
                {root.label}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{root.kind}</Text>
            </Pressable>
          )
        })}

        {catalog.selectedRoot ? (
          <View style={{ gap: spacing.sm }}>
            {catalog.page.phase === 'loading' && catalog.page.entries.length === 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <ActivityIndicator size="small" color={colors.textSecondary} />
                <StatusText>Reading file metadata…</StatusText>
              </View>
            ) : null}
            {catalog.page.phase === 'denied' ? (
              <StatusText error>
                Access to this folder was denied. Refresh the folder list.
              </StatusText>
            ) : null}
            {catalog.page.phase === 'unavailable' ? (
              <View style={{ gap: spacing.sm }}>
                <StatusText error>{catalog.page.error ?? 'Catalog is unavailable.'}</StatusText>
                <ActionButton label="Refresh folder" onPress={() => void catalog.refreshRoot()} />
              </View>
            ) : null}
            {(catalog.page.phase === 'complete' || catalog.page.phase === 'partial') &&
            visibleEntries.length === 0 ? (
              <StatusText>No file metadata is available in this folder.</StatusText>
            ) : null}
            {visibleEntries.map((entry) => (
              <View
                key={entry.entryId}
                style={{
                  borderBottomWidth: 1,
                  borderBottomColor: colors.borderSubtle,
                  paddingVertical: spacing.sm,
                  gap: 3
                }}
              >
                <Text style={{ color: colors.textPrimary, fontSize: 14, fontWeight: '500' }}>
                  {entry.name}
                </Text>
                <Text selectable style={{ color: colors.textSecondary, fontSize: 12 }}>
                  {entry.relativePath}
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                  {entry.kind}
                  {entry.sizeBytes === null ? '' : ` · ${formatBytes(entry.sizeBytes)}`}
                </Text>
                <ActionButton
                  label="Preview text"
                  onPress={() => catalog.previewEntry(entry.entryId)}
                  disabled={
                    catalog.preview.phase === 'loading' ||
                    catalog.previewPolicy?.state !== 'mobile' ||
                    !catalog.previewPolicy.enabled
                  }
                />
              </View>
            ))}
            {catalog.previewPolicy?.state === 'mobile' && !catalog.previewPolicy.enabled ? (
              <StatusText>Text previews are not enabled for this phone on this folder.</StatusText>
            ) : null}
            {catalog.previewPolicy === null ? (
              <StatusText>Checking text-preview permission…</StatusText>
            ) : null}
            {catalog.previewPolicy?.state === 'unavailable' ||
            catalog.previewPolicy?.state === 'denied' ? (
              <StatusText error>Text-preview permission is unavailable for this folder.</StatusText>
            ) : null}
            {catalog.preview.phase === 'loading' ? (
              <StatusText>Loading selected text preview…</StatusText>
            ) : null}
            {catalog.preview.phase === 'failed' ? (
              <StatusText error>{catalog.preview.reason}</StatusText>
            ) : null}
            {catalog.preview.phase === 'visible' ? (
              <View
                accessibilityLabel="Plain text preview"
                style={{
                  borderWidth: 1,
                  borderColor: colors.borderSubtle,
                  borderRadius: 8,
                  padding: spacing.md,
                  gap: spacing.sm
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <StatusText>Plain text preview · clears when you leave this screen</StatusText>
                  <ActionButton label="Close" onPress={() => void catalog.clearPreview()} />
                </View>
                <ScrollView style={{ maxHeight: 360 }} nestedScrollEnabled>
                  <Text
                    selectable
                    style={{ color: colors.textPrimary, fontSize: 13, lineHeight: 19 }}
                  >
                    {catalog.preview.text}
                  </Text>
                </ScrollView>
              </View>
            ) : null}
            {catalog.page.phase === 'partial' ? (
              <StatusText>
                {catalog.page.cursor
                  ? 'This listing is partial. Load the next metadata page to continue.'
                  : 'This listing is partial; the scan limit was reached.'}
              </StatusText>
            ) : catalog.page.phase === 'complete' ? (
              <StatusText>Listing complete.</StatusText>
            ) : null}
            {catalog.page.cursor ? (
              <ActionButton
                label={catalog.page.phase === 'loading' ? 'Loading…' : 'Load more metadata'}
                onPress={() => void catalog.loadMore()}
                disabled={catalog.page.phase === 'loading'}
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function StatusText({ children, error = false }: { children: string; error?: boolean }) {
  return (
    <Text
      accessibilityRole={error ? 'alert' : 'text'}
      style={{
        color: error ? colors.statusRed : colors.textSecondary,
        fontSize: 13,
        lineHeight: 19
      }}
    >
      {children}
    </Text>
  )
}

function ActionButton({
  label,
  onPress,
  disabled = false
}: {
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: colors.borderSubtle,
        borderRadius: 8,
        opacity: disabled ? 0.5 : 1,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm
      }}
    >
      <Text style={{ color: colors.textPrimary, fontSize: 13 }}>{label}</Text>
    </Pressable>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let size = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024
    unit = units[index]
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${unit}`
}
