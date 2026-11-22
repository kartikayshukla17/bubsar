import { describe, expect, it } from "vitest";
import type { Verdict } from "./classify";
import { poll } from "./poll";

const accepted: Verdict = { result: "accepted", why: "Google sent the request on to sign-in" };
const rejected: Verdict = { result: "rejected", why: "Google answered redirect_uri_mismatch" };
const unknown: Verdict = { result: "unknown", why: "Google rate-limited the check" };

function fakeClock() {
  let t = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
  };
}

const answers = (...vs: Verdict[]) => {
  const asked: number[] = [];
  return {
    asked,
    ask: async () => {
      asked.push(asked.length);
      return vs[Math.min(asked.length - 1, vs.length - 1)];
    },
  };
};

describe("poll: wait for Google to pick up the change", () => {
  it("asks again after 5s, then 10s, until Google accepts", async () => {
    const clock = fakeClock();
    const g = answers(rejected, rejected, accepted);
    const out = await poll(g.ask, 600_000, clock);
    expect(out).toEqual({ verdict: accepted, timedOut: false });
    expect(clock.slept).toEqual([5_000, 10_000]);
    expect(g.asked).toHaveLength(3);
  });

  it("doubles the wait up to 60s, never past the deadline, then gives up as timed out", async () => {
    const clock = fakeClock();
    const g = answers(rejected);
    const waits: number[] = [];
    const out = await poll(g.ask, 600_000, clock, (ms) => waits.push(ms));
    expect(out).toEqual({ verdict: rejected, timedOut: true });
    const s = 1_000;
    expect(clock.slept).toEqual([5 * s, 10 * s, 20 * s, 40 * s, ...Array(8).fill(60 * s), 45 * s]);
    expect(waits).toEqual(clock.slept);
    expect(g.asked).toHaveLength(14);
  });

  it("stops at the first unknown: a rate limit is never retried into a green", async () => {
    const clock = fakeClock();
    const g = answers(rejected, unknown, accepted);
    expect(await poll(g.ask, 600_000, clock)).toEqual({ verdict: unknown, timedOut: false });
    expect(g.asked).toHaveLength(2);
  });

  it("with no time to wait, asks once", async () => {
    const clock = fakeClock();
    const g = answers(rejected, accepted);
    expect(await poll(g.ask, 0, clock)).toEqual({ verdict: rejected, timedOut: true });
    expect(clock.slept).toEqual([]);
  });
});
