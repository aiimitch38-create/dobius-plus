import { createRootRoute } from "@tanstack/react-router";

import { AppShell } from "@comms/app/AppShell";

export const Route = createRootRoute({
  component: AppShell,
});
