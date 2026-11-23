import { type ChildProcess, spawn } from "node:child_process";
import { statSync } from "node:fs";
import { request } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { follow } from "../src/core/board";
import type { Run, RunEvent } from "../src/core/run";
import { authStub } from "./helpers/google-auth";
import { BB, project, SAMPLE_TOML, signedIn } from "./helpers/project";

const TUNNEL = "https://abcd.ngrok-free.app";
const running: ChildProcess[] = [];
afterEach(() => {
  for (const c of running.splice(0)) c.kill();
});

/** Start `bb ui` in a project and resolve with the URL it prints. */
function ui(dir: string, env = process.env): Promise<URL> {
  const child = spawn(process.execPath, [BB, "ui", "--no-open"], { cwd: dir, env });
  running.push(child);
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const m = out.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) resolve(new URL(m[0]));
    });
    child.on("exit", (code) => reject(new Error(`bb ui exited ${code}`)));
  });
}

function get(url: URL, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    request(url, { headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    })
      .on("error", reject)
      .end();
  });
}

describe("bb ui daemon", () => {
  it("serves the current run snapshot at /api/run", async () => {
    const p = project();
    p.bb("plan", "--tunnel", TUNNEL);
    const base = await ui(p.dir);
    const r = await get(new URL("/api/run", base));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual(JSON.parse(p.read(".busbar/run.json")));
  });

  it("streams a plan made in another terminal within a second", async () => {
    const p = project();
    const base = await ui(p.dir);
    const first = new Promise<{
      at: number;
      event: { run: string; seq: number; action: { type: string } };
    }>((resolve, reject) => {
      request(new URL("/api/events", base), (res) => {
        expect(res.headers["content-type"]).toBe("text/event-stream");
        let buf = "";
        res.on("data", (d) => {
          buf += d;
          const m = buf.match(/^data: (.+)$/m);
          if (m) resolve({ at: Date.now(), event: JSON.parse(m[1]) });
        });
      })
        .on("error", reject)
        .end();
    });
    await new Promise((r) => setTimeout(r, 100)); // let the stream open
    p.bb("plan", "--tunnel", TUNNEL);
    const written = statSync(join(p.dir, ".busbar", "events.jsonl")).mtimeMs;
    const { at, event } = await first;
    expect(at - written).toBeLessThan(1000);
    expect(event.action.type).toBe("plan");
    expect(event.run).toBe(JSON.parse(p.read(".busbar/run.json")).run);
  });

  it("listens on loopback only", async () => {
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal);
    if (!lan) return; // no non-loopback interface on this machine
    const base = await ui(project().dir);
    const remote = new URL(base);
    remote.hostname = lan.address;
    await expect(get(new URL("/api/run", remote))).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("refuses requests addressed to another host name (DNS rebinding)", async () => {
    const base = await ui(project().dir);
    const r = await get(new URL("/api/run", base), { Host: `attacker.example:${base.port}` });
    expect(r.status).toBe(403);
  });
});

describe("bb ui session chip feed", () => {
  it("serves the Google session at /api/session, with the browser's name", async () => {
    const p = project(SAMPLE_TOML, { browsers: ["brave"], google: { session: "signed-out" } });
    const base = await ui(p.dir, p.env);
    expect(JSON.parse((await get(new URL("/api/session", base))).body)).toEqual({});

    p.bb("login", "google");
    const r = await get(new URL("/api/session", base));
    expect(r.status).toBe(200);
    const { google } = JSON.parse(p.read(".busbar/local.json"));
    expect(JSON.parse(r.body)).toEqual({ google: { ...google, browserName: "Brave" } });
  });

  it("pushes a session event when a login in another terminal changes it", async () => {
    const p = project(SAMPLE_TOML, { browsers: ["dia"], google: { session: "signed-out" } });
    const base = await ui(p.dir, p.env);
    const pushed = new Promise<{
      at: number;
      event: { google: { browserName: string; session: string } };
    }>((resolve, reject) => {
      request(new URL("/api/events", base), (res) => {
        let buf = "";
        res.on("data", (d) => {
          buf += d;
          for (const m of buf.matchAll(/^event: session\ndata: (.+)$/gm)) {
            const e = JSON.parse(m[1]);
            if (e.google?.session === "signed-in") resolve({ at: Date.now(), event: e });
          }
        });
      })
        .on("error", reject)
        .end();
    });
    await new Promise((r) => setTimeout(r, 100)); // let the stream open
    p.bb("login", "google");
    const written = statSync(join(p.dir, ".busbar", "local.json")).mtimeMs;
    const { at, event } = await pushed;
    expect(at - written).toBeLessThan(1000);
    expect(event.google).toMatchObject({ browserName: "Dia", session: "signed-in" });
  });
});

function stream(url: URL) {
  const events: RunEvent[] = [];
  let close = () => {};
  const opened = new Promise<void>((resolve, reject) => {
    const req = request(url, (res) => {
      let buf = "";
      res.on("data", (d) => {
        buf += d;
        if (buf.startsWith(": busbar")) resolve();
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const b of blocks) {
          const m = b.match(/^data: (.+)$/m);
          if (m && !b.startsWith("event:")) events.push(JSON.parse(m[1]));
        }
      });
    });
    req.on("error", reject).end();
    close = () => req.destroy();
  });
  return { events, opened, close: () => close() };
}

async function until(done: () => boolean, ms: number) {
  for (const end = Date.now() + ms; !done(); ) {
    if (Date.now() > end) throw new Error("timed out waiting for the stream");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("bb ui opened during a bb rewire (BB-07)", () => {
  it("joins mid-run: the snapshot plus the events after it reduce to the run's final board, none missed or repeated", async () => {
    const NEW = "https://new.ngrok-free.app";
    const OLD = "https://old.ngrok-free.app";
    const CB = "/api/auth/callback/google";
    const p = signedIn(
      { redirectUris: [`http://localhost:3000${CB}`, `${OLD}${CB}`], jsOrigins: [OLD] },
      { redirectUris: [`${OLD}${CB}`], jsOrigins: [OLD] },
    );
    let reached = () => {};
    const asked = new Promise<void>((r) => {
      reached = r;
    });
    let release = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const stub = await authStub(async () => {
      reached();
      await held;
      return "accepted-signin-identifier";
    });
    try {
      const rewire = p.bbAsync(["rewire", "--tunnel", NEW, "--yes", "--wait", "0"], {
        BB_GOOGLE_AUTH_URL: stub.url,
      });
      await asked;

      const base = await ui(p.dir, p.env);
      const s = stream(new URL("/api/events", base));
      await s.opened;
      const snapshot = JSON.parse((await get(new URL("/api/run", base))).body) as Run;
      expect(snapshot.board.phase).toBe("verifying");
      expect(snapshot.board.strips["google-redirect-1"].mark).toBe("checking");

      release();
      expect((await rewire).code).toBe(0);
      const final = JSON.parse(p.read(".busbar/run.json")) as Run;
      await until(() => s.events.some((e) => e.seq === final.seq), 3000);
      s.close();

      expect(s.events.map((e) => e.seq)).toEqual(
        Array.from({ length: final.seq - snapshot.seq }, (_, i) => snapshot.seq + 1 + i),
      );
      let joined: Run | null = snapshot;
      for (const e of s.events) joined = follow(joined, e);
      expect(joined).toEqual(final);
      expect(final.board.phase).toBe("verified");
    } finally {
      release();
      await stub.close();
    }
  });
});
