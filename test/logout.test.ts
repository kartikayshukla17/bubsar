import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
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
    expect(r.stdout).toBe(
      `google: logged out. Removed busbar's profiles for enquiry-to-paid:\n  Brave  ${profile}\n`,
    );
    expect(existsSync(profile)).toBe(false);
    expect(JSON.parse(p.read(".busbar/local.json"))).toEqual({});
    expect(p.bb("status").stdout).toContain("google: never logged in. Run bb login google.\n");
  });

  it("with nothing to remove, says so and exits 0", () => {
    const r = project().bb("logout", "google");
    expect(r.stdout).toBe("google: not logged in. Nothing to remove.\n");
    expect(r.code).toBe(0);
  });

  it("refuses a browser id in local.json that would climb out of profiles/, and deletes nothing", () => {
    const p = project();
    const target = mkdtempSync(join(tmpdir(), "bb-precious-"));
    writeFileSync(join(target, "keep.txt"), "mine");
    const browser = relative(join(p.home, "profiles", "enquiry-to-paid"), target);
    mkdirSync(join(p.dir, ".busbar"));
    writeFileSync(
      join(p.dir, ".busbar", "local.json"),
      JSON.stringify({
        google: { browser, session: "signed-in", checkedAt: "2026-11-22T00:00:00.000Z" },
      }),
    );

    const r = p.bb("logout", "google");
    expect(r.stderr).toBe(
      `bb: .busbar/local.json: google.browser "${browser}" isn't a browser busbar knows (brave, dia, chrome, edge, firefox, firefox-dev, firefox-nightly). Delete .busbar/local.json and run bb login google.\n`,
    );
    expect(r.code).toBe(1);
    expect(existsSync(join(target, "keep.txt"))).toBe(true);
    expect(p.bb("status").code).toBe(1);
  });

  it("after switching browsers, removes every profile the project has and names each", () => {
    const p = project(SAMPLE_TOML, {
      browsers: ["brave", "dia"],
      google: { session: "signed-out" },
    });
    p.bb("login", "google", "--browser", "brave");
    p.bb("login", "google", "--browser", "dia");
    const brave = join(p.home, "profiles", "enquiry-to-paid", "brave");
    const dia = join(p.home, "profiles", "enquiry-to-paid", "dia");

    const r = p.bb("logout", "google");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      `google: logged out. Removed busbar's profiles for enquiry-to-paid:\n  Brave  ${brave}\n  Dia    ${dia}\n`,
    );
    expect(existsSync(brave)).toBe(false);
    expect(existsSync(dia)).toBe(false);
    expect(p.bb("status").stdout).toContain("google: never logged in. Run bb login google.\n");
  });
});
