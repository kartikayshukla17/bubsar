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
