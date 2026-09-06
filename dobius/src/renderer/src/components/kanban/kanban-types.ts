import type {
  VertexTask,
  VertexTaskInput,
  VertexTaskPatch,
  VertexTaskPriority,
  VertexTaskStatus,
  VertexTaskType
} from '../../../../shared/vertex-task-types'

export type Task = VertexTask
export type Person = import('../../../../shared/vertex-task-types').VertexAssignee
export type TaskStatus = VertexTaskStatus
export type TaskPriority = VertexTaskPriority
export type TaskType = VertexTaskType

/** Renderer boundary: both IPC and the browser mock use this Promise-based shape. */
export type TaskSource = {
  list(): Promise<VertexTask[]>
  move(taskId: string, to: VertexTaskStatus, toIndex: number): Promise<VertexTask | null>
  update(taskId: string, patch: VertexTaskPatch): Promise<VertexTask | null>
  create(input: VertexTaskInput): Promise<VertexTask | null>
  remove(taskId: string): Promise<boolean>
}
