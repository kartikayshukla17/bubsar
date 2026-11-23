import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PREF_FILES = ["user.js", "prefs.js"];

/**
 * Puppeteer writes its automation prefs into the profile's user.js before each launch and
 * only puts back files it found there. On a profile without a user.js, its prefs (Safe
 * Browsing off, site isolation weakened, file-URI origin checks off) would stay and load in
 * the plain sign-in window too. So busbar snapshots both pref files before the launch and
 * returns a restore to run once the browser has exited.
 */
export function keepPrefs(profileDir: string): () => void {
  const before = PREF_FILES.map((name) => {
    const path = join(profileDir, name);
    return { path, text: existsSync(path) ? readFileSync(path, "utf8") : null };
  });
  return () => {
    for (const { path, text } of before) {
      if (text === null) rmSync(path, { force: true });
      else writeFileSync(path, text, { mode: 0o600 });
      rmSync(`${path}.puppeteer`, { force: true });
    }
  };
}
