import type {
  VertexAssignee,
  VertexTask,
  VertexTaskInput,
  VertexTaskPatch,
  VertexTaskPriority,
  VertexTaskDestination,
  VertexTaskStatus,
  VertexTaskType
} from '../../../../shared/vertex-task-types'

export type Task = VertexTask
export type Person = VertexAssignee
export type TaskStatus = VertexTaskStatus
export type TaskPriority = VertexTaskPriority
export type TaskType = VertexTaskType
export type { VertexTaskDestination }

/** Renderer boundary: both IPC and the browser mock use this Promise-based shape. */
export type TaskSource = {
  list(): Promise<VertexTask[]>
  reload?(): Promise<VertexTask[]>
  move(taskId: string, to: VertexTaskStatus, toIndex: number): Promise<VertexTask | null>
  update(taskId: string, patch: VertexTaskPatch): Promise<VertexTask | null>
  create(input: VertexTaskInput): Promise<VertexTask | null>
  remove(taskId: string): Promise<boolean>
  /** Optional: the standalone preview has no comments. */
  comment?(taskId: string, author: string, body: string): Promise<VertexTask | null>
}
