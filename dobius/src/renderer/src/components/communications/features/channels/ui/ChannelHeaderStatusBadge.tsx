import type { EphemeralChannelDisplay } from "@comms/features/channels/lib/ephemeralChannel";
import { EphemeralChannelBadge } from "@comms/features/channels/ui/EphemeralChannelBadge";

type ChannelHeaderStatusBadgeProps = {
  ephemeralDisplay: EphemeralChannelDisplay | null;
};

export function ChannelHeaderStatusBadge({
  ephemeralDisplay,
}: ChannelHeaderStatusBadgeProps) {
  return ephemeralDisplay ? (
    <EphemeralChannelBadge
      display={ephemeralDisplay}
      testId="chat-ephemeral-badge"
      variant="header"
    />
  ) : null;
}
