import * as React from "react";

import { Check, CloudOff } from "lucide-react";

import {
  SidebarCompactActionCard,
  type SidebarActionCardSurface,
} from "@comms/shared/ui/sidebar-action-card";
import { Spinner } from "@comms/shared/ui/spinner";

type DobiusRelayStatusSnapshot = {
  state?: "starting" | "running" | "failed" | "stopped";
  reason?: string;
};

/**
 * Dobius+ main records WHY the local relay is unreachable (bind failure,
 * still starting). Read once per unreachable stretch; a preload without the
 * read (older builds) or a failed read falls back to the plain retry copy.
 */
function useUnreachableRelayReason(enabled: boolean): string | null {
  const [reason, setReason] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!enabled) {
      setReason(null);
      return;
    }

    let cancelled = false;
    const request = (
      window.dobiusCommunications as
        | {
            relayStatus?: () => Promise<DobiusRelayStatusSnapshot>;
          }
        | undefined
    )?.relayStatus?.();
    request
      ?.then((status) => {
        if (cancelled) {
          return;
        }
        switch (status?.state) {
          case "failed":
            setReason(status.reason ?? "The local relay failed to start");
            break;
          case "starting":
            setReason("Waiting for the local relay to start");
            break;
          case "stopped":
            setReason("The local relay hasn't started");
            break;
          default:
            // Relay reports healthy but the socket still can't connect — keep
            // the retry copy rather than contradicting the reconnect attempt.
            setReason(null);
        }
      })
      .catch(() => setReason(null));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return reason;
}

type SidebarRelayConnectionCardProps = {
  isActionDisabled?: boolean;
  actionTestId?: string;
  className?: string;
  isConnected?: boolean;
  isReconnectPending: boolean;
  isWaitingOnReconnectHook?: boolean;
  onDismiss?: () => void;
  onReconnect: () => void;
  surface?: SidebarActionCardSurface;
  testId?: string;
};

export function SidebarRelayConnectionCard({
  actionTestId,
  className,
  isActionDisabled = false,
  isConnected = false,
  isReconnectPending,
  isWaitingOnReconnectHook = false,
  onDismiss,
  onReconnect,
  surface,
}: SidebarRelayConnectionCardProps) {
  return (
    <SidebarRelayConnectionCompactCard
      actionTestId={actionTestId ?? "sidebar-reconnect"}
      className={className}
      isActionDisabled={isActionDisabled}
      isConnected={isConnected}
      isReconnectPending={isReconnectPending}
      isWaitingOnReconnectHook={isWaitingOnReconnectHook}
      onDismiss={onDismiss}
      onReconnect={onReconnect}
      surface={surface}
      testId="sidebar-relay-unreachable"
    />
  );
}

export function SidebarRelayConnectionCompactCard({
  actionTestId,
  className,
  isActionDisabled = false,
  isConnected = false,
  isReconnectPending,
  isWaitingOnReconnectHook = false,
  onDismiss,
  onReconnect,
  surface,
  testId = "sidebar-relay-unreachable-compact",
}: SidebarRelayConnectionCardProps) {
  const reconnectTitle = isWaitingOnReconnectHook
    ? "Waiting to reconnect"
    : "Connecting";
  const reconnectDescription = isWaitingOnReconnectHook
    ? "Complete any prompts opened by the reconnect helper to continue."
    : "Reconnecting";
  const isUnreachable = !isConnected && !isReconnectPending && !isWaitingOnReconnectHook;
  const unreachableReason = useUnreachableRelayReason(isUnreachable);

  return (
    <SidebarCompactActionCard
      actionAriaLabel={isConnected ? "Connected" : "Connect to relay"}
      actionDisabled={isActionDisabled || isReconnectPending || isConnected}
      actionTestId={actionTestId}
      description={
        isConnected
          ? undefined
          : isReconnectPending
            ? reconnectDescription
            : (unreachableReason ?? "Click to connect")
      }
      dismissLabel="Dismiss relay notification"
      iconKey={
        isConnected ? "connected" : isReconnectPending ? "pending" : "idle"
      }
      icon={
        isConnected ? (
          <Check aria-hidden="true" className="h-5 w-5" />
        ) : isReconnectPending ? (
          <Spinner aria-hidden="true" className="h-5 w-5 border-2" />
        ) : (
          <CloudOff aria-hidden="true" className="h-5 w-5" />
        )
      }
      className={className}
      onAction={onReconnect}
      onDismiss={onDismiss}
      role={isConnected ? "status" : "alert"}
      surface={surface}
      testId={testId}
      title={
        isConnected
          ? "Connected"
          : isReconnectPending
            ? reconnectTitle
            : "Can't reach the relay"
      }
      tone={isConnected ? "success" : "neutral"}
    />
  );
}
