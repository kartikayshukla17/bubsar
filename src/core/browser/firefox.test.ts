import { copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keepPrefs } from "./firefox";

const CLEAN = 'user_pref("browser.startup.page", 3);\n';
const AUTOMATION =
  'user_pref("fission.webContentIsolationStrategy", 0);\nuser_pref("browser.safebrowsing.malware.enabled", false);\n';

function profile(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "bb-ffprefs-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

/** What Puppeteer does to the profile at launch: back up what exists, write its user.js. */
function puppeteerLaunches(dir: string) {
  for (const name of ["user.js", "prefs.js"])
    try {
      copyFileSync(join(dir, name), join(dir, `${name}.puppeteer`));
    } catch {}
  writeFileSync(join(dir, "user.js"), AUTOMATION);
  writeFileSync(join(dir, "prefs.js"), CLEAN + AUTOMATION);
}

const prefFiles = (dir: string) =>
  readdirSync(dir)
    .filter((f) => /^(user|prefs)\.js/.test(f))
    .sort();

describe("keepPrefs: busbar's Firefox profile carries no automation prefs between steps", () => {
  it("a profile left by a crash mid-step comes back clean on the next step", () => {
    const dir = profile({
      "user.js": AUTOMATION,
      "prefs.js": CLEAN + AUTOMATION,
      "prefs.js.puppeteer": CLEAN,
    });
    const restore = keepPrefs(dir);
    expect(prefFiles(dir)).toEqual(["prefs.js"]);
    expect(readFileSync(join(dir, "prefs.js"), "utf8")).toBe(CLEAN);

    puppeteerLaunches(dir);
    restore();
    expect(prefFiles(dir)).toEqual(["prefs.js"]);
    expect(readFileSync(join(dir, "prefs.js"), "utf8")).toBe(CLEAN);
  });

  it("removes a user.js that was already there: busbar profiles never hold one", () => {
    const dir = profile({ "user.js": 'user_pref("x", 1);\n', "prefs.js": CLEAN });
    const restore = keepPrefs(dir);
    expect(prefFiles(dir)).toEqual(["prefs.js"]);
    puppeteerLaunches(dir);
    restore();
    expect(prefFiles(dir)).toEqual(["prefs.js"]);
    expect(readFileSync(join(dir, "prefs.js"), "utf8")).toBe(CLEAN);
  });

  it("a fresh profile ends with no pref files at all", () => {
    const dir = profile({});
    const restore = keepPrefs(dir);
    puppeteerLaunches(dir);
    restore();
    expect(prefFiles(dir)).toEqual([]);
  });
});
