import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const BB = resolve("dist/bb.js");

export const SAMPLE_TOML = `[project]
name = "enquiry-to-paid"

[values."tunnel.url"]
kind = "url"
source = "arg"

[destinations.google]
project_id = "my-sandbox-123"
client_id  = "1234-abc.apps.googleusercontent.com"
redirect_uris = ["{tunnel.url}/api/auth/callback/google"]
js_origins    = ["{tunnel.url}"]
`;

/** A fake world with nothing installed and no Google session. */
export const EMPTY_WORLD = { browsers: [], google: { session: "signed-out" } };

/**
 * A throwaway project directory holding a busbar.toml. Every `bb` it runs gets its own
 * temp `BB_HOME` and a fake world (`BB_FAKE`), so no test touches real profiles or browsers.
 */
export function project(toml = SAMPLE_TOML, world: object = EMPTY_WORLD) {
  const dir = mkdtempSync(join(tmpdir(), "bb-test-"));
  writeFileSync(join(dir, "busbar.toml"), toml);
  const home = mkdtempSync(join(tmpdir(), "bb-home-"));
  const worldFile = join(mkdtempSync(join(tmpdir(), "bb-world-")), "world.json");
  writeFileSync(worldFile, JSON.stringify(world));
  const env = { ...process.env, BB_HOME: home, BB_FAKE: worldFile };
  return {
    dir,
    home,
    env,
    bb: (...args: string[]) => {
      const r = spawnSync(process.execPath, [BB, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    },
    read: (file: string) => readFileSync(join(dir, file), "utf8"),
    /** The fake world as the CLI left it. */
    world: () => JSON.parse(readFileSync(worldFile, "utf8")),
    /** Change the fake world between commands. */
    setWorld: (next: object) => writeFileSync(worldFile, JSON.stringify(next)),
  };
}

/**
 * A project that ran `bb login google` with Brave, whose OAuth client shows `client`, and
 * whose .busbar/state.json says busbar owns `owned`. `google` adds to the fake world's
 * google section (scripted failures).
 */
export function signedIn(
  client: object,
  owned: object = { redirectUris: [], jsOrigins: [] },
  google: object = {},
) {
  const p = project(undefined, { browsers: ["brave"], google: { session: "signed-out" } });
  const login = p.bb("login", "google");
  if (login.code !== 0) throw new Error(`bb login google failed: ${login.stderr}`);
  p.setWorld({ ...p.world(), google: { ...p.world().google, client, ...google } });
  mkdirSync(join(p.dir, ".busbar"), { recursive: true });
  writeFileSync(
    join(p.dir, ".busbar", "state.json"),
    JSON.stringify({ google: { owned, planned: null, checks: [] } }),
  );
  return p;
}
