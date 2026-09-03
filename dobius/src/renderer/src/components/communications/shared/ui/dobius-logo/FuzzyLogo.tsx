import { cn } from "@comms/shared/lib/cn";
import { DobiusMark } from "./DobiusMark";
import "./dobius-logo.css";

export type FuzzyLogoProps = {
  /**
   * Kept for call-site compatibility. The vendored client used this to switch a
   * feTurbulence texture filter on and off over its morphing mark; the Dobius
   * mark is a single image, so there is no texture to toggle.
   */
  fuzz?: boolean;
  className?: string;
  ariaLabel?: string;
  loop?: boolean;
  /** When looping, hide the mark for this many seconds between plays. */
  loopRestSeconds?: number;
  /** Set false when a parent drives its own opacity animation over the mark. */
  pulse?: boolean;
  reverse?: boolean;
  variant?: string;
};

/**
 * The Dobius mark as a liveness indicator — "an agent is working".
 *
 * Same name, same props, and the same three behaviours the call sites rely on
 * as the mark this replaced: a rest-window loop (`loop` + `loopRestSeconds`), a
 * steady pulse, or a still mark when the parent animates it itself.
 */
export function FuzzyLogo({
  className,
  ariaLabel = "Dobius logo",
  loop = false,
  loopRestSeconds = 0,
  pulse = true,
}: FuzzyLogoProps) {
  // A rest window already reads as "alive"; running the pulse underneath it
  // would put two opacity animations on the same element.
  const hasRestWindow = loop && loopRestSeconds > 0;
  const cycleSeconds = hasRestWindow ? 1.6 + loopRestSeconds : undefined;

  return (
    <div
      aria-label={ariaLabel || undefined}
      className={cn("grid w-6 place-items-center", className)}
      role={ariaLabel ? "img" : undefined}
      style={
        cycleSeconds
          ? ({
              "--dobius-logo-cycle": `${cycleSeconds}s`,
            } as React.CSSProperties)
          : undefined
      }
    >
      <DobiusMark
        className={cn(
          "h-auto w-full",
          hasRestWindow && "dobius-logo--breathe",
          !hasRestWindow && pulse && "dobius-logo--pulse",
        )}
      />
    </div>
  );
}
