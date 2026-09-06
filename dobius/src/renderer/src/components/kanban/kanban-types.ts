export type TaskStatus = 'backlog' | 'todo' | 'in-progress' | 'review' | 'testing' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskType = 'feature' | 'design' | 'integration' | 'ai' | 'security' | 'infra' | 'bug'

export type Person = { id: string; name: string; avatarUrl?: string; initials: string }

export type Task = {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  type: TaskType
  coverImageUrl?: string
  commentCount: number
  attachmentCount: number
  assignee?: Person
  collaborators: Person[]
  dueDate?: string
  labels: string[]
  related: { id: string; label: string }[]
  dependencies: string[]
  subtasks: { id: string; title: string; done: boolean }[]
  files: { id: string; name: string; url?: string }[]
}

/** The ONLY way the board reads or writes tasks. Ship an in-memory mock now;
 *  a real store replaces it later with zero component changes. */
export type TaskSource = {
  list(): Task[]
  move(taskId: string, to: TaskStatus, toIndex: number): void
  update(taskId: string, patch: Partial<Task>): void
  create(partial: Pick<Task, 'title' | 'status'>): Task
}
