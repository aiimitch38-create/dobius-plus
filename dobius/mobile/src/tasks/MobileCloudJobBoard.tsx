import { useMemo, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useHostClient } from '../transport/client-context'
import { createMobileCloudJobSource } from './mobile-cloud-job-source'
import { MobileSystemMonitorCard } from './MobileSystemMonitorCard'
import { useMobileCloudJobBoard } from './use-mobile-cloud-job-board'
import {
  CLOUD_JOB_LABELS,
  cloudJobBoardNotice,
  type CloudJobReadSource
} from '../../../src/shared/cloud-job-projection'
import type { CloudJob } from '../../../src/shared/cloud-jobs'
import { colors, spacing, radii, typography } from '../theme/mobile-theme'
export function MobileCloudJobBoard({
  hostId,
  onBack,
  source: injected
}: {
  hostId: string
  onBack: () => void
  source?: CloudJobReadSource
}) {
  const { client, state: connection } = useHostClient(hostId)
  const source = useMemo(
    () => injected ?? (client ? createMobileCloudJobSource(hostId, client) : null),
    [injected, hostId, client]
  )
  const { state, refresh } = useMobileCloudJobBoard(source)
  const visible =
    !injected && connection !== 'connected'
      ? { ...state, phase: state.updatedAt === null ? ('offline' as const) : ('stale' as const) }
      : state
  const [selected, setSelected] = useState<{ key: string; id: string } | null>(null)
  const job =
    selected?.key === source?.key
      ? visible.jobs.find((item) => item.id === selected?.id)
      : undefined
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onBack}>
          <Text style={styles.body}>Back to Tasks</Text>
        </Pressable>
        <Text style={styles.title}>Board · Jobs</Text>
        <Pressable
          accessibilityRole="button"
          onPress={refresh}
          disabled={!source || visible.phase === 'loading'}
        >
          <Text style={styles.body}>Refresh</Text>
        </Pressable>
      </View>
      <Text style={styles.meta}>Host {hostId}</Text>
      <MobileSystemMonitorCard hostId={hostId} />
      <ScrollView contentContainerStyle={styles.content}>
        {cloudJobBoardNotice(visible) ? (
          <Text accessibilityRole="text" style={styles.body}>
            {cloudJobBoardNotice(visible)}
          </Text>
        ) : null}
        {visible.error ? <Text style={styles.body}>{visible.error}</Text> : null}
        {visible.phase === 'ready' && !visible.jobs.length ? (
          <Text style={styles.body}>No jobs available to this client.</Text>
        ) : null}
        {job ? (
          <View accessibilityLabel="Job details" style={styles.card}>
            <Pressable accessibilityRole="button" onPress={() => setSelected(null)}>
              <Text style={styles.body}>Close details</Text>
            </Pressable>
            <Text style={styles.title}>{job.title}</Text>
            <Text style={styles.body}>{CLOUD_JOB_LABELS[job.state]}</Text>
            <Text selectable style={styles.meta}>
              Job {job.id} · Task {job.taskId}
            </Text>
            <Text style={styles.meta}>
              Workspace {job.workspaceId} · Target {job.targetDeviceId}
            </Text>
            <Text selectable style={styles.meta}>
              Source {job.sourceRevision}
            </Text>
            <Text style={styles.meta}>
              Recipe {job.recipeId} · Attempts {job.attemptCount} · Version {job.version}
            </Text>
            {job.waitingReason ? <Text style={styles.body}>{job.waitingReason}</Text> : null}
            {job.state === 'needs_review' ? (
              <Text style={styles.body}>Independent verification is required before Done.</Text>
            ) : null}
            {job.state === 'cancelled' ? (
              <Text style={styles.body}>
                Cancellation requested; process cleanup is not confirmed by this record.
              </Text>
            ) : null}
            {job.state === 'interrupted' ? (
              <Text style={styles.body}>Worker reconciliation is required.</Text>
            ) : null}
            {job.outcome ? <Text style={styles.body}>{job.outcome}</Text> : null}
            <Text style={styles.body}>Evidence references</Text>
            {job.evidence.length ? (
              job.evidence.map((entry, i) => (
                <Text selectable style={styles.meta} key={i}>
                  {entry}
                </Text>
              ))
            ) : (
              <Text style={styles.meta}>No evidence references recorded.</Text>
            )}
          </View>
        ) : null}
        {(Object.keys(CLOUD_JOB_LABELS) as CloudJob['state'][]).map((status) => (
          <View key={status}>
            <Text style={styles.title}>
              {CLOUD_JOB_LABELS[status]} ·{' '}
              {visible.jobs.filter((item) => item.state === status).length}
            </Text>
            {visible.jobs
              .filter((item) => item.state === status)
              .map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open job ${item.title}`}
                  style={styles.card}
                  onPress={() => source && setSelected({ key: source.key, id: item.id })}
                >
                  <Text style={styles.body}>{item.title}</Text>
                  <Text style={styles.meta}>
                    {CLOUD_JOB_LABELS[item.state]} · Task {item.taskId}
                  </Text>
                  <Text style={styles.meta}>Target {item.targetDeviceId}</Text>
                  {item.waitingReason ? (
                    <Text style={styles.meta}>{item.waitingReason}</Text>
                  ) : null}
                </Pressable>
              ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md
  },
  content: { padding: spacing.md, gap: spacing.lg },
  card: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.card,
    backgroundColor: colors.bgPanel,
    gap: spacing.sm,
    marginTop: spacing.sm
  },
  title: { fontSize: typography.bodySize, fontWeight: '600', color: colors.textPrimary },
  body: { fontSize: typography.bodySize, color: colors.textPrimary },
  meta: { fontSize: typography.metaSize, color: colors.textSecondary }
})
