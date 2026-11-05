import { actionDigest } from './action-digest.js'
import type { Action } from './schema.js'

export type Approval = {
  actionDigest: string
  approvedBy: string
  approvedAt: string
  expiresAt: string
  consumedAt?: string
}

export function approvalIsValid(approval: Approval, action: Action, now = new Date()): boolean {
  if (approval.consumedAt) {
    return false
  }
  if (approval.actionDigest !== actionDigest(action)) {
    return false
  }
  return Date.parse(approval.expiresAt) > now.getTime()
}

