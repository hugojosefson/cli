/** @module Bounded confirmation after a publication write with an uncertain result. */
export type ReleaseClock = {
  sleep(milliseconds: number): Promise<void>;
  now?(): number;
};

/** Retries absent or temporarily unavailable reads; content conflicts fail immediately. */
export async function confirmPublication(
  check: () => Promise<boolean>,
  clock: ReleaseClock = {
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: () => performance.now(),
  },
  waitLimitMs = 60_000,
): Promise<boolean> {
  const start = clock.now?.() ?? 0;
  let waited = 0;
  const elapsed = () => clock.now ? clock.now() - start : waited;
  while (elapsed() <= waitLimitMs) {
    try {
      if (await check()) return true;
    } catch (error) {
      if (error instanceof TypeError) throw error;
    }
    const delay = Math.min(5_000, waitLimitMs - elapsed());
    if (delay <= 0) {
      return false;
    }
    await clock.sleep(delay);
    waited += delay;
  }
  return false;
}
