// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSystemColorScheme } from "./useSystemColorScheme";

const NOON = new Date(2026, 0, 1, 12, 0, 0);
const MIDNIGHT = new Date(2026, 0, 1, 0, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSystemColorScheme", () => {
  it("resolves from the local clock, not an OS signal", () => {
    vi.setSystemTime(NOON);
    const { result } = renderHook(() => useSystemColorScheme());
    expect(result.current).toBe("light");
  });

  it("resolves dark at night", () => {
    vi.setSystemTime(MIDNIGHT);
    const { result } = renderHook(() => useSystemColorScheme());
    expect(result.current).toBe("dark");
  });

  it("re-evaluates live as the clock crosses day/night, matching the app's time-of-day rule", () => {
    vi.setSystemTime(NOON);
    const { result } = renderHook(() => useSystemColorScheme());
    expect(result.current).toBe("light");

    vi.setSystemTime(MIDNIGHT);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current).toBe("dark");
  });
});
