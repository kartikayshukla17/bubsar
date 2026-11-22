import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { signedIn } from "./helpers/project";

const NEW = "https://new.ngrok-free.app";
const OLD = "https://old.ngrok-free.app";
const LOCAL = "http://localhost:3000";
const CB = "/api/auth/callback/google";

const calls = (world: { consoleCalls?: { op: string }[] }, op: string) =>
  (world.consoleCalls ?? []).filter((c) => c.op === op);

describe("bb apply refuses without a plan to act on", () => {
  it("with no plan: says to run bb plan, starts no browser, exits 1", () => {
    const p = signedIn({ redirectUris: [`${OLD}${CB}`], jsOrigins: [OLD] });
    const r = p.bb("apply", "--yes");
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("bb: No plan to apply. Run `bb plan --tunnel <url>` first.\n");
    expect(r.code).toBe(1);
    expect(p.world().attachCalls).toHaveLength(1); // bb login's session check only
    expect(calls(p.world(), "read")).toEqual([]);
  });
});

const eventsAfterPlan = (read: (f: string) => string) =>
  read(".busbar/events.jsonl")
    .trimEnd()
    .split("\n")
    .map((l) => JSON.parse(l).action)
    .slice(1)
    .map((a: { type: string; id?: string }) => (a.id ? `${a.type} ${a.id}` : a.type));

const client = { redirectUris: [`${LOCAL}${CB}`, `${OLD}${CB}`], jsOrigins: [OLD] };
const owned = { redirectUris: [`${OLD}${CB}`], jsOrigins: [OLD] };
const next = { redirectUris: [`${LOCAL}${CB}`, `${NEW}${CB}`], jsOrigins: [NEW] };

function planned(google: object = {}) {
  const p = signedIn(client, owned, google);
  const r = p.bb("plan", "--tunnel", NEW);
  if (r.code !== 0) throw new Error(`bb plan failed: ${r.stderr}`);
  return p;
}

const PLAN_LINES = [
  "busbar apply · enquiry-to-paid",
  "",
  "Google · OAuth web client 1234-abc.apps.googleusercontent.com in my-sandbox-123",
  "Read again just now in busbar's Brave profile: unchanged since bb plan.",
  "",
  "Authorized redirect URIs",
  "  add     https://new.ngrok-free.app/api/auth/callback/google",
  "  remove  https://old.ngrok-free.app/api/auth/callback/google",
  "",
  "Authorized JavaScript origins",
  "  add     https://new.ngrok-free.app",
  "  remove  https://old.ngrok-free.app",
  "",
];

describe("bb apply --yes", () => {
  it("re-reads, prints the plan, saves once, reads back, and lands applied, not verified", () => {
    const p = planned();
    const r = p.bb("apply", "--yes");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      [
        ...PLAN_LINES,
        "--yes: applying 4 changes without asking.",
        "Saved. Google's lists read back exactly as planned.",
        "4 changes applied: 2 added, 2 removed. Not verified: nothing has checked that Google accepts the new redirect URI yet.",
        "",
      ].join("\n"),
    );

    const world = p.world();
    expect(world.google.client).toEqual(next);
    expect(calls(world, "save")).toHaveLength(1);
    expect(calls(world, "save")[0]).toMatchObject({ lists: next });

    expect(JSON.parse(p.read(".busbar/state.json")).google).toEqual({
      owned: { redirectUris: [`${NEW}${CB}`], jsOrigins: [NEW] },
      planned: {
        values: { "tunnel.url": NEW },
        desired: { redirectUris: [`${NEW}${CB}`], jsOrigins: [NEW] },
        read: next,
        next,
      },
      checks: [],
    });

    expect(eventsAfterPlan(p.read)).toEqual([
      "start",
      "activate google-redirect-1",
      "activate google-origin-1",
      "settle google-redirect-1",
      "settle google-origin-1",
      "apply-done",
    ]);
    const { board } = JSON.parse(p.read(".busbar/run.json"));
    expect(board.phase).toBe("applied");
    expect(Object.values(board.strips)).toEqual([
      { bay: "cleared", mark: "applied", fresh: true },
      { bay: "cleared", mark: "applied", fresh: true },
    ]);
  });

  it("starts a run for the board when .busbar/ has none", () => {
    const p = planned();
    rmSync(join(p.dir, ".busbar", "run.json"));
    rmSync(join(p.dir, ".busbar", "events.jsonl"));
    expect(p.bb("apply", "--yes").code).toBe(0);
    const types = p
      .read(".busbar/events.jsonl")
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l).action.type);
    expect(types).toEqual([
      "plan",
      "start",
      "activate",
      "activate",
      "settle",
      "settle",
      "apply-done",
    ]);
    const { board } = JSON.parse(p.read(".busbar/run.json"));
    expect(
      board.steps.map((s: { id: string; from: string; to: string }) => [s.id, s.from, s.to]),
    ).toEqual([
      ["google-redirect-1", `${OLD}${CB}`, `${NEW}${CB}`],
      ["google-origin-1", OLD, NEW],
    ]);
    expect(board.phase).toBe("applied");
  });

  it("a second apply has nothing to do: says so and launches no browser", () => {
    const p = planned();
    expect(p.bb("apply", "--yes").code).toBe(0);
    const world = p.world();
    const busbar = ["state.json", "run.json", "events.jsonl"].map((f) => p.read(`.busbar/${f}`));
    const r = p.bb("apply", "--yes");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      "Nothing to apply: the last plan has no changes left. Run `bb plan` to read Google again.\n",
    );
    expect(p.world()).toEqual(world);
    expect(["state.json", "run.json", "events.jsonl"].map((f) => p.read(`.busbar/${f}`))).toEqual(
      busbar,
    );
  });
});

