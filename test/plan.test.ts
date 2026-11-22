import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { project } from "./helpers/project";

// `bb plan` against the fake world (BB_FAKE): the Google client's lists, the session and
// scripted failures live in the world file, so no browser and no Google are involved.

const NEW = "https://new.ngrok-free.app";
const OLD = "https://old.ngrok-free.app";
const LOCAL = "http://localhost:3000";
const CB = "/api/auth/callback/google";
const none = { redirectUris: [], jsOrigins: [] };

/**
 * A project that ran `bb login google` with Brave, whose OAuth client shows `client`, and
 * whose .busbar/state.json says busbar owns `owned`.
 */
function signedIn(client: object, owned: object = none, google: object = {}) {
  const p = project(undefined, { browsers: ["brave"], google: { session: "signed-out" } });
  expect(p.bb("login", "google").code).toBe(0);
  p.setWorld({ ...p.world(), google: { ...p.world().google, client, ...google } });
  mkdirSync(join(p.dir, ".busbar"), { recursive: true });
  writeFileSync(
    join(p.dir, ".busbar", "state.json"),
    JSON.stringify({ google: { owned, planned: null, checks: [] } }),
  );
  return p;
}

describe("bb plan before bb login google", () => {
  it("plans the declared entries as unknown, says how to read them, and starts no browser", () => {
    const p = project(undefined, { browsers: ["brave"], google: { session: "signed-in" } });
    const r = p.bb("plan", "--tunnel", NEW);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(
      /01 +Authorized redirect URI +unknown → https:\/\/new\.ngrok-free\.app/,
    );
    expect(r.stdout).toContain(`unknown → ${NEW}${CB}`);
    expect(r.stdout).toContain(
      "Current entries show as unknown: busbar hasn't read the console. Run bb login google, then bb plan again.",
    );
    expect(p.world().attachCalls).toBeUndefined();
  });
});

describe("bb plan, signed in", () => {
  it("reads the client and prints per list what it adds, removes and keeps, in full", () => {
    const p = signedIn(
      { redirectUris: [`${LOCAL}${CB}`, `${OLD}${CB}`], jsOrigins: [OLD] },
      { redirectUris: [`${OLD}${CB}`], jsOrigins: [OLD] },
    );
    const r = p.bb("plan", "--tunnel", NEW);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      [
        "busbar plan · enquiry-to-paid",
        "",
        "Google · OAuth web client 1234-abc.apps.googleusercontent.com in my-sandbox-123",
        "Read just now from the Cloud console in busbar's Brave profile.",
        "",
        "Authorized redirect URIs",
        "  add     https://new.ngrok-free.app/api/auth/callback/google",
        "  remove  https://old.ngrok-free.app/api/auth/callback/google  busbar added it",
        "  keep    http://localhost:3000/api/auth/callback/google       not busbar's",
        "",
        "Authorized JavaScript origins",
        "  add     https://new.ngrok-free.app",
        "  remove  https://old.ngrok-free.app                           busbar added it",
        "",
        "4 changes planned: 2 to add, 2 to remove. Nothing has changed yet.",
        "",
      ].join("\n"),
    );
  });

  it("records what it read for bb apply and the board, and changes nothing in Google", () => {
    const client = { redirectUris: [`${LOCAL}${CB}`, `${OLD}${CB}`], jsOrigins: [OLD] };
    const owned = { redirectUris: [`${OLD}${CB}`], jsOrigins: [OLD] };
    const p = signedIn(client, owned);
    expect(p.bb("plan", "--tunnel", NEW).code).toBe(0);

    const world = p.world();
    expect(world.consoleCalls).toEqual([
      {
        op: "read",
        url: "https://console.cloud.google.com/auth/clients/1234-abc.apps.googleusercontent.com?project=my-sandbox-123",
      },
    ]);
    expect(world.attachCalls.at(-1)).toMatchObject({ browser: "brave", headless: false });
    expect(world.google.client).toEqual(client);

    expect(JSON.parse(p.read(".busbar/state.json"))).toEqual({
      google: {
        owned,
        planned: {
          read: client,
          next: { redirectUris: [`${LOCAL}${CB}`, `${NEW}${CB}`], jsOrigins: [NEW] },
        },
        checks: [],
      },
    });
    expect(JSON.parse(p.read(".busbar/local.json")).google.session).toBe("signed-in");

    const run = JSON.parse(p.read(".busbar/run.json"));
    expect(
      run.board.steps.map(({ id, from, to }: { id: string; from: string; to: string }) => ({
        id,
        from,
        to,
      })),
    ).toEqual([
      { id: "google-redirect-1", from: `${OLD}${CB}`, to: `${NEW}${CB}` },
      { id: "google-origin-1", from: OLD, to: NEW },
    ]);
  });
});

