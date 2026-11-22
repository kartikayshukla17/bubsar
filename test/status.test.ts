import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { project, SAMPLE_TOML } from "./helpers/project";

const BRAVE_ONLY = { browsers: ["brave"], google: { session: "signed-out" } };

describe("bb status", () => {
  it("a fresh project has never logged in, and status opens no browser", () => {
    const p = project(SAMPLE_TOML, BRAVE_ONLY);
    const r = p.bb("status");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      "busbar status · enquiry-to-paid\n\ngoogle: never logged in. Run bb login google.\n",
    );
    expect(p.world().attachCalls).toBeUndefined();
  });

  it("after login: signed in, which browser, where the profile lives, and what was checked", () => {
    const p = project(SAMPLE_TOML, BRAVE_ONLY);
    p.bb("login", "google");
    const r = p.bb("status");
    const profile = join(p.home, "profiles", "enquiry-to-paid", "brave");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      [
        "busbar status · enquiry-to-paid",
        "",
        "google: signed in · Brave",
        `  Profile  ${profile}`,
        "           busbar's own, run with Brave's real Keychain encryption, not a mock.",
        "  Checked  just now: the Cloud console loaded without a redirect to Google sign-in.",
        "",
      ].join("\n"),
    );
    expect(p.world().attachCalls).toHaveLength(2);
  });

  it("when Google has ended the session: signed out, and the local record follows", () => {
    const p = project(SAMPLE_TOML, BRAVE_ONLY);
    p.bb("login", "google");
    p.setWorld({ ...p.world(), google: { session: "signed-out" } });
    const r = p.bb("status");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("google: signed out · Brave\n");
    expect(r.stdout).toContain(
      "  Checked  just now: the Cloud console redirected to Google sign-in. Run bb login google.\n",
    );
    expect(JSON.parse(p.read(".busbar/local.json")).google.session).toBe("signed-out");
  });

  it("labels Chrome and Edge as untested on this machine", () => {
    const p = project(SAMPLE_TOML, { browsers: ["chrome"], google: { session: "signed-out" } });
    p.bb("login", "google");
    expect(p.bb("status").stdout).toContain(
      "google: signed in · Chrome (untested on this machine)\n",
    );
  });

  it("a recorded browser that's been uninstalled is reported, not checked", () => {
    const p = project(SAMPLE_TOML, BRAVE_ONLY);
    p.bb("login", "google");
    p.setWorld({ ...p.world(), browsers: ["dia"] });
    const r = p.bb("status");
    expect(r.stdout).toContain(
      "google: not checked · Brave isn't installed any more. Run bb login google to pick another.\n",
    );
    expect(p.world().attachCalls).toHaveLength(1);
    expect(existsSync(join(p.home, "profiles", "enquiry-to-paid", "brave"))).toBe(true);
  });
});
