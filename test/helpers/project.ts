import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

/** A throwaway project directory holding a busbar.toml. */
export function project(toml = SAMPLE_TOML) {
  const dir = mkdtempSync(join(tmpdir(), "bb-test-"));
  writeFileSync(join(dir, "busbar.toml"), toml);
  return {
    dir,
    bb: (...args: string[]) => {
      const r = spawnSync(process.execPath, [BB, ...args], { cwd: dir, encoding: "utf8" });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    },
    read: (file: string) => readFileSync(join(dir, file), "utf8"),
  };
}