describe("bb apply's confirm gate", () => {
  it("with no terminal and no --yes: prints the plan, refuses, saves nothing, exits 1", () => {
    const p = planned();
    const run = p.read(".busbar/run.json");
    const r = p.bb("apply");
    expect(r.stdout).toBe(`${PLAN_LINES.join("\n")}\n`);
    expect(r.stderr).toBe(
      "bb: Not applied: there's no terminal to confirm in. Run `bb apply --yes` to apply without asking.\n",
    );
    expect(r.code).toBe(1);
    expect(calls(p.world(), "save")).toEqual([]);
    expect(p.world().google.client).toEqual(client);
    expect(p.read(".busbar/run.json")).toBe(run);
  });
});

describe("bb apply refuses a plan that no longer holds", () => {
  it("after bb logout google: says to log in, starts no browser", () => {
    const p = planned();
    expect(p.bb("logout", "google").code).toBe(0);
    const attaches = p.world().attachCalls.length;
    const r = p.bb("apply", "--yes");
    expect(r.stderr).toBe(
      "bb: busbar isn't logged in to Google in this project. Run `bb login google`, then `bb plan` again.\n",
    );
    expect(r.code).toBe(1);
    expect(p.world().attachCalls).toHaveLength(attaches);
  });

  it("when the console changed since bb plan: says so, saves nothing, exits 1", () => {
    const p = planned();
    const edited = { ...client, jsOrigins: [OLD, "https://hand.example.com"] };
    p.setWorld({ ...p.world(), google: { ...p.world().google, client: edited } });
    const run = p.read(".busbar/run.json");
    const r = p.bb("apply", "--yes");
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("bb: Google changed since you planned. Run `bb plan` again.\n");
    expect(r.code).toBe(1);
    expect(calls(p.world(), "save")).toEqual([]);
    expect(p.world().google.client).toEqual(edited);
    expect(p.read(".busbar/run.json")).toBe(run);
  });

  it("when busbar.toml changed since bb plan: says so before starting a browser", () => {
    const p = planned();
    const attaches = p.world().attachCalls.length;
    const toml = p
      .read("busbar.toml")
      .replace(
        'js_origins    = ["{tunnel.url}"]',
        'js_origins    = ["{tunnel.url}", "http://localhost:5173"]',
      );
    writeFileSync(join(p.dir, "busbar.toml"), toml);
    const r = p.bb("apply", "--yes");
    expect(r.stderr).toBe("bb: busbar.toml changed since you planned. Run `bb plan` again.\n");
    expect(r.code).toBe(1);
    expect(p.world().attachCalls).toHaveLength(attaches);
    expect(calls(p.world(), "save")).toEqual([]);
  });
});

describe("bb apply when the write fails", () => {
  const REFUSED =
    "Invalid Redirect: must end with a public top-level domain (such as .com or .org).";

  it("a Save Google refuses ends failed, in Google's words, never applied", () => {
    const p = planned({ fail: { saveError: REFUSED } });
    const state = p.read(".busbar/state.json");
    const r = p.bb("apply", "--yes");
    expect(r.stderr).toBe(`bb: Google didn't save the client: ${REFUSED}\n`);
    expect(r.code).toBe(1);
    expect(r.stdout).not.toContain("applied");
    expect(calls(p.world(), "save")).toHaveLength(1);
    expect(p.world().google.client).toEqual(client);
    expect(p.read(".busbar/state.json")).toBe(state);
    expect(eventsAfterPlan(p.read)).toEqual([
      "start",
      "activate google-redirect-1",
      "activate google-origin-1",
      "fail google-redirect-1",
      "fail google-origin-1",
    ]);
    const { board } = JSON.parse(p.read(".busbar/run.json"));
    expect(board.phase).toBe("failed");
    for (const strip of Object.values(board.strips))
      expect(strip).toEqual({
        bay: "active",
        mark: "failed",
        fresh: true,
        note: `Google didn't save the client: ${REFUSED}`,
      });
  });

  it("a bounce to sign-in at the re-read fails the strips, records signed out, saves nothing", () => {
    const p = planned();
    p.setWorld({ ...p.world(), google: { ...p.world().google, session: "signed-out" } });
    const r = p.bb("apply", "--yes");
    expect(r.stderr).toBe("bb: session expired; run `bb login google`\n");
    expect(r.code).toBe(1);
    expect(calls(p.world(), "save")).toEqual([]);
    expect(JSON.parse(p.read(".busbar/local.json")).google.session).toBe("signed-out");
    expect(eventsAfterPlan(p.read)).toEqual(["fail google-redirect-1", "fail google-origin-1"]);
  });

  it("a read-back that differs from the plan ends failed, and ownership follows what Google holds", () => {
    const savedAs = { redirectUris: [`${LOCAL}${CB}`, `${OLD}${CB}`], jsOrigins: [NEW] };
    const p = planned({ fail: { savedAs } });
    const r = p.bb("apply", "--yes");
    const message = `Saved, but Google shows a different list: Authorized redirect URIs are ${LOCAL}${CB}, ${OLD}${CB} (planned: ${LOCAL}${CB}, ${NEW}${CB}).`;
    expect(r.stderr).toBe(`bb: ${message}\n`);
    expect(r.code).toBe(1);
    const google = JSON.parse(p.read(".busbar/state.json")).google;
    expect(google.owned).toEqual({ redirectUris: [`${OLD}${CB}`], jsOrigins: [NEW] });
    expect(google.planned.read).toEqual(client);
    const { board } = JSON.parse(p.read(".busbar/run.json"));
    expect(board.phase).toBe("failed");
    expect(Object.values(board.strips).map((s) => (s as { note: string }).note)).toEqual([
      message,
      message,
    ]);
  });
});