describe("bb plan: entries busbar didn't add", () => {
  const STALE = "https://x.ngrok-free.app";
  const client = { redirectUris: [`${LOCAL}${CB}`, `${STALE}${CB}`], jsOrigins: [NEW] };

  it("keeps a hand-added entry, and flags one on a tunnel host as likely stale", () => {
    const p = signedIn(client);
    const r = p.bb("plan", "--tunnel", NEW);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      [
        "Authorized redirect URIs",
        "  add           https://new.ngrok-free.app/api/auth/callback/google",
        "  keep          http://localhost:3000/api/auth/callback/google       not busbar's",
        "  likely stale  https://x.ngrok-free.app/api/auth/callback/google    not busbar's",
        "",
        "Authorized JavaScript origins",
        "  keep          https://new.ngrok-free.app                           already there",
        "",
        "1 change planned: 1 to add, 0 to remove. Nothing has changed yet.",
        "1 likely stale entry kept: on a tunnel host, but busbar didn't add it. bb plan --adopt hands it to busbar to remove.",
      ].join("\n"),
    );
    const run = JSON.parse(p.read(".busbar/run.json"));
    expect(run.board.steps).toEqual([
      expect.objectContaining({
        id: "google-redirect-1",
        from: "",
        to: `${NEW}${CB}`,
        note: `Likely stale, kept: ${STALE}${CB}`,
      }),
    ]);
  });

  it("with --adopt, plans the likely-stale entry's removal and still keeps the rest", () => {
    const p = signedIn(client);
    const r = p.bb("plan", "--tunnel", NEW, "--adopt");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      "  remove  https://x.ngrok-free.app/api/auth/callback/google    adopted with --adopt\n",
    );
    expect(r.stdout).toContain(
      "2 changes planned: 1 to add, 1 to remove. Nothing has changed yet.\n",
    );
    expect(r.stdout).not.toContain("likely stale");
    expect(JSON.parse(p.read(".busbar/state.json")).google.planned.next).toEqual({
      redirectUris: [`${LOCAL}${CB}`, `${NEW}${CB}`],
      jsOrigins: [NEW],
    });
    const run = JSON.parse(p.read(".busbar/run.json"));
    expect(run.board.steps.map((s: { from: string; to: string }) => [s.from, s.to])).toEqual([
      [`${STALE}${CB}`, `${NEW}${CB}`],
    ]);
  });

  it("says so when there is nothing to change", () => {
    const p = signedIn({ redirectUris: [`${NEW}${CB}`], jsOrigins: [NEW] });
    const r = p.bb("plan", "--tunnel", NEW);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      "Nothing to change: the client already has what busbar.toml declares.\n",
    );
    expect(JSON.parse(p.read(".busbar/run.json")).board.steps).toEqual([]);
  });
});

/** Every file in .busbar/ with its contents, to prove a failed plan wrote nothing. */
const snapshot = (dir: string) =>
  Object.fromEntries(
    readdirSync(join(dir, ".busbar")).map((f) => [
      f,
      readFileSync(join(dir, ".busbar", f), "utf8"),
    ]),
  );

