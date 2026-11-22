import { afterEach, describe, expect, it } from "vitest";
import { type AuthStub, authStub, deadAuthUrl } from "./helpers/google-auth";
import { project, SAMPLE_TOML, signedIn } from "./helpers/project";

const NEW = "https://new.ngrok-free.app";
const OLD = "https://old.ngrok-free.app";
const LOCAL = "http://localhost:3000";
const CB = "/api/auth/callback/google";

const client = { redirectUris: [`${LOCAL}${CB}`, `${OLD}${CB}`], jsOrigins: [OLD] };
const owned = { redirectUris: [`${OLD}${CB}`], jsOrigins: [OLD] };
const next = { redirectUris: [`${LOCAL}${CB}`, `${NEW}${CB}`], jsOrigins: [NEW] };

type World = { attachCalls?: unknown[]; consoleCalls?: { op: string }[] };
const attaches = (w: World) => (w.attachCalls ?? []).length;
const saves = (w: World) => (w.consoleCalls ?? []).filter((c) => c.op === "save").length;

const events = (read: (f: string) => string) =>
  read(".busbar/events.jsonl")
    .trimEnd()
    .split("\n")
    .map((l) => JSON.parse(l));
const actions = (read: (f: string) => string) =>
  events(read).map(({ action: a }) => (a.id ? `${a.type} ${a.id}` : a.type));

let stub: AuthStub | undefined;

async function rewired() {
  const p = signedIn(client, owned);
  stub = await authStub(() => "accepted-signin-identifier");
  const r = await p.bbAsync(["rewire", "--tunnel", NEW, "--yes", "--wait", "0"], {
    BB_GOOGLE_AUTH_URL: stub.url,
  });
  if (r.code !== 0) throw new Error(`bb rewire failed: ${r.stderr}`);
  return p;
}
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

