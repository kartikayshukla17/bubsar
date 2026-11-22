import { describe, expect, it } from "vitest";
import { initialBoard, reduce, type Step } from "./board";

const step = (id: string, over: Partial<Step> = {}): Step => ({
  id,
  destination: "google",
  provider: "Google",
  field: "Authorized redirect URI",
  tier: "web",
  from: null,
  to: "https://abcd.ngrok-free.app/api/auth/callback/google",
  activeNote: "Editing the OAuth web client",
  verify: { mark: "verified", note: "Authorize accepted the redirect_uri" },
  ...over,
});

describe("board reducer (the run's event protocol)", () => {
  it("a plan event puts exactly the planned steps in the Plan bay", () => {
    const s = reduce(initialBoard(), {
      type: "plan",
      steps: [step("google.redirect"), step("google.origin")],
    });
    expect(s.phase).toBe("planned");
    expect(s.strips).toEqual({
      "google.redirect": { bay: "plan", mark: "planned", fresh: false },
      "google.origin": { bay: "plan", mark: "planned", fresh: false },
    });
  });
});

describe("fail (BB-04)", () => {
  it("marks the strip failed where it stopped, carries the reason, and stops the run", () => {
    let s = reduce(initialBoard(), {
      type: "plan",
      steps: [step("google-redirect-1"), step("google-origin-1")],
    });
    s = reduce(s, { type: "start" });
    s = reduce(s, { type: "activate", id: "google-redirect-1" });
    s = reduce(s, {
      type: "fail",
      id: "google-redirect-1",
      note: "Google didn't save the client: Invalid Redirect",
    });
    expect(s.phase).toBe("failed");
    expect(s.strips["google-redirect-1"]).toEqual({
      bay: "active",
      mark: "failed",
      fresh: true,
      note: "Google didn't save the client: Invalid Redirect",
    });
    expect(s.strips["google-origin-1"]).toEqual({ bay: "plan", mark: "planned", fresh: false });
  });
});
