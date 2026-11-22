import type { Verdict } from "./classify";

export const FIRST_DELAY_MS = 5_000;
export const MAX_DELAY_MS = 60_000;

export type Clock = { now(): number; sleep(ms: number): Promise<void> };

export type Polled = { verdict: Verdict; timedOut: boolean };

/**
 * Ask until Google accepts or the deadline passes. Only `rejected` is asked again, since a
 * change Google hasn't picked up yet looks exactly like that. `unknown` stops at once: busbar
 * never retries a rate limit, a captcha or a failed request into a green.
 */
export async function poll(
  ask: () => Promise<Verdict>,
  deadline: number,
  clock: Clock,
  onWait: (ms: number) => void = () => {},
): Promise<Polled> {
  let delay = FIRST_DELAY_MS;
  for (;;) {
    const verdict = await ask();
    if (verdict.result !== "rejected") return { verdict, timedOut: false };
    const left = deadline - clock.now();
    if (left <= 0) return { verdict, timedOut: true };
    const ms = Math.min(delay, left);
    onWait(ms);
    await clock.sleep(ms);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }
}
