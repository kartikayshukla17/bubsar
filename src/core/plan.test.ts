import { describe, expect, it } from "vitest";
import type { Config } from "./config";
import { diff } from "./diff";
import { desiredLists, plan } from "./plan";

const config: Config = {
  project: { name: "enquiry-to-paid" },
  values: { "tunnel.url": { kind: "url", source: "arg" } },
  destinations: {
    google: {
      project_id: "my-sandbox-123",
      client_id: "1234-abc.apps.googleusercontent.com",
      redirect_uris: ["{tunnel.url}/api/auth/callback/google"],
      js_origins: ["{tunnel.url}"],
    },
  },
};

describe("plan", () => {
  it("plans one Google write per declared entry, current state unknown", () => {
    const steps = plan(config, { "tunnel.url": "https://abcd.ngrok-free.app" });
    expect(
      steps.map(({ id, destination, field, tier, from, to }) => ({
        id,
        destination,
        field,
        tier,
        from,
        to,
      })),
    ).toEqual([
      {
        id: "google-redirect-1",
        destination: "google",
        field: "Authorized redirect URI",
        tier: "web",
        from: null,
        to: "https://abcd.ngrok-free.app/api/auth/callback/google",
      },
      {
        id: "google-origin-1",
        destination: "google",
        field: "Authorized JavaScript origin",
        tier: "web",
        from: null,
        to: "https://abcd.ngrok-free.app",
      },
    ]);
  });

  it("drops a pasted trailing slash so the origin stays valid and the path has one slash", () => {
    const [redirect, origin] = plan(config, { "tunnel.url": "https://abcd.ngrok-free.app/" });
    expect(redirect.to).toBe("https://abcd.ngrok-free.app/api/auth/callback/google");
    expect(origin.to).toBe("https://abcd.ngrok-free.app");
  });

  it.each([
    ["not a URL", "abcd.ngrok-free.app"],
    ["plain http", "http://abcd.ngrok-free.app"],
    ["has a path", "https://abcd.ngrok-free.app/app"],
  ])("refuses a tunnel that is %s", (_, tunnel) => {
    expect(() => plan(config, { "tunnel.url": tunnel })).toThrow(
      `--tunnel ${tunnel}: expected an https origin like https://abcd.ngrok-free.app`,
    );
  });

  it("refuses to plan without a value the config needs", () => {
    expect(() => plan(config, {})).toThrow("tunnel.url has no value: pass --tunnel <url>");
  });
});

describe("plan from what busbar read", () => {
  const NEW = "https://new.ngrok-free.app";
  const OLD = "https://old.ngrok-free.app";
  const CB = "/api/auth/callback/google";
  const values = { "tunnel.url": NEW };
  const shape = (steps: ReturnType<typeof plan>) =>
    steps.map(({ id, field, from, to, note }) => ({ id, field, from, to, note }));

  it("pairs a removal with an add as one replace strip, and a lone add reads from empty", () => {
    const d = diff(
      { redirectUris: [`${OLD}${CB}`, `http://localhost:3000${CB}`], jsOrigins: [] },
      desiredLists(config, values),
      { redirectUris: [`${OLD}${CB}`], jsOrigins: [] },
      { adopt: false },
    );
    expect(shape(plan(config, values, d))).toEqual([
      {
        id: "google-redirect-1",
        field: "Authorized redirect URI",
        from: `${OLD}${CB}`,
        to: `${NEW}${CB}`,
        note: undefined,
      },
      {
        id: "google-origin-1",
        field: "Authorized JavaScript origin",
        from: "",
        to: NEW,
        note: undefined,
      },
    ]);
  });

  it("gives an unpaired removal its own strip, and an entry already there none", () => {
    const d = diff(
      { redirectUris: [`${NEW}${CB}`], jsOrigins: [OLD, "https://older.ngrok-free.app", NEW] },
      desiredLists(config, values),
      { redirectUris: [], jsOrigins: [OLD, "https://older.ngrok-free.app"] },
      { adopt: false },
    );
    expect(shape(plan(config, values, d))).toEqual([
      {
        id: "google-origin-remove-1",
        field: "Authorized JavaScript origin",
        from: OLD,
        to: "",
        note: undefined,
      },
      {
        id: "google-origin-remove-2",
        field: "Authorized JavaScript origin",
        from: "https://older.ngrok-free.app",
        to: "",
        note: undefined,
      },
    ]);
  });

  it("puts likely-stale entries in the note of that list's first strip", () => {
    const stale = "https://x.ngrok-free.app";
    const d = diff(
      { redirectUris: [`${stale}${CB}`], jsOrigins: [stale] },
      desiredLists(config, values),
      { redirectUris: [], jsOrigins: [] },
      { adopt: false },
    );
    expect(plan(config, values, d).map((s) => s.note)).toEqual([
      `Likely stale, kept: ${stale}${CB}`,
      `Likely stale, kept: ${stale}`,
    ]);
  });

  it("moves a likely-stale note to the first strip when its own list has no strip", () => {
    const stale = "https://x.ngrok-free.app";
    const d = diff(
      { redirectUris: [`${NEW}${CB}`, `${stale}${CB}`], jsOrigins: [] },
      desiredLists(config, values),
      { redirectUris: [], jsOrigins: [] },
      { adopt: false },
    );
    expect(shape(plan(config, values, d))).toEqual([
      {
        id: "google-origin-1",
        field: "Authorized JavaScript origin",
        from: "",
        to: NEW,
        note: `Likely stale, kept: ${stale}${CB}`,
      },
    ]);
  });
});
