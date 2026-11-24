/* What a patch may carry into a stored card. Why an allowlist of own keys: a
 * patch can arrive as parsed JSON or over IPC, where an own "__proto__" key is
 * possible; Object.assign would then give the card an inherited field (say a
 * kitchen mark) that no `delete patch.x` removes. Anything not named here,
 * including __proto__, constructor and prototype, is dropped. */

import type { VertexTaskPatch } from '../../shared/vertex-task-types'

// Why `satisfies`: a new card field fails the typecheck until it is listed.
const PATCHABLE = {
  title: true,
  description: true,
  status: true,
  priority: true,
  type: true,
  destination: true,
  coverImageUrl: true,
  assignee: true,
  collaborators: true,
  dueDate: true,
  labels: true,
  related: true,
  dependencies: true,
  parentTaskId: true,
  childTaskIds: true,
  subtasks: true,
  files: true,
  resultNote: true,
  completedAt: true,
  origin: true,
  dispatch: true,
  provenance: true,
  autoFix: true,
  kitchen: true,
  missionId: true,
  projectId: true,
  lease: true,
  blockedReason: true,
  comments: true,
  sourceQuote: true,
  createdBy: true,
  resultMetadata: true,
  attachments: true
} satisfies Record<keyof VertexTaskPatch, true>

/** A fresh plain object holding only the patch's own, allowed fields. */
export function cleanVertexTaskPatch(patch: VertexTaskPatch): VertexTaskPatch {
  const clean: Record<string, unknown> = {}
  if (patch && typeof patch === 'object') {
    for (const key of Object.keys(patch)) {
      if (Object.hasOwn(PATCHABLE, key)) {
        clean[key] = (patch as Record<string, unknown>)[key]
      }
    }
  }
  return clean
}
