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

describe("checked carries the recorded result (BB-05)", () => {
  const applied = () => {
    let s = reduce(initialBoard(), { type: "plan", steps: [step("google-redirect-1")] });
    for (const a of [
      { type: "start" },
      { type: "activate", id: "google-redirect-1" },
      { type: "settle", id: "google-redirect-1" },
      { type: "apply-done" },
      { type: "verify-start" },
      { type: "check", id: "google-redirect-1" },
    ] as const)
      s = reduce(s, a);
    return s;
  };

  it("prefers the event's mark and note over the step's declared verify", () => {
    const s = reduce(applied(), {
      type: "checked",
      id: "google-redirect-1",
      mark: "rejected",
      note: "Not accepted yet. Re-run `bb verify` later.",
    });
    expect(s.strips["google-redirect-1"]).toEqual({
      bay: "cleared",
      mark: "rejected",
      fresh: true,
      note: "Not accepted yet. Re-run `bb verify` later.",
    });
  });

  it("never falls back to verified: a checked with no mark for a step it doesn't know is unknown", () => {
    const s = reduce(applied(), { type: "checked", id: "google-origin-9" });
    expect(s.strips["google-origin-9"]).toEqual({ mark: "unknown", fresh: true });
  });

  it("keeps the strip checking while Google catches up, with the check's note", () => {
    const s = reduce(applied(), {
      type: "check",
      id: "google-redirect-1",
      note: "waiting for Google to pick up the change",
    });
    expect(s.strips["google-redirect-1"]).toEqual({
      bay: "cleared",
      mark: "checking",
      fresh: false,
      note: "waiting for Google to pick up the change",
    });
  });
});

describe("handoff (BB-06)", () => {
  it("moves the strip to Your turn with the instruction, and pauses the run", () => {
    let s = reduce(initialBoard(), {
      type: "plan",
      steps: [step("google-redirect-1"), step("google-origin-1")],
    });
    s = reduce(s, { type: "start" });
    s = reduce(s, { type: "activate", id: "google-redirect-1" });
    const note = "Google wants you to sign in again. busbar opened Brave on its profile.";
    s = reduce(s, { type: "handoff", id: "google-redirect-1", note });
    expect(s.phase).toBe("handoff");
    expect(s.strips["google-redirect-1"]).toEqual({
      bay: "turn",
      mark: "handoff",
      fresh: true,
      note,
    });
    expect(s.strips["google-origin-1"]).toEqual({ bay: "plan", mark: "planned", fresh: false });
  });
});