describe("bb plan fails closed", () => {
  const client = { redirectUris: [`${OLD}${CB}`], jsOrigins: [OLD] };
  const owned = { redirectUris: [`${OLD}${CB}`], jsOrigins: [] };

  /**
   * A project whose last `bb plan` (for an older tunnel) succeeded, so state.json holds a
   * plan; then the console is scripted to fail with `google`.
   */
  function planned(google: object) {
    const p = signedIn(client, owned);
    expect(p.bb("plan", "--tunnel", OLD).code).toBe(0);
    expect(JSON.parse(p.read(".busbar/state.json")).google.planned).not.toBeNull();
    p.setWorld({ ...p.world(), google: { ...p.world().google, ...google } });
    return p;
  }

  /** Every .busbar/ file unchanged, except state.json, whose only change is planned → null. */
  function expectOnlyPlanDropped(
    dir: string,
    before: Record<string, string>,
    except: string[] = [],
  ) {
    const after = snapshot(dir);
    const { "state.json": was, ...rest } = before;
    const { "state.json": now, ...restAfter } = after;
    for (const f of except) {
      delete rest[f];
      delete restAfter[f];
    }
    expect(restAfter).toEqual(rest);
    const old = JSON.parse(was);
    expect(JSON.parse(now)).toEqual({ ...old, google: { ...old.google, planned: null } });
  }

  it("when a recorded selector isn't found: names it, exits 1, drops the stale plan, writes nothing else", () => {
    const p = planned({ fail: { missingSelector: "redirectUris" } });
    const before = snapshot(p.dir);
    const r = p.bb("plan", "--tunnel", NEW);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(
      "bb: Google console layout changed: `redirectUris` not found. Nothing was changed.\n",
    );
    expect(r.code).toBe(1);
    expectOnlyPlanDropped(p.dir, before);
    expect(p.world().google.client).toEqual(client);
  });

  it.each([
    ["the session has expired", { session: "signed-out" }],
    ["the client page bounces to sign-in", { fail: { reauth: "read" } }],
  ])("when %s: says to log in again, exits 1, drops the stale plan", (_, google) => {
    const p = planned(google);
    const before = snapshot(p.dir);
    const r = p.bb("plan", "--tunnel", NEW);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("bb: session expired; run `bb login google`\n");
    expect(r.code).toBe(1);
    // The board's session chip tells the truth about the profile: local.json is the one
    // other file a bounce to sign-in rewrites.
    expectOnlyPlanDropped(p.dir, before, ["local.json"]);
    expect(JSON.parse(p.read(".busbar/local.json")).google.session).toBe("signed-out");
  });

  it("with --debug, saves a screenshot only you can read, and warns what it may show", () => {
    const p = signedIn(client, owned, { fail: { missingSelector: "jsOriginInputs" } });
    expect(p.bb("plan", "--tunnel", NEW).code).toBe(1);
    expect(existsSync(join(p.dir, ".busbar", "debug"))).toBe(false);

    const r = p.bb("plan", "--tunnel", NEW, "--debug");
    expect(r.code).toBe(1);
    const [shot] = readdirSync(join(p.dir, ".busbar", "debug"));
    expect(shot).toMatch(/^plan-[\dT-]+Z\.png$/);
    expect(r.stderr).toBe(
      [
        `bb: --debug: saved a screenshot of the console page to .busbar/debug/${shot} (readable only by you).`,
        "    It may show partial client details. Delete it when you're done.",
        "bb: Google console layout changed: `jsOriginInputs` not found. Nothing was changed.",
        "",
      ].join("\n"),
    );
    const mode = (f: string) => statSync(join(p.dir, ".busbar", f)).mode & 0o777;
    expect(mode("debug")).toBe(0o700);
    expect(mode(`debug/${shot}`)).toBe(0o600);
    expect(
      readFileSync(join(p.dir, ".busbar", "debug", shot))
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");
  });

  it("when the browser busbar logged in with was uninstalled: says so, starts nothing", () => {
    const p = signedIn(client, owned);
    p.setWorld({ ...p.world(), browsers: [] });
    const r = p.bb("plan", "--tunnel", NEW);
    expect(r.stderr).toBe(
      "bb: Brave isn't installed any more, so busbar can't read Google. Run bb login google to pick another.\n",
    );
    expect(r.code).toBe(1);
    expect(p.world().consoleCalls).toBeUndefined();
  });

  it("when state.json's ownership isn't two lists: refuses before starting a browser", () => {
    const p = signedIn(client, { redirectUris: "everything" });
    const r = p.bb("plan", "--tunnel", NEW);
    expect(r.stderr).toBe(
      "bb: .busbar/state.json: google.owned should hold two lists of URLs, redirectUris and jsOrigins. Fix it, or delete the file and busbar treats no entry as its own.\n",
    );
    expect(r.code).toBe(1);
    expect(p.world().consoleCalls).toBeUndefined();
  });
});

describe("bb plan after bb logout google", () => {
  it("drops the earlier read plan, so nothing can apply it", () => {
    const p = signedIn({ redirectUris: [], jsOrigins: [] });
    expect(p.bb("plan", "--tunnel", NEW).code).toBe(0);
    expect(JSON.parse(p.read(".busbar/state.json")).google.planned).not.toBeNull();
    expect(p.bb("logout", "google").code).toBe(0);

    const r = p.bb("plan", "--tunnel", NEW);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`unknown → ${NEW}`);
    expect(JSON.parse(p.read(".busbar/state.json")).google).toEqual({
      owned: none,
      planned: null,
      checks: [],
    });
  });
});
