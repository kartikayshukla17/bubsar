import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { project, SAMPLE_TOML } from "./helpers/project";

describe("bb logout google", () => {
  it("removes busbar's profile for the project, and status goes back to never logged in", () => {
    const p = project(SAMPLE_TOML, { browsers: ["brave"], google: { session: "signed-out" } });
    p.bb("login", "google");
    const profile = join(p.home, "profiles", "enquiry-to-paid", "brave");
    expect(existsSync(profile)).toBe(true);

    const r = p.bb("logout", "google");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`google: logged out · Brave. Removed ${profile}\n`);
    expect(existsSync(profile)).toBe(false);
    expect(JSON.parse(p.read(".busbar/local.json"))).toEqual({});
    expect(p.bb("status").stdout).toContain("google: never logged in. Run bb login google.\n");
  });

  it("with nothing to remove, says so and exits 0", () => {
    const r = project().bb("logout", "google");
    expect(r.stdout).toBe("google: not logged in. Nothing to remove.\n");
    expect(r.code).toBe(0);
  });
});
