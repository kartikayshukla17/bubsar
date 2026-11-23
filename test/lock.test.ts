import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AuthStub, authStub } from "./helpers/google-auth";
import { BB, signedIn } from "./helpers/project";

const NEW = "https://new.ngrok-free.app";
const OLD = "https://old.ngrok-free.app";
const LOCAL = "http://localhost:3000";
const CB = "/api/auth/callback/google";

const client = { redirectUris: [`${LOCAL}${CB}`, `${OLD}${CB}`], jsOrigins: [OLD] };
const owned = { redirectUris: [`${OLD}${CB}`], jsOrigins: [OLD] };

function planned(google: object = {}) {
  const p = signedIn(client, owned);
  const r = p.bb("plan", "--tunnel", NEW);
  if (r.code !== 0) throw new Error(`bb plan failed: ${r.stderr}`);
  p.setWorld({ ...p.world(), google: { ...p.world().google, ...google } });
  return p;
}

/** `bb` left running with stdin open; `until` resolves once its stdout shows `text`. */
function running(dir: string, env: NodeJS.ProcessEnv, args: string[]) {
  const child: ChildProcess = spawn(process.execPath, [BB, ...args], { cwd: dir, env });
  let stdout = "";
  let stderr = "";
  child.stderr?.on("data", (c) => {
    stderr += c;
  });
  const closed = new Promise<{ code: number | null; stdout: string; stderr: string }>((done) =>
    child.on("close", (code) => done({ code, stdout, stderr })),
  );
  const until = (text: string) =>
    new Promise<void>((done) => {
      const look = () => stdout.includes(text) && done();
      child.stdout?.on("data", (c) => {
        stdout += c;
        look();
      });
      look();
    });
  return { child, closed, until };
}

const lockFile = (dir: string) => join(dir, ".busbar", "lock");

let stub: AuthStub | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

describe("one bb command at a time per project", () => {
  it("a second command refuses while the first waits at a handoff, naming its pid; the first carries on", async () => {
    const p = planned({ fail: { reauth: "read" } });
    const first = running(p.dir, p.env, ["apply", "--yes"]);
    await first.until("press Enter here");

    const second = p.bb("plan", "--tunnel", "https://other.ngrok-free.app");
    expect(second).toEqual({
      code: 1,
      stdout: "",
      stderr: `bb: another bb command is running in this project (pid ${first.child.pid}). Let it finish or stop it, then run this again.\n`,
    });
    expect(JSON.parse(p.read(".busbar/state.json")).google.planned.values).toEqual({
      "tunnel.url": NEW,
    });

    first.child.stdin?.end("\n");
    const done = await first.closed;
    expect(done.stderr).toBe("");
    expect(done.code).toBe(0);
    expect(existsSync(lockFile(p.dir))).toBe(false);
  });

  it("a lock left by a process that's gone is taken over, and released at the end", () => {
    const p = planned();
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(lockFile(p.dir), `${gone}\n`);
    const r = p.bb("plan", "--tunnel", "https://other.ngrok-free.app");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(JSON.parse(p.read(".busbar/state.json")).google.planned.values).toEqual({
      "tunnel.url": "https://other.ngrok-free.app",
    });
    expect(existsSync(lockFile(p.dir))).toBe(false);
  });

  it("Ctrl-C while bb verify waits for Google releases the lock", async () => {
    const p = planned();
    expect(p.bb("apply", "--yes").code).toBe(0);
    stub = await authStub(() => "mismatch-error-redirect");
    const verify = running(p.dir, { ...p.env, BB_GOOGLE_AUTH_URL: stub.url }, ["verify"]);
    await verify.until("Asking again in");
    expect(existsSync(lockFile(p.dir))).toBe(true);
    verify.child.kill("SIGINT");
    await verify.closed;
    expect(existsSync(lockFile(p.dir))).toBe(false);
  });

  it("Ctrl-C at a handoff stops the command and releases the lock", async () => {
    const p = planned({ fail: { reauth: "read" } });
    const first = running(p.dir, p.env, ["apply", "--yes"]);
    await first.until("press Enter here");
    first.child.kill("SIGINT");
    expect((await first.closed).code).toBe(2);
    expect(existsSync(lockFile(p.dir))).toBe(false);
  });
});

describe("bb apply records the Save into state.json as it is then, not as it was at the start", () => {
  it("keeps a check written to state.json while apply waited at a handoff", async () => {
    const p = planned({ fail: { reauth: "read" } });
    const first = running(p.dir, p.env, ["apply", "--yes"]);
    await first.until("press Enter here");
    const check = {
      at: "2026-11-23T10:00:00.000Z",
      uri: `${LOCAL}${CB}`,
      result: "accepted",
      status: 302,
    };
    const state = JSON.parse(p.read(".busbar/state.json"));
    state.google.checks = [check];
    writeFileSync(join(p.dir, ".busbar", "state.json"), JSON.stringify(state));

    first.child.stdin?.end("\n");
    expect((await first.closed).code).toBe(0);
    const google = JSON.parse(p.read(".busbar/state.json")).google;
    expect(google.checks).toEqual([check]);
    expect(google.owned).toEqual({ redirectUris: [`${NEW}${CB}`], jsOrigins: [NEW] });
  });
});
