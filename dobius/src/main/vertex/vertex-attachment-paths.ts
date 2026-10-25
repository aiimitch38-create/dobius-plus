/* Where card attachments live on disk, and the one id shape allowed in a path.
 *
 * Kept apart from vertex-task-attachments.ts so the task store can delete a
 * removed card's directory without importing the module that imports it. */

import { rmSync } from 'node:fs'
import path from 'node:path'

import { getUserDataRoot } from '../storage/user-data-root'

const DIR_NAME = 'vertex-attachments'

// Why: task ids are UUIDs and attachment ids are hex; anything else (a dot, a
// slash) never becomes part of a path, whatever the renderer sends.
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/

let rootOverride: string | null = null

/** Overridable so tests do not touch the real userData directory. */
export function setVertexAttachmentsRoot(dir: string | null): void {
  rootOverride = dir
}

export function vertexAttachmentsRoot(): string {
  return path.resolve(rootOverride ?? path.join(getUserDataRoot(), DIR_NAME))
}

export function isSafeAttachmentId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value)
}

export function vertexTaskAttachmentDir(taskId: string): string {
  return path.join(vertexAttachmentsRoot(), taskId)
}

/** True when `candidate` resolves to a file strictly inside the attachments root. */
export function isInsideAttachmentsRoot(candidate: string): boolean {
  const root = vertexAttachmentsRoot()
  const resolved = path.resolve(candidate)
  return resolved.startsWith(root + path.sep)
}

export function removeVertexTaskAttachmentDir(taskId: string): void {
  if (!isSafeAttachmentId(taskId)) {
    return
  }
  rmSync(vertexTaskAttachmentDir(taskId), { recursive: true, force: true })
}
