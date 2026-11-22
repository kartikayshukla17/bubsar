import { describe, expect, it } from "vitest";
import { latestChecks } from "./rewire";
import type { Check } from "./state";

const A = "https://new.ngrok-free.app/api/auth/callback/google";
const B = "https://new.ngrok-free.app/oauth/callback";
const check = (uri: string, result: Check["result"], at: string): Check => ({
  at,
  uri,
  result,
  status: 302,
});

describe("latestChecks", () => {
  it("gives each URI its last recorded result, in the order asked, and null for one never checked", () => {
    const checks = [
      check(A, "rejected", "2026-11-22T10:00:00.000Z"),
      check(B, "accepted", "2026-11-22T10:00:01.000Z"),
      check(A, "accepted", "2026-11-22T10:00:05.000Z"),
      check(B, "unknown", "2026-11-22T10:10:00.000Z"),
      check(
        "https://old.ngrok-free.app/api/auth/callback/google",
        "accepted",
        "2026-11-22T09:00:00.000Z",
      ),
    ];
    expect(latestChecks(checks, [B, A, "https://other.example/cb"])).toEqual([
      { uri: B, result: "unknown" },
      { uri: A, result: "accepted" },
      { uri: "https://other.example/cb", result: null },
    ]);
  });
});
