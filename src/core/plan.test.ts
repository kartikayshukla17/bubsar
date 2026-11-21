import { describe, expect, it } from "vitest";
import type { Config } from "./config";
import { plan } from "./plan";

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
