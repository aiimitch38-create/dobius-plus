const HOLD_TICK_MS = 15_000;

/** A referenced handle protects promise-only work and unref'd shutdown deadlines. */
export function retainProcessLifetime(): () => void {
  const hold = setInterval(() => undefined, HOLD_TICK_MS);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    clearInterval(hold);
  };
}
