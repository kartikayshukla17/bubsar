import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AuthStub, authStub, deadAuthUrl } from "./helpers/google-auth";
import { project, SAMPLE_TOML, signedIn } from "./helpers/project";

const NEW = "https://new.ngrok-free.app";
const OLD = "https://old.ngrok-free.app";
const LOCAL = "http://localhost:3000";
const CB = "/api/auth/callback/google";
const CLIENT = "1234-abc.apps.googleusercontent.com";

const client = { redirectUris: [`${LOCAL}${CB}`, `${OLD}${CB}`], jsOrigins: [OLD] };
const owned = { redirectUris: [`${OLD}${CB}`], jsOrigins: [OLD] };

function applied() {
  const p = signedIn(client, owned);
  for (const args of [
    ["plan", "--tunnel", NEW],
    ["apply", "--yes"],
  ]) {
    const r = p.bb(...args);
    if (r.code !== 0) throw new Error(`bb ${args[0]} failed: ${r.stderr}`);
  }
  return p;
}

const lines = (read: (f: string) => string) =>
  read(".busbar/events.jsonl")
    .trimEnd()
    .split("\n")
    .map((l) => JSON.parse(l).action);

const verifyEvents = (read: (f: string) => string) => {
  const all = lines(read);
  return all.slice(all.findIndex((a) => a.type === "verify-start"));
};

let stub: AuthStub | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

const HEAD = [
  "busbar verify · enquiry-to-paid",
  "",
  `Google · OAuth web client ${CLIENT} in my-sandbox-123`,
  "Asked Google's authorize endpoint directly, signed out: no browser, no session.",
  "",
];

describe("bb verify after bb apply", () => {
  it("asks Google about the new redirect URI, records the answer, marks it verified, exits 0", async () => {
    const p = applied();
    const before = p.world();
    stub = await authStub(() => "accepted-signin-identifier");
    const r = await p.bbAsync(["verify", "--wait", "0"], { BB_GOOGLE_AUTH_URL: stub.url });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      [
        ...HEAD,
        "Authorized redirect URIs",
        `  verified       ${NEW}${CB}`,
        "                 Google sent the request on to sign-in (HTTP 302).",
        "",
        "Authorized JavaScript origins",
        `  not exercised  ${NEW}`,
        "                 This check doesn't exercise origins; sign-in through the app would.",
        "",
        "Verified: Google accepts 1 redirect URI. 1 origin listed, not exercised.",
        "",
      ].join("\n"),
    );

    expect(stub.requests.map((q) => q.query)).toEqual([
      { client_id: CLIENT, redirect_uri: `${NEW}${CB}`, response_type: "code", scope: "openid" },
    ]);
    expect(stub.requests[0].headers.cookie).toBeUndefined();
    expect(p.world().attachCalls).toEqual(before.attachCalls);
    expect(p.world().openPlainCalls).toEqual(before.openPlainCalls);

    const { checks } = JSON.parse(p.read(".busbar/state.json")).google;
    expect(checks).toEqual([
      { at: expect.any(String), uri: `${NEW}${CB}`, result: "accepted", status: 302 },
    ]);
    expect(Date.now() - Date.parse(checks[0].at)).toBeLessThan(60_000);

    const accepted = `Google accepted ${NEW}${CB} as a redirect URI`;
    const origin = "Origin listed. This check doesn't exercise it; sign-in through the app would.";
    expect(verifyEvents(p.read)).toEqual([
      { type: "verify-start" },
      {
        type: "check",
        id: "google-redirect-1",
        note: "Asking Google whether it accepts this redirect URI",
      },
      { type: "checked", id: "google-redirect-1", mark: "verified", note: accepted },
      { type: "checked", id: "google-origin-1", mark: "unexercised", note: origin },
      { type: "verify-done" },
    ]);
    const { board } = JSON.parse(p.read(".busbar/run.json"));
    expect(board.phase).toBe("verified");
    expect(board.strips).toEqual({
      "google-redirect-1": { bay: "cleared", mark: "verified", fresh: true, note: accepted },
      "google-origin-1": { bay: "cleared", mark: "unexercised", fresh: true, note: origin },
    });
  });

  it("a URI Google doesn't have: not accepted yet when the wait runs out (--wait 0), exits 3", async () => {
    const p = applied();
    stub = await authStub(() => "mismatch-error-redirect");
    const r = await p.bbAsync(["verify", "--wait", "0"], { BB_GOOGLE_AUTH_URL: stub.url });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(3);
    expect(r.stdout).toBe(
      [
        ...HEAD,
        "Authorized redirect URIs",
        `  not accepted   ${NEW}${CB}`,
        "                 Google answered redirect_uri_mismatch (HTTP 302). Not accepted yet.",
        "",
        "Authorized JavaScript origins",
        `  not exercised  ${NEW}`,
        "                 This check doesn't exercise origins; sign-in through the app would.",
        "",
        "Not accepted yet: 1 redirect URI. Google can take minutes or longer to pick up a change. Re-run `bb verify` later. 1 origin listed, not exercised.",
        "",
      ].join("\n"),
    );
    expect(stub.requests).toHaveLength(1);
    expect(JSON.parse(p.read(".busbar/state.json")).google.checks).toEqual([
      { at: expect.any(String), uri: `${NEW}${CB}`, result: "rejected", status: 302 },
    ]);
    const { board } = JSON.parse(p.read(".busbar/run.json"));
    expect(board.strips["google-redirect-1"]).toEqual({
      bay: "cleared",
      mark: "rejected",
      fresh: true,
      note: "Not accepted yet. Re-run `bb verify` later.",
    });
    expect(board.strips["google-origin-1"].mark).toBe("unexercised");
  });

  it("with the network off: unknown, recorded, never verified and never failed, exits 3", async () => {
    const p = applied();
    const r = await p.bbAsync(["verify"], { BB_GOOGLE_AUTH_URL: await deadAuthUrl() });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(3);
    const out = r.stdout.split("\n");
    expect(out.slice(HEAD.length, HEAD.length + 3)).toEqual([
      "Authorized redirect URIs",
      `  unknown        ${NEW}${CB}`,
      expect.stringMatching(/^ {17}busbar couldn't reach Google \(.*ECONNREFUSED.*\)\.$/),
    ]);
    expect(out.at(-2)).toBe(
      "Not verified: busbar couldn't tell for 1 redirect URI. Re-run `bb verify`. 1 origin listed, not exercised.",
    );
    expect(JSON.parse(p.read(".busbar/state.json")).google.checks).toEqual([
      { at: expect.any(String), uri: `${NEW}${CB}`, result: "unknown", status: null },
    ]);
    const { board } = JSON.parse(p.read(".busbar/run.json"));
    expect(board.strips["google-redirect-1"]).toMatchObject({ mark: "unknown" });
    expect(board.strips["google-redirect-1"].note).toMatch(
      /^Couldn't tell: busbar couldn't reach Google/,
    );
  });

  it("a rate limit is asked once and left unknown, even with time left to wait", async () => {
    const p = applied();
    stub = await authStub(() => "rate-limited");
    const r = await p.bbAsync(["verify", "--wait", "600"], { BB_GOOGLE_AUTH_URL: stub.url });
    expect(r.code).toBe(3);
    expect(stub.requests).toHaveLength(1);
    expect(r.stdout).toContain("                 Google rate-limited the check (HTTP 429).");
  });
});

