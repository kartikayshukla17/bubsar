import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { project, SAMPLE_TOML } from "./helpers/project";

const SIGN_IN =
  "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fconsole.cloud.google.com%2F";
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

describe("bb login google", () => {
  it("with one browser installed, picks it, opens a plain window on busbar's profile, then checks the session", () => {
    const p = project(SAMPLE_TOML, { browsers: ["brave"], google: { session: "signed-out" } });
    const r = p.bb("login", "google");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);

    const profile = join(p.home, "profiles", "enquiry-to-paid", "brave");
    expect(statSync(profile).mode & 0o777).toBe(0o700);

    const world = p.world();
    expect(world.openPlainCalls).toEqual([{ browser: "brave", profileDir: profile, url: SIGN_IN }]);
    expect(world.attachCalls).toEqual([{ browser: "brave", profileDir: profile, headless: false }]);

    expect(r.stdout).toContain("Brave (the only browser installed)");
    expect(r.stdout).toContain(profile);
    expect(r.stdout).toContain("A second Brave icon in the Dock is expected");
    expect(r.stdout).toContain("press Enter here");
    expect(r.stdout).toMatch(/google: signed in · Brave\n$/);

    const local = JSON.parse(p.read(".busbar/local.json"));
    expect(local).toEqual({
      google: { browser: "brave", session: "signed-in", checkedAt: expect.stringMatching(ISO) },
    });
  });

  it("with several browsers and no choice yet, lists them and opens nothing", () => {
    const p = project(SAMPLE_TOML, {
      browsers: ["brave", "dia", "chrome"],
      google: { session: "signed-out" },
    });
    const r = p.bb("login", "google");
    expect(r.stderr).toBe(
      [
        "bb: 3 browsers installed. Pick the one busbar signs into Google with:",
        "  bb login google --browser brave   Brave",
        "  bb login google --browser dia     Dia (untested on this machine)",
        "  bb login google --browser chrome  Chrome (untested on this machine)",
        "",
      ].join("\n"),
    );
    expect(r.code).toBe(1);
    expect(p.world().openPlainCalls).toBeUndefined();
    expect(existsSync(join(p.dir, ".busbar", "local.json"))).toBe(false);
  });

  it("--browser picks one of several, and the choice is remembered for the project", () => {
    const p = project(SAMPLE_TOML, {
      browsers: ["brave", "dia"],
      google: { session: "signed-out" },
    });
    const r = p.bb("login", "google", "--browser", "dia");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Dia (untested on this machine) (--browser)");
    expect(r.stdout).toMatch(/google: signed in · Dia\n$/);
    const dia = join(p.home, "profiles", "enquiry-to-paid", "dia");
    expect(p.world().openPlainCalls).toEqual([{ browser: "dia", profileDir: dia, url: SIGN_IN }]);
    expect(JSON.parse(p.read(".busbar/local.json")).google.browser).toBe("dia");

    const again = p.bb("login", "google");
    expect(again.stdout).toContain("Dia (untested on this machine) (remembered for this project)");
  });

  it("a second login, still signed in, opens no window and says so", () => {
    const p = project(SAMPLE_TOML, { browsers: ["brave"], google: { session: "signed-out" } });
    p.bb("login", "google");
    const r = p.bb("login", "google");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/google: already signed in · Brave\. No window needed\.\n$/);
    expect(r.stdout).not.toContain("Opening Brave");
    expect(p.world().openPlainCalls).toHaveLength(1);
    expect(p.world().attachCalls).toHaveLength(2);
  });

  it("if you close the window without signing in, says so and exits 1", () => {
    const p = project(SAMPLE_TOML, {
      browsers: ["brave"],
      google: { session: "signed-out", userSignsIn: false },
    });
    const r = p.bb("login", "google");
    expect(r.stderr).toBe(
      "bb: still signed out of Google in busbar's Brave profile: the Cloud console redirected to sign-in. Run bb login google again.\n",
    );
    expect(r.code).toBe(1);
    expect(JSON.parse(p.read(".busbar/local.json")).google.session).toBe("signed-out");
  });

  it("refuses a project name that would climb out of busbar's profiles folder", () => {
    const p = project(SAMPLE_TOML.replace('name = "enquiry-to-paid"', 'name = "../../escape"'), {
      browsers: ["brave"],
      google: { session: "signed-out" },
    });
    const r = p.bb("login", "google");
    expect(r.stderr).toMatch(/^bb: project\.name "\.\.\/\.\.\/escape" can't name a profile folder/);
    expect(r.code).toBe(1);
    expect(p.world().openPlainCalls).toBeUndefined();
  });

  it("when Google has ended the session, login opens the window again on the same profile", () => {
    const p = project(SAMPLE_TOML, { browsers: ["brave"], google: { session: "signed-out" } });
    p.bb("login", "google");
    p.setWorld({ ...p.world(), google: { session: "signed-out" } });
    const r = p.bb("login", "google");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Not signed in any more. Opening the sign-in window.");
    expect(r.stdout).toMatch(/google: signed in · Brave\n$/);
    expect(p.world().openPlainCalls).toHaveLength(2);
  });

  it("names the provider it knows", () => {
    const r = project().bb("login", "meta");
    expect(r.stderr).toBe("bb: login knows only google so far, not meta.\n");
    expect(r.code).toBe(1);
  });
});
