/** @module Bounded confirmation after a publication write with an uncertain result. */
export type ReleaseClock = { sleep(milliseconds: number): Promise<void> };

/** Retries absent or temporarily unavailable reads; content conflicts fail immediately. */
export async function confirmPublication(
  check: () => Promise<boolean>,
  clock: ReleaseClock = {
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
): Promise<boolean> {
  for (let elapsed = 0; elapsed <= 60_000; elapsed += 5_000) {
    try {
      if (await check()) return true;
    } catch (error) {
      if (error instanceof TypeError) throw error;
    }
    if (elapsed < 60_000) await clock.sleep(5_000);
  }
  return false;
}
