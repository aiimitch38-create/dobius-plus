import type { Channel, ChannelMember } from "@comms/shared/api/types";
import { normalizePubkey } from "@comms/shared/lib/pubkey";

type CanStartHuddleInput = {
  channel: Channel;
  currentPubkey?: string;
  selfMember: ChannelMember | null;
};

export function canStartHuddleInChannel({
  channel,
  currentPubkey,
  selfMember,
}: CanStartHuddleInput): boolean {
  if (channel.archivedAt !== null) {
    return false;
  }

  if (channel.channelType === "dm") {
    if (channel.isMember) {
      return true;
    }

    if (!currentPubkey) {
      return false;
    }

    const normalizedCurrentPubkey = normalizePubkey(currentPubkey);
    return channel.participantPubkeys.some(
      (pubkey) => normalizePubkey(pubkey) === normalizedCurrentPubkey,
    );
  }

  return channel.visibility === "open" || selfMember !== null;
}

/**
 * Explains why the Huddle start button is disabled — TASK COMMS.3: a
 * disabled button with a static "Huddle" tooltip and no explanation reads as
 * broken. Returns null once the button should be enabled (caller decides
 * whether to actually show this — it's meaningless while the button isn't
 * disabled for some other reason, e.g. already starting).
 */
export function huddleStartDisabledReason({
  canStartHuddle,
  isMembersPending,
}: {
  canStartHuddle: boolean;
  isMembersPending: boolean;
}): string | null {
  if (isMembersPending) {
    return "Members list is still loading";
  }

  if (!canStartHuddle) {
    return "You're not a member of this channel";
  }

  return null;
}
