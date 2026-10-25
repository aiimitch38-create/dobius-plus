import type { VertexTaskLease } from '../../../../shared/vertex-task-types'
import type { TaskPriority, TaskType } from './kanban-types'

const typeLabels: Record<TaskType, string> = {
  feature: 'Feature',
  design: 'Design',
  integration: 'Integration',
  ai: 'AI',
  security: 'Security',
  infra: 'Infra',
  bug: 'Bug'
}

const priorityLabels: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent'
}

export function TypeChip({ type }: { type: TaskType }): React.JSX.Element {
  return <span className={`kanban-chip kanban-chip-${type}`}>{typeLabels[type]}</span>
}

export function PriorityChip({ priority }: { priority: TaskPriority }): React.JSX.Element {
  return (
    <span className={`kanban-chip kanban-priority-${priority}`}>{priorityLabels[priority]}</span>
  )
}

export function LabelChip({ label }: { label: string }): React.JSX.Element {
  const tone = label === 'Canvas' ? 'violet' : label === 'High Priority' ? 'red' : 'blue'
  return <span className={`kanban-chip kanban-label-${tone}`}>{label}</span>
}

/** Who holds the card's lease (a lead or a worker console). */
export function ClaimedChip({ lease }: { lease: VertexTaskLease }): React.JSX.Element {
  return (
    <span
      className="kanban-chip kanban-label-violet"
      title={`${lease.kind}, lease until ${new Date(lease.leaseUntil).toLocaleTimeString()}`}
    >
      {lease.claimedBy}
    </span>
  )
}

export function BlockedChip({ reason }: { reason: string }): React.JSX.Element {
  return (
    <span className="kanban-chip kanban-label-red" title={reason}>
      Blocked
    </span>
  )
}
