import * as React from "react";
import { isDaytime } from "@/lib/document-theme";

export type SystemColorScheme = "dark" | "light";

// Why: "system" resolves off local time of day app-wide (see
// lib/document-theme.ts), not the OS's prefers-color-scheme signal — these
// onboarding/setup screens need to agree with the rest of the app instead of
// reading a second, disconnected signal.
const REEVALUATE_INTERVAL_MS = 60_000;

function getSystemColorScheme(): SystemColorScheme {
  return isDaytime() ? "light" : "dark";
}

export function useSystemColorScheme(): SystemColorScheme {
  const [colorScheme, setColorScheme] =
    React.useState<SystemColorScheme>(getSystemColorScheme);

  React.useEffect(() => {
    const updateColorScheme = () => {
      setColorScheme(getSystemColorScheme());
    };

    updateColorScheme();
    const interval = window.setInterval(updateColorScheme, REEVALUATE_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return colorScheme;
}
