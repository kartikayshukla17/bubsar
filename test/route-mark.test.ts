import { describe, expect, it } from "vitest";
import {
  type CheckMark,
  initialBoard,
  reduce,
  routeMark,
  type Step,
  type Value,
} from "~/lib/board";

const step = (id: string): Step => ({
  id,
  destination: "google",
  provider: "Google",
  field: "Authorized redirect URI",
  tier: "web",
  from: "",
  to: `https://new.ngrok-free.app/${id}`,
  activeNote: "Editing the OAuth web client",
  verify: { mark: "verified", note: "Authorize accepted the redirect_uri" },
});

const tunnel: Value = {
  id: "tunnel.url",
  kind: "URL",
  secret: false,
  literal: "https://new.ngrok-free.app",
  origin: "--tunnel",
  routes: ["google"],
  rest: "unknown",
};

function checked(marks: Record<string, CheckMark>) {
  const ids = Object.keys(marks);
  let s = reduce(initialBoard(), { type: "plan", steps: ids.map(step) });
  s = reduce(s, { type: "start" });
  for (const id of ids) s = reduce(s, { type: "settle", id });
  s = reduce(s, { type: "apply-done" });
  s = reduce(s, { type: "verify-start" });
  for (const id of ids) s = reduce(s, { type: "checked", id, mark: marks[id], note: "n" });
  return s;
}

describe("the Google route's mark on the sector map and ledger", () => {
  it("takes the worst of every strip to that destination, not the first strip's", () => {
    const s = checked({ "google-redirect-1": "verified", "google-redirect-2": "rejected" });
    expect(routeMark(s, tunnel, "google")).toBe("rejected");
  });

  it("reads not exercised when the redirect URI was verified but the JS origin wasn't exercised", () => {
    const s = checked({ "google-redirect-1": "verified", "google-origin-1": "unexercised" });
    expect(routeMark(s, tunnel, "google")).toBe("unexercised");
  });
});
