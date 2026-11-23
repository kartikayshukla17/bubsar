import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BACKUP = ".puppeteer";

function writePrefs(path: string, text: string) {
  writeFileSync(`${path}.tmp`, text, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

/**
 * Puppeteer writes its automation prefs (Safe Browsing off, site isolation weakened,
 * file-URI origin checks off) into user.js and only restores files it found, so they would
 * stay and load in the plain sign-in window too. busbar profiles never hold a user.js of
 * their own, so any user.js is removed before and after each step. A prefs.js backup left
 * by a step that never finished is the last clean copy, so it becomes the baseline.
 */
export function keepPrefs(profileDir: string): () => void {
  const user = join(profileDir, "user.js");
  const prefs = join(profileDir, "prefs.js");
  const clearUser = () => {
    rmSync(user, { force: true });
    rmSync(`${user}${BACKUP}`, { force: true });
  };
  const backup = `${prefs}${BACKUP}`;
  const source = existsSync(backup) ? backup : existsSync(prefs) ? prefs : null;
  const baseline = source && readFileSync(source, "utf8");
  clearUser();
  if (baseline !== null) writePrefs(prefs, baseline);
  rmSync(backup, { force: true });
  return () => {
    clearUser();
    if (baseline === null) rmSync(prefs, { force: true });
    else writePrefs(prefs, baseline);
    rmSync(backup, { force: true });
  };
}
