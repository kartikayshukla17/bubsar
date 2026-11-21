import { format, inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { Secret } from "./secret";

// sha256("hunter2"), from `printf hunter2 | shasum -a 256`
const HUNTER2_FP = "sha256 f52f…f6c7";

describe("Secret", () => {
  it("serializes as its slot and a short fingerprint, never the value", () => {
    const run = { db: Secret.of("DATABASE_URL", "hunter2") };
    expect(JSON.stringify(run)).toBe(
      `{"db":{"slot":"DATABASE_URL","fingerprint":"${HUNTER2_FP}"}}`,
    );
  });

  it("does not leak through string coercion, inspect, or copying", () => {
    const s = Secret.of("RAZORPAY_WEBHOOK_SECRET", "hunter2");
    const renderings = [
      String(s),
      `${s}`,
      inspect(s, { showHidden: true, depth: 10 }),
      format("%o %O %j %s", s, s, s, s),
      JSON.stringify({ ...s }),
      JSON.stringify(structuredClone({ ...s })),
    ];
    for (const r of renderings) expect(r).not.toContain("hunter2");
    expect(String(s)).toBe(`[secret RAZORPAY_WEBHOOK_SECRET ${HUNTER2_FP}]`);
  });
});
