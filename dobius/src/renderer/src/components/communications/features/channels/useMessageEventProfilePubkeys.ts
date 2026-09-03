import * as React from "react";

import {
  collectMessageAuthorPubkeys,
  collectMessageMentionPubkeys,
  collectReactionActorPubkeys,
} from "@comms/features/messages/lib/formatTimelineMessages";
import type { RelayEvent } from "@comms/shared/api/types";

export function useMessageEventProfilePubkeys(
  messages: RelayEvent[],
  threadReplies: RelayEvent[],
  relaySelfPubkey: string | null | undefined,
) {
  return React.useMemo(() => {
    const events = [...messages, ...threadReplies];
    return [
      ...new Set([
        ...collectMessageAuthorPubkeys(events, relaySelfPubkey),
        ...collectMessageMentionPubkeys(events),
        ...collectReactionActorPubkeys(events, relaySelfPubkey),
      ]),
    ];
  }, [messages, relaySelfPubkey, threadReplies]);
}
