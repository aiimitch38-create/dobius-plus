import type { Project } from "@comms/features/projects/hooks";

export function getDiscussionLabel(project: Project) {
  return project.projectChannelId ? "Discussion linked" : "No discussion";
}
