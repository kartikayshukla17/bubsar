import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { BB, signedIn } from "./helpers/project";

const NEW = "https://new.ngrok-free.app";
const OLD = "https://old.ngrok-free.app";
const LOCAL = "http://localhost:3000";
const CB = "/api/auth/callback/google";
const CHALLENGE = "https://accounts.google.com/v3/signin/challenge/pwd";

const client = { redirectUris: [`${LOCAL}${CB}`, `${OLD}${CB}`], jsOrigins: [OLD] };
const owned = { redirectUris: [`${OLD}${CB}`], jsOrigins: [OLD] };
const next = { redirectUris: [`${LOCAL}${CB}`, `${NEW}${CB}`], jsOrigins: [NEW] };

const HANDOFF = [
  "",
  "Google wants you to sign in again. busbar opened Brave on its profile at accounts.google.com/v3/signin/challenge/pwd.",
  "Finish there, then press Enter here and busbar reads the client again. Ctrl-C stops here; nothing changes in Google.",
];

const saves = (world: { consoleCalls?: { op: string }[] }) =>
  (world.consoleCalls ?? []).filter((c) => c.op === "save");

const eventsAfterPlan = (read: (f: string) => string) =>
  read(".busbar/events.jsonl")
    .trimEnd()
    .split("\n")
    .map((l) => JSON.parse(l).action)
    .slice(1)
    .map((a: { type: string; id?: string }) => (a.id ? `${a.type} ${a.id}` : a.type));

function planned(google: object = {}) {
  const p = signedIn(client, owned);
  const r = p.bb("plan", "--tunnel", NEW);
  if (r.code !== 0) throw new Error(`bb plan failed: ${r.stderr}`);
  p.setWorld({ ...p.world(), google: { ...p.world().google, ...google } });
  return p;
}