describe("bb rewire --tunnel <url>", () => {
  it("plans, applies and verifies in one run on one browser session, and exits 0", async () => {
    const p = signedIn(client, owned);
    const before = attaches(p.world());
    stub = await authStub(() => "accepted-signin-identifier");
    const r = await p.bbAsync(["rewire", "--tunnel", NEW, "--yes", "--wait", "0"], {
      BB_GOOGLE_AUTH_URL: stub.url,
    });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^busbar rewire · enquiry-to-paid\n/);
    expect(r.stdout).toContain(
      "4 changes planned: 2 to add, 2 to remove. Nothing has changed yet.\n\n--yes: applying 4 changes without asking.\nSaved. Google's lists read back exactly as planned.\n",
    );
    expect(r.stdout.split("\n").slice(-4)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^Google · redirect URI ${NEW}${CB} · verified \\(Google accepted it \\d\\d:\\d\\d\\)$`,
        ),
      ),
      `Google · JS origin ${NEW} · listed, not exercised`,
      "Removed 2 old entries busbar had added. Kept 1 that isn't busbar's.",
      "",
    ]);

    expect(attaches(p.world()) - before).toBe(1);
    expect(saves(p.world())).toBe(1);
    expect(p.world().google.client).toEqual(next);

    const runs = new Set(events(p.read).map((e) => e.run));
    expect(runs.size).toBe(1);
    expect(actions(p.read)).toEqual([
      "plan",
      "start",
      "activate google-redirect-1",
      "activate google-origin-1",
      "settle google-redirect-1",
      "settle google-origin-1",
      "apply-done",
      "verify-start",
      "check google-redirect-1",
      "checked google-redirect-1",
      "checked google-origin-1",
      "verify-done",
    ]);
    const { board } = JSON.parse(p.read(".busbar/run.json"));
    expect(board.phase).toBe("verified");
    expect(board.strips["google-redirect-1"].mark).toBe("verified");
    expect(board.strips["google-origin-1"].mark).toBe("unexercised");

    const state = JSON.parse(p.read(".busbar/state.json")).google;
    expect(state.owned).toEqual({ redirectUris: [`${NEW}${CB}`], jsOrigins: [NEW] });
    expect(state.checks).toMatchObject([{ uri: `${NEW}${CB}`, result: "accepted", status: 302 }]);
  });

  it.each([
    ["http://new.ngrok-free.app", "it isn't https"],
    ["https://new.ngrok-free.app/app", "it has a path (/app)"],
    ["https://new.ngrok-free.app/?x=1", "it has a query (?x=1)"],
    ["https://new.ngrok-free.app/#top", "it has a fragment (#top)"],
  ])("refuses --tunnel %s before any browser opens, and says why", (tunnel, why) => {
    const p = signedIn(client, owned);
    const before = p.world();
    const r = p.bb("rewire", "--tunnel", tunnel, "--yes", "--wait", "0");
    expect(r).toEqual({
      code: 1,
      stdout: "",
      stderr: `bb: --tunnel ${tunnel}: expected an https origin like https://abcd.ngrok-free.app, but ${why}\n`,
    });
    expect(p.world()).toEqual(before);
    expect(p.read(".busbar/state.json")).toBe(
      JSON.stringify({ google: { owned, planned: null, checks: [] } }),
    );
  });

  it("with the same tunnel as last time (a pasted trailing slash too): already wired, no browser, exits 0", async () => {
    const p = await rewired();
    const world = p.world();
    const files = [".busbar/state.json", ".busbar/run.json", ".busbar/events.jsonl"].map(p.read);
    const r = await p.bbAsync(["rewire", "--tunnel", `${NEW}/`, "--yes", "--wait", "0"], {
      BB_GOOGLE_AUTH_URL: stub?.url ?? "",
    });
    expect(r).toEqual({
      code: 0,
      stderr: "",
      stdout: [
        "Already wired. Run `bb verify` to re-check.",
        `busbar didn't open Google this time: its last read of the client, for this tunnel, already held every entry busbar.toml wants. \`bb plan --tunnel ${NEW}\` reads it again.`,
        "",
      ].join("\n"),
    });
    expect(p.world()).toEqual(world);
    expect(stub?.requests).toHaveLength(1);
    expect([".busbar/state.json", ".busbar/run.json", ".busbar/events.jsonl"].map(p.read)).toEqual(
      files,
    );
  });

  it("with the same tunnel planned but never applied: reads Google and carries on", async () => {
    const p = signedIn(client, owned);
    expect(p.bb("plan", "--tunnel", NEW).code).toBe(0);
    stub = await authStub(() => "accepted-signin-identifier");
    const r = await p.bbAsync(["rewire", "--tunnel", NEW, "--yes", "--wait", "0"], {
      BB_GOOGLE_AUTH_URL: stub.url,
    });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("Already wired");
    expect(saves(p.world())).toBe(1);
    expect(p.world().google.client).toEqual(next);
  });

  it("when Google already holds what busbar.toml wants but state.json can't say so: reads, says already wired but never checked, exits 3", async () => {
    const p = signedIn(next, { redirectUris: [], jsOrigins: [] });
    const before = attaches(p.world());
    const r = p.bb("rewire", "--tunnel", NEW, "--yes", "--wait", "0");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(3);
    expect(r.stdout).toMatch(/^busbar rewire · enquiry-to-paid\n/);
    expect(r.stdout).toContain(
      `Nothing to change: the client already has what busbar.toml declares.\n\nAlready wired, but busbar hasn't checked ${NEW}${CB} with Google yet. Run \`bb verify\` to check.\n`,
    );
    expect(r.stdout.endsWith("Run `bb verify` to check.\n")).toBe(true);
    expect(attaches(p.world()) - before).toBe(1);
    expect(saves(p.world())).toBe(0);
    expect(actions(p.read)).toEqual(["plan"]);
  });

  it("with the same tunnel already on the client but an old entry of busbar's still to remove: not wired, removes it", async () => {
    const both = {
      redirectUris: [`${LOCAL}${CB}`, `${OLD}${CB}`, `${NEW}${CB}`],
      jsOrigins: [OLD, NEW],
    };
    const p = signedIn(both, owned);
    expect(p.bb("plan", "--tunnel", NEW).code).toBe(0);
    stub = await authStub(() => "accepted-signin-identifier");
    const r = await p.bbAsync(["rewire", "--tunnel", NEW, "--yes", "--wait", "0"], {
      BB_GOOGLE_AUTH_URL: stub.url,
    });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("Already wired");
    expect(p.world().google.client).toEqual({
      redirectUris: [`${LOCAL}${CB}`, `${NEW}${CB}`],
      jsOrigins: [NEW],
    });
  });
});

