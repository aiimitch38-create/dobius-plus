import { createFileRoute } from "@tanstack/react-router";

import { NewMessageScreen } from "@comms/features/messages/ui/NewMessageScreen";

export const Route = createFileRoute("/messages/new")({
  component: NewMessageScreen,
});
