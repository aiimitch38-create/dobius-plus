import type { ProjectActivitySummary, Project } from "./hooks";
import type { RelayEvent } from "@comms/shared/api/types";

export function summarizeProjectActivityEvents(
  events: RelayEvent[],
  projects: Project[],
): Record<string, ProjectActivitySummary>;
