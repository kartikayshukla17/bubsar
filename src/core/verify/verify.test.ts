import { describe, expect, it } from "vitest";
import { answerOf } from "../../../test/helpers/google-auth";
import type { Step } from "../board";
import { exitCode, verifyGoogle } from "./verify";

describe("verify exit code", () => {
  it.each([
    [[], 0],
    [["accepted", "accepted"], 0],
    [["accepted", "rejected"], 3],
    [["accepted", "unknown"], 3],
  ] as const)("%j → %i", (results, code) => {
    expect(exitCode([...results])).toBe(code);
  });
});

const NEW = "https://new.ngrok-free.app";
const CB = `${NEW}/api/auth/callback/google`;
const strip = (id: string, to: string, field: string): Step => ({
  id,
  destination: "google",
  provider: "Google",
  field,
  tier: "web",
  from: "",
  to,
  activeNote: "Editing your OAuth web client in your sandbox browser",
  verify: { mark: "verified", note: "declared, never shown on a live run" },
});
const STEPS = [
  strip("google-redirect-1", CB, "Authorized redirect URI"),
  strip("google-origin-1", NEW, "Authorized JavaScript origin"),
];

describe("verifyGoogle", () => {
  it("records every answer before the strip turns, and keeps the strip checking while it waits", async () => {
    let t = Date.parse("2026-11-22T10:00:00.000Z");
    const log: unknown[] = [];
    const answers = [answerOf("mismatch-error-redirect"), answerOf("accepted-signin-identifier")];
    const out = await verifyGoogle({ redirectUris: [CB], jsOrigins: [NEW] }, STEPS, 600_000, {
      ask: async (uri) => {
        log.push(`ask ${uri}`);
        return answers.shift() ?? answerOf("rate-limited");
      },
      clock: {
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
      },
      emit: (a) => log.push(a),
      record: (c) => log.push({ record: c }),
      waiting: (uri, ms) => log.push(`waiting ${uri} ${ms}`),
    });
    expect(log).toEqual([
      { type: "verify-start" },
      {
        type: "check",
        id: "google-redirect-1",
        note: "Asking Google whether it accepts this redirect URI",
      },
      `ask ${CB}`,
      { record: { at: "2026-11-22T10:00:00.000Z", uri: CB, result: "rejected", status: 302 } },
      { type: "check", id: "google-redirect-1", note: "waiting for Google to pick up the change" },
      `waiting ${CB} 5000`,
      `ask ${CB}`,
      { record: { at: "2026-11-22T10:00:05.000Z", uri: CB, result: "accepted", status: 302 } },
      {
        type: "checked",
        id: "google-redirect-1",
        mark: "verified",
        note: `Google accepted ${CB} as a redirect URI`,
      },
      {
        type: "checked",
        id: "google-origin-1",
        mark: "unexercised",
        note: "Origin listed. This check doesn't exercise it; sign-in through the app would.",
      },
      { type: "verify-done" },
    ]);
    expect(out.code).toBe(0);
  });

  it("marks a removal as nothing to check; a redirect strip it didn't ask about is unknown and exits 3", async () => {
    const log: unknown[] = [];
    const steps = [
      { ...strip("google-redirect-1", CB, "Authorized redirect URI"), from: "" },
      { ...strip("google-redirect-remove-1", "", "Authorized redirect URI"), from: CB },
    ];
    const out = await verifyGoogle({ redirectUris: [], jsOrigins: [] }, steps, 0, {
      ask: async () => answerOf("accepted-signin-identifier"),
      clock: { now: () => 0, sleep: async () => {} },
      emit: (a) => log.push(a),
      record: (c) => log.push({ record: c }),
      waiting: () => {},
    });
    expect(log).toEqual([
      { type: "verify-start" },
      {
        type: "checked",
        id: "google-redirect-1",
        mark: "unknown",
        note: "Not on the client as busbar last read it, so it wasn't checked.",
      },
      {
        type: "checked",
        id: "google-redirect-remove-1",
        mark: "unexercised",
        note: "Entry removed. Nothing to check",
      },
      { type: "verify-done" },
    ]);
    expect(out.code).toBe(3);
  });
});