describe("bb rewire exit codes", () => {
  const strips = (read: (f: string) => string) =>
    Object.values(JSON.parse(read(".busbar/run.json")).board.strips) as {
      bay: string;
      mark: string;
    }[];

  it("2 when you stop at a handoff: strips in Your turn, nothing saved, no check", () => {
    const p = signedIn(client, owned, { fail: { reauth: "save" } });
    const r = p.bbInput("", "rewire", "--tunnel", NEW, "--yes", "--wait", "0");
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(
      `bb: Stopped at your turn. Nothing was changed in Google. Run \`bb rewire --tunnel ${NEW}\` again to carry on.\n`,
    );
    expect(saves(p.world())).toBe(0);
    expect(strips(p.read).map((s) => s.bay)).toEqual(["turn", "turn"]);
    expect(actions(p.read)).not.toContain("verify-start");
    expect(JSON.parse(p.read(".busbar/state.json")).google.checks).toEqual([]);
  });

  it("0 after a handoff you finish: re-attaches once, saves once, verifies", async () => {
    const p = signedIn(client, owned, { fail: { reauth: "save" } });
    const before = attaches(p.world());
    const windows = (p.world().openPlainCalls ?? []).length;
    stub = await authStub(() => "accepted-signin-identifier");
    const r = await p.bbAsync(
      ["rewire", "--tunnel", NEW, "--yes", "--wait", "0"],
      { BB_GOOGLE_AUTH_URL: stub.url },
      "\n",
    );
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(attaches(p.world()) - before).toBe(2);
    expect(p.world().openPlainCalls).toHaveLength(windows + 1);
    expect(saves(p.world())).toBe(1);
    expect(JSON.parse(p.read(".busbar/run.json")).board.phase).toBe("verified");
  });

  it("2 when you stop at a handoff before busbar could read the client", () => {
    const p = signedIn(client, owned, { fail: { reauth: "read" } });
    const r = p.bbInput("", "rewire", "--tunnel", NEW, "--yes", "--wait", "0");
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(
      `bb: Stopped at your turn, before busbar could read the client. Nothing was changed in Google. Run \`bb rewire --tunnel ${NEW}\` again to carry on.\n`,
    );
    expect(JSON.parse(p.read(".busbar/state.json")).google.planned).toBeNull();
    expect(saves(p.world())).toBe(0);
  });

  it("3 when busbar can't tell whether Google accepts it: unknown, never verified", async () => {
    const p = signedIn(client, owned);
    const r = await p.bbAsync(["rewire", "--tunnel", NEW, "--yes", "--wait", "0"], {
      BB_GOOGLE_AUTH_URL: await deadAuthUrl(),
    });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(3);
    expect(r.stdout).toMatch(
      new RegExp(
        `\nGoogle · redirect URI ${NEW}${CB} · unknown, not verified \\(busbar couldn't reach Google \\(.+\\)\\)\\. Re-run \`bb verify\`\\.\n`,
      ),
    );
    expect(r.stdout).not.toMatch(/· verified/);
    const { board } = JSON.parse(p.read(".busbar/run.json"));
    expect(board.phase).toBe("unverified");
    expect(board.strips["google-redirect-1"].mark).toBe("unknown");
  });

  it("3 when Google hasn't accepted it yet", async () => {
    const p = signedIn(client, owned);
    stub = await authStub(() => "mismatch-error-redirect");
    const r = await p.bbAsync(["rewire", "--tunnel", NEW, "--yes", "--wait", "0"], {
      BB_GOOGLE_AUTH_URL: stub.url,
    });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(3);
    expect(r.stdout).toMatch(
      new RegExp(
        `\nGoogle · redirect URI ${NEW}${CB} · not accepted yet \\(Google answered redirect_uri_mismatch at \\d\\d:\\d\\d\\)\\. Re-run \`bb verify\` later\\.\n`,
      ),
    );
    expect(JSON.parse(p.read(".busbar/run.json")).board.phase).toBe("unverified");
  });

  it("1 when Google refuses the Save: failed strips, no check", async () => {
    const p = signedIn(client, owned, {
      fail: { saveError: "Invalid Redirect: must end with a public top-level domain" },
    });
    stub = await authStub(() => "accepted-signin-identifier");
    const r = await p.bbAsync(["rewire", "--tunnel", NEW, "--yes", "--wait", "0"], {
      BB_GOOGLE_AUTH_URL: stub.url,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(
      "bb: Google didn't save the client: Invalid Redirect: must end with a public top-level domain\n",
    );
    expect(stub.requests).toEqual([]);
    expect(strips(p.read).map((s) => s.mark)).toEqual(["failed", "failed"]);
  });

  it("1 when there's no terminal to confirm in and no --yes: prints the plan, saves nothing", async () => {
    const p = signedIn(client, owned);
    const r = await p.bbAsync(["rewire", "--tunnel", NEW, "--wait", "0"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      "4 changes planned: 2 to add, 2 to remove. Nothing has changed yet.",
    );
    expect(r.stderr).toBe(
      `bb: Not applied: there's no terminal to confirm in. Run \`bb rewire --tunnel ${NEW} --yes\` to apply without asking.\n`,
    );
    expect(saves(p.world())).toBe(0);
  });

  it("0 when Google takes a moment: --wait 1 asks again after the mismatch, then it's verified", async () => {
    const p = signedIn(client, owned);
    stub = await authStub((_, nth) =>
      nth === 0 ? "mismatch-error-redirect" : "accepted-signin-identifier",
    );
    const t0 = Date.now();
    const r = await p.bbAsync(["rewire", "--tunnel", NEW, "--yes", "--wait", "1"], {
      BB_GOOGLE_AUTH_URL: stub.url,
    });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      `Google hasn't accepted ${NEW}${CB} yet: waiting for Google to pick up the change. Asking again in 1s.\n`,
    );
    expect(r.stdout).toMatch(/· verified \(Google accepted it \d\d:\d\d\)\n/);
    expect(stub.requests).toHaveLength(2);
    expect(JSON.parse(p.read(".busbar/state.json")).google.checks).toMatchObject([
      { uri: `${NEW}${CB}`, result: "rejected" },
      { uri: `${NEW}${CB}`, result: "accepted" },
    ]);
    const notes = events(p.read)
      .map((e) => e.action)
      .filter((a) => a.type === "check")
      .map((a) => a.note);
    expect(notes).toEqual([
      "Asking Google whether it accepts this redirect URI",
      "waiting for Google to pick up the change",
    ]);
    expect(JSON.parse(p.read(".busbar/run.json")).board.phase).toBe("verified");
  });
});

describe("bb rewire refuses before any browser", () => {
  it.each([
    ["no [destinations] table", SAMPLE_TOML.slice(0, SAMPLE_TOML.indexOf("[destinations.google]"))],
    [
      "an empty [destinations] table",
      SAMPLE_TOML.replace(/\[destinations\.google\][\s\S]*$/, "[destinations]\n"),
    ],
  ])("with %s: says there's nothing to rewire, exits 0", (_, toml) => {
    const p = project(toml, { browsers: ["brave"], google: { session: "signed-in" } });
    expect(p.bb("rewire", "--tunnel", NEW, "--yes")).toEqual({
      code: 0,
      stderr: "",
      stdout:
        "Nothing to rewire: busbar.toml has no Google destination. Add a [destinations.google] table.\n",
    });
    expect(p.world().attachCalls).toBeUndefined();
  });

  it("before bb login google: says to log in, starts nothing, exits 1", () => {
    const p = project(undefined, { browsers: ["brave"], google: { session: "signed-in" } });
    expect(p.bb("rewire", "--tunnel", NEW, "--yes")).toEqual({
      code: 1,
      stdout: "",
      stderr: `bb: busbar isn't logged in to Google in this project. Run \`bb login google\`, then \`bb rewire --tunnel ${NEW}\`.\n`,
    });
    expect(p.world().attachCalls).toBeUndefined();
    expect(p.world().openPlainCalls).toBeUndefined();
  });
});

describe("bb rewire with the same tunnel: the exit code follows the last recorded check", () => {
  const basis = `busbar didn't open Google this time: its last read of the client, for this tunnel, already held every entry busbar.toml wants. \`bb plan --tunnel ${NEW}\` reads it again.`;

  it("3 when Google hadn't accepted the redirect URI: no browser, no request", async () => {
    const p = signedIn(client, owned);
    stub = await authStub(() => "mismatch-error-redirect");
    const env = { BB_GOOGLE_AUTH_URL: stub.url };
    const first = await p.bbAsync(["rewire", "--tunnel", NEW, "--yes", "--wait", "0"], env);
    expect(first.code).toBe(3);
    const world = p.world();
    const asked = stub.requests.length;

    const r = await p.bbAsync(["rewire", "--tunnel", NEW, "--yes", "--wait", "0"], env);
    expect(r).toEqual({
      code: 3,
      stderr: "",
      stdout: [
        `Already wired, but Google hasn't accepted ${NEW}${CB} yet. Run \`bb verify\` to check again.`,
        basis,
        "",
      ].join("\n"),
    });
    expect(p.world()).toEqual(world);
    expect(stub.requests).toHaveLength(asked);
  });

  it("3 when busbar never checked it: applied, not verified", () => {
    const p = signedIn(client, owned);
    expect(p.bb("plan", "--tunnel", NEW).code).toBe(0);
    expect(p.bb("apply", "--yes").code).toBe(0);
    const world = p.world();
    const r = p.bb("rewire", "--tunnel", NEW, "--yes", "--wait", "0");
    expect(r).toEqual({
      code: 3,
      stderr: "",
      stdout: [
        `Already wired, but busbar hasn't checked ${NEW}${CB} with Google yet. Run \`bb verify\` to check.`,
        basis,
        "",
      ].join("\n"),
    });
    expect(p.world()).toEqual(world);
  });
});
