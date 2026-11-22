import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { project, SAMPLE_TOML } from "./helpers/project";

const TUNNEL = "https://abcd.ngrok-free.app";

describe("bb plan", () => {
  it("prints both Google writes, current state unknown, and changes nothing", () => {
    const p = project();
    const r = p.bb("plan", "--tunnel", TUNNEL);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(
      /01 +Authorized redirect URI +unknown → https:\/\/abcd\.ngrok-free\.app\/api\/auth\/callback\/google\n/,
    );
    expect(r.stdout).toMatch(
      /02 +Authorized JavaScript origin +unknown → https:\/\/abcd\.ngrok-free\.app\n/,
    );
    expect(r.stdout).toContain("Nothing has changed yet.");
  });

  it("writes the run down for bb ui: a snapshot plus the plan event", () => {
    const p = project();
    p.bb("plan", "--tunnel", TUNNEL);
    const run = JSON.parse(p.read(".busbar/run.json"));
    const events = p
      .read(".busbar/events.jsonl")
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l));

    expect(run.project).toBe("enquiry-to-paid");
    expect(run.destinations).toEqual([{ id: "google", name: "Google", where: "OAuth web client" }]);
    expect(run.values).toEqual([
      expect.objectContaining({
        id: "tunnel.url",
        kind: "URL",
        secret: false,
        literal: TUNNEL,
        routes: ["google"],
      }),
    ]);
    expect(run.board.phase).toBe("planned");
    expect(Object.values(run.board.strips)).toEqual([
      { bay: "plan", mark: "planned", fresh: false },
      { bay: "plan", mark: "planned", fresh: false },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      run: run.run,
      seq: 1,
      action: { type: "plan", steps: run.board.steps },
    });
    expect(run.seq).toBe(1);
  });
});

describe("bb plan refuses bad input in one line, and writes nothing", () => {
  it.each([
    [
      "a busbar.toml error",
      () => project(SAMPLE_TOML.replace(/^client_id.*\n/m, "")),
      "bb: busbar.toml:8: destinations.google.client_id: missing (the OAuth web client to edit)\n",
    ],
    [
      "no busbar.toml",
      () => {
        const p = project();
        rmSync(join(p.dir, "busbar.toml"));
        return p;
      },
      "bb: no busbar.toml here. Run bb in your project's root, next to busbar.toml.\n",
    ],
  ])("%s", (_, make, stderr) => {
    const p = make();
    const r = p.bb("plan", "--tunnel", TUNNEL);
    expect(r.stderr).toBe(stderr);
    expect(r.code).toBe(1);
    expect(existsSync(join(p.dir, ".busbar"))).toBe(false);
  });

  it("a bad --tunnel", () => {
    const p = project();
    const r = p.bb("plan", "--tunnel", "http://abcd.ngrok-free.app");
    expect(r.stderr).toBe(
      "bb: --tunnel http://abcd.ngrok-free.app: expected an https origin like https://abcd.ngrok-free.app, but it isn't https\n",
    );
    expect(r.code).toBe(1);
    expect(existsSync(join(p.dir, ".busbar"))).toBe(false);
  });
});

describe("bb --version", () => {
  it("prints the package version", () => {
    const { version } = JSON.parse(readFileSync("package.json", "utf8"));
    const r = project().bb("--version");
    expect(r.stdout).toBe(`busbar ${version}\n`);
    expect(r.code).toBe(0);
  });
});
