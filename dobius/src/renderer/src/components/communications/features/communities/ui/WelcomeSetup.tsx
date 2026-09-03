import * as React from "react";

import { useCommunityOnboarding } from "@comms/features/onboarding/communityOnboarding";
import { InviteRedeemForm } from "@comms/features/onboarding/ui/InviteRedeemForm";
import { OnboardingChrome } from "@comms/features/onboarding/ui/OnboardingChrome";
import {
  OnboardingFooter,
  OnboardingFooterProvider,
} from "@comms/features/onboarding/ui/OnboardingFooter";
import {
  type OnboardingTransitionDirection,
  OnboardingSlideTransition,
} from "@comms/features/onboarding/ui/OnboardingSlideTransition";
import { DOBIUS_RELAY_WEBSOCKET_URL } from "@comms/shared/api/dobiusCommunications";
import { useSystemColorScheme } from "@comms/shared/theme/useSystemColorScheme";
import { Button } from "@comms/shared/ui/button";
import { Card } from "@comms/shared/ui/card";
import { StartupWindowDragRegion } from "@comms/shared/ui/StartupWindowDragRegion";

// Upstream had five pages here, four of which assumed somebody else's relay:
// "join" (invite link + copy-your-public-ID), "existing" (pick your role),
// "owned" and the hosted sign-in modal (both Builderlab, Block's hosted relay
// service — `clear_builderlab_auth` is not a command this app has, so that
// path errored on open). Dobius's relay is local and there is exactly one, so
// "welcome" is now a single Connect button.
//
// "member" survives because a resumed onboarding transaction, or a deep link,
// can still arrive pointing at a relay URL and needs somewhere to land.
type WelcomeSetupPage = "welcome" | "member";
type WelcomeTransitionMode = "initial" | OnboardingTransitionDirection;

type WelcomeSetupProps = {
  initialPage?: WelcomeSetupPage;
  initialTransitionMode?: WelcomeTransitionMode;
  onBack: () => void;
};

const COMMUNITY_OPTION_CARD_CLASS =
  "w-full max-w-[320px] items-center px-6 py-4 text-center text-sm font-normal leading-6 text-foreground [--buzz-card-textured-min-height:88px] transition-[filter] duration-150 ease-out hover:brightness-[0.98] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foreground/35";

export function WelcomeSetup({
  initialPage = "welcome",
  initialTransitionMode = "initial",
  onBack,
}: WelcomeSetupProps) {
  const [page, setPage] = React.useState<WelcomeSetupPage>(initialPage);
  const [transitionMode, setTransitionMode] =
    React.useState<WelcomeTransitionMode>(initialTransitionMode);
  // Latches on the first click. `start()` hands off to the onboarding
  // transaction, which unmounts this screen; until it does, the button would
  // otherwise accept a second click and start a duplicate connection.
  const [isConnectingLocal, setIsConnectingLocal] = React.useState(false);
  const communityOnboarding = useCommunityOnboarding();
  const systemColorScheme = useSystemColorScheme();

  const showPage = React.useCallback(
    (nextPage: WelcomeSetupPage, direction?: OnboardingTransitionDirection) => {
      setTransitionMode(
        direction ?? (nextPage === "welcome" ? "backward" : "forward"),
      );
      setPage(nextPage);
    },
    [],
  );

  const startConnection = React.useCallback(
    (relayUrl: string) => {
      communityOnboarding.start({
        source: "first-community",
        firstCommunityPage: "member",
        relayUrl,
      });
    },
    [communityOnboarding],
  );

  const redeemInvite = React.useCallback(
    (relayUrl: string, code: string, policyReceipt?: string) => {
      communityOnboarding.start({
        source: "first-community",
        firstCommunityPage: "member",
        relayUrl,
        inviteCode: code,
        policyReceipt,
      });
    },
    [communityOnboarding],
  );

  const transitionDirection =
    transitionMode === "backward" ? "backward" : "forward";
  const welcomeEffect =
    transitionMode === "backward" ? "line-slide" : "mask-reveal-up";

  return (
    <div
      className="buzz-onboarding-neutral-theme buzz-startup-shell flex h-dvh items-start justify-center overflow-y-auto bg-background px-4 pb-36 pt-[106px] text-foreground"
      data-system-color-scheme={systemColorScheme}
    >
      <StartupWindowDragRegion />
      <OnboardingChrome current={5} />
      <OnboardingFooterProvider>
        <div className="relative flex min-h-0 w-full max-w-[920px] flex-1 flex-col items-center text-center">
          {page === "welcome" ? (
            <OnboardingSlideTransition
              className="flex h-full min-h-0 w-full flex-col items-center text-center"
              containerClassName="h-full min-h-0 [&>.buzz-onboarding-transition-line]:h-full"
              direction={transitionDirection}
              effect={welcomeEffect}
              transitionKey={`welcome-${welcomeEffect}-${transitionDirection}`}
            >
              <div className="w-full max-w-[760px]">
                <h1 className="text-title font-normal">
                  Connect to your relay
                </h1>
                <p className="mt-3 text-sm leading-6 text-foreground/80">
                  Dobius runs its own relay on this machine. Your channels,
                  messages, and agents stay here.
                </p>
              </div>
              {/* One action, no choices. Upstream offered "create" (a hosted
                  Builderlab community) and "join"/"reconnect" (someone else's
                  relay URL). Neither applies: the relay is local and there is
                  exactly one, so asking which is a question with one answer. */}
              <div className="flex w-full flex-1 translate-y-16 flex-col items-center justify-center gap-6 py-8">
                <Card
                  asChild
                  className={COMMUNITY_OPTION_CARD_CLASS}
                  variant="textured"
                >
                  <button
                    data-testid="community-choice-local"
                    disabled={isConnectingLocal}
                    onClick={() => {
                      setIsConnectingLocal(true);
                      startConnection(DOBIUS_RELAY_WEBSOCKET_URL);
                    }}
                    type="button"
                  >
                    {isConnectingLocal ? "Connecting…" : "Connect"}
                  </button>
                </Card>
                <p className="font-mono text-xs text-foreground/55">
                  {DOBIUS_RELAY_WEBSOCKET_URL}
                </p>
              </div>
              <OnboardingFooter>
                <Button
                  className="h-9 rounded-full bg-foreground/10 px-6 hover:bg-foreground/15"
                  data-testid="welcome-setup-back"
                  onClick={onBack}
                  type="button"
                  variant="ghost"
                >
                  Back
                </Button>
              </OnboardingFooter>
            </OnboardingSlideTransition>
          ) : (
            <OnboardingSlideTransition
              className="flex min-h-[calc(100dvh-15.625rem)] w-full flex-col items-center text-center"
              direction={transitionDirection}
              transitionKey={`${page}-${transitionDirection}`}
            >
              <div className="w-full max-w-[620px]">
                <h1 className="text-title font-normal">
                  Reconnect to your community
                </h1>
                <p className="mt-3 text-sm leading-6 text-foreground/80">
                  Enter the community URL or an invite link. Your role will be
                  restored when you connect.
                </p>
              </div>
              <div className="flex w-full flex-1 flex-col items-center justify-center gap-16">
                <InviteRedeemForm
                  error={null}
                  isRedeeming={false}
                  onCancel={() => showPage("welcome")}
                  onConnect={startConnection}
                  onRedeem={redeemInvite}
                  placeholder="Invite link or community URL"
                  variant="onboarding-spotlight"
                />
              </div>
            </OnboardingSlideTransition>
          )}
        </div>
      </OnboardingFooterProvider>
    </div>
  );
}