describe("bb apply hands a sign-in to you, then carries on (BB-06)", () => {
  it("a bounce between the edits and Save: opens a plain window, waits for Enter, saves once, lands applied", () => {
    const p = planned({ fail: { reauth: "save" } });
    const attaches = p.world().attachCalls.length;
    const r = p.bbInput("\n", "apply", "--yes");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      [
        "--yes: applying 4 changes without asking.",
        ...HANDOFF,
        "Saved. Google's lists read back exactly as planned.",
      ].join("\n"),
    );

    const world = p.world();
    expect(saves(world)).toHaveLength(1);
    expect(world.google.client).toEqual(next);
    expect(world.openPlainCalls.at(-1)).toEqual({
      browser: "brave",
      profileDir: world.attachCalls[0].profileDir,
      url: CHALLENGE,
    });
    expect(world.attachCalls).toHaveLength(attaches + 2);
    expect(eventsAfterPlan(p.read)).toEqual([
      "start",
      "activate google-redirect-1",
      "activate google-origin-1",
      "handoff google-redirect-1",
      "handoff google-origin-1",
      "plan",
      "start",
      "activate google-redirect-1",
      "activate google-origin-1",
      "settle google-redirect-1",
      "settle google-origin-1",
      "apply-done",
    ]);
    expect(JSON.parse(p.read(".busbar/run.json")).board.phase).toBe("applied");
    expect(JSON.parse(p.read(".busbar/local.json")).google.session).toBe("signed-in");
  });

  it("stdin closed at the handoff: exits 2, the strips stay in Your turn, nothing saved or recorded", () => {
    const p = planned({ fail: { reauth: "save" } });
    const state = p.read(".busbar/state.json");
    const r = p.bbInput("", "apply", "--yes");
    expect(r.stdout).toContain(HANDOFF.join("\n"));
    expect(r.stderr).toBe(
      "bb: Stopped at your turn. Nothing was changed in Google. Run `bb apply` again to carry on.\n",
    );
    expect(r.code).toBe(2);
    expect(saves(p.world())).toEqual([]);
    expect(p.world().google.client).toEqual(client);
    expect(p.read(".busbar/state.json")).toBe(state);
    const { board } = JSON.parse(p.read(".busbar/run.json"));
    expect(board.phase).toBe("handoff");
    for (const strip of Object.values(board.strips))
      expect(strip).toEqual({ bay: "turn", mark: "handoff", fresh: true, note: HANDOFF[1] });
    expect(JSON.parse(p.read(".busbar/local.json")).google.session).toBe("signed-out");
  });

  it("Ctrl-C at the handoff: exits 2, the strips stay in Your turn, nothing saved", async () => {
    const p = planned({ fail: { reauth: "save" } });
    const child = spawn(process.execPath, [BB, "apply", "--yes"], { cwd: p.dir, env: p.env });
    let stdout = "";
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.stdout.on("data", (c) => {
      stdout += c;
      if (stdout.includes(HANDOFF[2])) child.kill("SIGINT");
    });
    const code = await new Promise((done) => child.on("close", done));
    expect(stderr).toBe(
      "bb: Stopped at your turn. Nothing was changed in Google. Run `bb apply` again to carry on.\n",
    );
    expect(code).toBe(2);
    expect(saves(p.world())).toEqual([]);
    const { board } = JSON.parse(p.read(".busbar/run.json"));
    expect(board.phase).toBe("handoff");
    expect(Object.values(board.strips).map((s) => (s as { bay: string }).bay)).toEqual([
      "turn",
      "turn",
    ]);
  });

  it("a bounce at the read-back after a confirmed Save: says the Save went through, records what's known; a re-run records what landed", () => {
    const p = planned({ fail: { reauth: "readback" } });
    const r = p.bbInput("", "apply", "--yes");
    expect(r.stdout).toContain(
      [
        "",
        "Google confirmed the Save, then asked you to sign in again before busbar could read the client back. busbar opened Brave on its profile at accounts.google.com/v3/signin/challenge/pwd.",
        "Finish there, then press Enter here and busbar reads the client back. Ctrl-C stops here; the Save stands.",
      ].join("\n"),
    );
    expect(r.stderr).toBe(
      "bb: Stopped at your turn. Google confirmed the Save, but busbar hasn't read the client back. Run `bb apply` again to read it and record what landed.\n",
    );
    expect(r.code).toBe(2);
    expect(saves(p.world())).toHaveLength(1);
    const known = JSON.parse(p.read(".busbar/state.json")).google;
    expect(known.owned).toEqual({
      redirectUris: [`${OLD}${CB}`, `${NEW}${CB}`],
      jsOrigins: [OLD, NEW],
    });
    expect(known.planned.read).toEqual(client);

    const again = p.bbInput("", "apply", "--yes");
    expect(again.stderr).toBe("");
    expect(again.code).toBe(0);
    expect(again.stdout).toBe(
      [
        "Google already holds exactly the planned lists: an earlier Save landed. busbar recorded its entries and wrote nothing.",
        "4 changes applied: 2 added, 2 removed. Not verified: nothing has checked that Google accepts the new redirect URI yet.",
        "",
      ].join("\n"),
    );
    expect(saves(p.world())).toHaveLength(1);
    const google = JSON.parse(p.read(".busbar/state.json")).google;
    expect(google.owned).toEqual({ redirectUris: [`${NEW}${CB}`], jsOrigins: [NEW] });
    expect(google.planned.read).toEqual(next);
    expect(JSON.parse(p.read(".busbar/run.json")).board.phase).toBe("applied");
  });

  it("when the automated browser won't close: opens no sign-in window on the busy profile, fails, saves nothing", () => {
    const p = planned({ fail: { reauth: "save" } });
    p.setWorld({ ...p.world(), closeFails: "Target closed" });
    const windows = p.world().openPlainCalls.length;
    const r = p.bbInput("\n", "apply", "--yes");
    const message =
      "couldn't close busbar's automated browser: Target closed, so busbar didn't open the sign-in window: the profile is still in use. Quit it, then run the command again.";
    expect(r.stderr).toBe(`bb: ${message}\n`);
    expect(r.code).toBe(1);
    expect(p.world().openPlainCalls).toHaveLength(windows);
    expect(saves(p.world())).toEqual([]);
    expect(eventsAfterPlan(p.read).slice(-2)).toEqual([
      "fail google-redirect-1",
      "fail google-origin-1",
    ]);
  });

  it("two bounces, two Enters piped at once: each answers one handoff, still one Save", () => {
    const p = planned({ fail: { reauth: ["save", "save"] } });
    const windows = p.world().openPlainCalls.length;
    const r = p.bbInput("\n\n", "apply", "--yes");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(p.world().openPlainCalls).toHaveLength(windows + 2);
    expect(saves(p.world())).toHaveLength(1);
  });

  it("a second bounce after a confirmed Save, then a stop: every message still says the Save went through", () => {
    const p = planned({ fail: { reauth: ["readback", "read"] } });
    const r = p.bbInput("\n", "apply", "--yes");
    const note =
      "Google confirmed the Save, then asked you to sign in again before busbar could read the client back. busbar opened Brave on its profile at accounts.google.com/v3/signin/challenge/pwd.";
    expect(r.stdout.split("Ctrl-C stops here; the Save stands.")).toHaveLength(3);
    expect(r.stdout).not.toContain("nothing changes in Google");
    expect(r.stderr).toBe(
      "bb: Stopped at your turn. Google confirmed the Save, but busbar hasn't read the client back. Run `bb apply` again to read it and record what landed.\n",
    );
    expect(r.code).toBe(2);
    expect(saves(p.world())).toHaveLength(1);
    const { board } = JSON.parse(p.read(".busbar/run.json"));
    for (const strip of Object.values(board.strips))
      expect(strip).toEqual({ bay: "turn", mark: "handoff", fresh: true, note });
  });
});

describe("bb plan killed while it waits at a handoff", () => {
  it.each(["SIGKILL", "SIGHUP"] as const)(
    "%s: the earlier plan is already gone, so bb apply can't act on it",
    async (signal) => {
      const p = planned({ session: "signed-out" });
      expect(JSON.parse(p.read(".busbar/state.json")).google.planned).not.toBeNull();
      const child = spawn(
        process.execPath,
        [BB, "plan", "--tunnel", "https://other.ngrok-free.app"],
        {
          cwd: p.dir,
          env: p.env,
        },
      );
      let stdout = "";
      child.stdout.on("data", (c) => {
        stdout += c;
        if (stdout.includes("press Enter here")) child.kill(signal);
      });
      await new Promise((done) => child.on("close", done));
      expect(stdout).toContain("press Enter here");
      expect(JSON.parse(p.read(".busbar/state.json")).google.planned).toBeNull();
      const r = p.bb("apply", "--yes");
      expect(r.stderr).toBe("bb: No plan to apply. Run `bb plan --tunnel <url>` first.\n");
      expect(saves(p.world())).toEqual([]);
    },
  );
});