describe("bb verify with nothing it can check", () => {
  it("before any plan has read the client: says nothing was checked, asks nothing, exits 3", async () => {
    const p = signedIn(client, owned);
    stub = await authStub(() => "accepted-signin-identifier");
    const r = await p.bbAsync(["verify"], { BB_GOOGLE_AUTH_URL: stub.url });
    expect(r).toEqual({
      code: 3,
      stderr: "",
      stdout: "busbar hasn't read Google yet. Run bb plan, then bb apply.\n",
    });
    expect(stub.requests).toEqual([]);
  });

  it("with a plan not applied yet: refuses, asks nothing, exits 1", async () => {
    const p = signedIn(client, owned);
    expect(p.bb("plan", "--tunnel", NEW).code).toBe(0);
    stub = await authStub(() => "accepted-signin-identifier");
    const r = await p.bbAsync(["verify"], { BB_GOOGLE_AUTH_URL: stub.url });
    expect(r).toEqual({
      code: 1,
      stdout: "",
      stderr: "bb: The last plan isn't applied yet. Run `bb apply`, then `bb verify`.\n",
    });
    expect(stub.requests).toEqual([]);
  });

  it("with a --wait that isn't whole seconds: refuses, exits 1", async () => {
    const p = applied();
    const r = await p.bbAsync(["verify", "--wait", "10m"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("bb: --wait 10m: expected whole seconds, like --wait 600\n");
  });

  it("with no Google destination in busbar.toml: says so, exits 0", async () => {
    const p = project(SAMPLE_TOML.slice(0, SAMPLE_TOML.indexOf("[destinations.google]")));
    const r = await p.bbAsync(["verify"]);
    expect(r).toEqual({
      code: 0,
      stderr: "",
      stdout: "Nothing to verify: busbar.toml has no Google destination.\n",
    });
  });

  it("when no redirect URI busbar wants or owns is on the client: says so, asks nothing, exits 0", async () => {
    const p = applied();
    const state = JSON.parse(p.read(".busbar/state.json"));
    state.google.planned.read.redirectUris = [`${LOCAL}${CB}`];
    state.google.planned.next.redirectUris = [`${LOCAL}${CB}`];
    writeFileSync(join(p.dir, ".busbar", "state.json"), JSON.stringify(state));
    stub = await authStub(() => "accepted-signin-identifier");
    const r = await p.bbAsync(["verify"], { BB_GOOGLE_AUTH_URL: stub.url });
    expect(r).toEqual({
      code: 0,
      stderr: "",
      stdout:
        "Nothing to verify: none of the redirect URIs busbar wants or owns are on the client.\n",
    });
    expect(stub.requests).toEqual([]);
  });

  it.each([
    ["redirect", 0, `${OLD}${CB}`],
    ["origin", 1, OLD],
  ])(
    "when the board's %s strip doesn't match the last plan: refuses, asks nothing, exits 1",
    async (_, i, to) => {
      const p = applied();
      const run = JSON.parse(p.read(".busbar/run.json"));
      run.board.steps[i].to = to;
      writeFileSync(join(p.dir, ".busbar", "run.json"), JSON.stringify(run));
      const events = p.read(".busbar/events.jsonl");
      stub = await authStub(() => "accepted-signin-identifier");
      const r = await p.bbAsync(["verify", "--wait", "0"], { BB_GOOGLE_AUTH_URL: stub.url });
      expect(r).toEqual({
        code: 1,
        stdout: "",
        stderr:
          "bb: The board's last run doesn't match the last plan, so busbar can't say which strip a check proves. Run `bb plan` again, then `bb verify`.\n",
      });
      expect(stub.requests).toEqual([]);
      expect(p.read(".busbar/events.jsonl")).toBe(events);
    },
  );
});
