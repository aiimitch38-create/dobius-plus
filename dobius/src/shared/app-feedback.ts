/* In-app bug reports and change requests for Dobius+ itself.
 *
 * The Board's "Found a bug?" dialog files a Vertex task against this project,
 * assigned to the Dobius lead profile, so the lead loop picks it up like any
 * other card. The lead runbook tells the operator to use these same ids in the
 * Dobius repo's `.dobius/lead.json`; this file is the single source of truth. */
import type { VertexTaskInput } from './vertex-task-types'

export const APP_FEEDBACK_PROJECT_ID = 'dobius-plus'
export const APP_FEEDBACK_LEAD_PROFILE = 'lead-dobius-plus'
export const APP_FEEDBACK_LEAD_NAME = 'Dobius lead'
export const APP_FEEDBACK_CREATED_BY = 'carson'

export const APP_FEEDBACK_TITLE_MAX = 120
export const APP_FEEDBACK_DETAILS_MAX = 8000

export type AppFeedbackKind = 'bug' | 'change'

export type AppFeedbackContext = {
  appVersion: string
  view: string
  worktreeName: string | null
}

export type AppFeedbackDraft = {
  kind: AppFeedbackKind
  title: string
  details: string
  context: AppFeedbackContext
}

// Why: the context block is appended as plain text after a blank line so the
// card body reads as the operator's words first and the environment second.
function formatContext(context: AppFeedbackContext): string {
  const lines = [
    'Context',
    `- App version: ${context.appVersion}`,
    `- View: ${context.view}`
  ]
  if (context.worktreeName) {
    lines.push(`- Workspace: ${context.worktreeName}`)
  }
  return lines.join('\n')
}

export function buildAppFeedbackTaskInput(draft: AppFeedbackDraft): VertexTaskInput {
  const title = draft.title.trim().slice(0, APP_FEEDBACK_TITLE_MAX)
  const details = draft.details.trim().slice(0, APP_FEEDBACK_DETAILS_MAX)
  const isBug = draft.kind === 'bug'
  return {
    title,
    description: details ? `${details}\n\n${formatContext(draft.context)}` : formatContext(draft.context),
    projectId: APP_FEEDBACK_PROJECT_ID,
    assignee: {
      id: APP_FEEDBACK_LEAD_PROFILE,
      kind: 'hermes-profile',
      name: APP_FEEDBACK_LEAD_NAME,
      initials: 'DL'
    },
    status: 'todo',
    priority: isBug ? 'high' : 'medium',
    type: isBug ? 'bug' : 'feature',
    labels: [isBug ? 'bug' : 'change-request', 'from-app'],
    createdBy: APP_FEEDBACK_CREATED_BY
  }
}
