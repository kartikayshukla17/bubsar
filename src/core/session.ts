import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { type BrowserId, type InstalledBrowser, KNOWN } from "./browser/browsers";
import type { BrowserDriver } from "./browser/driver";
import { ensureRunDir, RUN_DIR, writeAtomic } from "./run";

export type Session = "signed-in" | "signed-out";

/**
 * How the session check runs. Headed and minimized until the Step 0 spike shows Google
 * serves the console to a headless window without a challenge; then flip to true.
 */
export const sessionCheck = { headless: false };

/** busbar's home: `BB_HOME`, else `~/Library/Application Support/busbar`. */
export function busbarHome(env = process.env) {
  return resolve(env.BB_HOME ?? join(homedir(), "Library", "Application Support", "busbar"));
}

/** busbar's own browser profile for this project: `<home>/profiles/<project>/<browser>`. */
export function profileDir(project: string, browser: BrowserId, env = process.env) {
  // The name becomes a folder that `bb logout` deletes, so it can't climb out of profiles/.
  if (!/^[A-Za-z0-9][\w.-]*$/.test(project))
    throw new Error(
      `project.name "${project}" can't name a profile folder. Use letters, digits, ".", "-" or "_".`,
    );
  if (!isBrowserId(browser)) throw new Error(`"${browser}" isn't a browser busbar knows.`);
  return join(busbarHome(env), "profiles", project, browser);
}

/** Every busbar profile this project has on disk, one per browser it was logged in with. */
export function existingProfiles(project: string, env = process.env) {
  return KNOWN.map((k) => ({ id: k.id, name: k.name, dir: profileDir(project, k.id, env) })).filter(
    (p) => existsSync(p.dir),
  );
}

export function consoleOrigin(env = process.env) {
  return env.BB_GOOGLE_CONSOLE_ORIGIN ?? "https://console.cloud.google.com";
}

/** Google sign-in, continuing to the Cloud console. */
export function signInUrl(env = process.env) {
  return `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(`${consoleOrigin(env)}/`)}`;
}

/**
 * Attach to the profile and load the Cloud console. Signed in unless Google sends it to
 * accounts.google.com, judged by the final URL's host, never by page text.
 */
export async function checkSession(
  driver: BrowserDriver,
  browser: InstalledBrowser,
  dir: string,
): Promise<Session> {
  const page = await driver.attach(browser, dir, { headless: sessionCheck.headless });
  try {
    await page.goto(`${consoleOrigin()}/`);
    return new URL(await page.url()).hostname === "accounts.google.com"
      ? "signed-out"
      : "signed-in";
  } finally {
    await page.close();
  }
}

/** `.busbar/local.json`: this machine's choices for the project. Public, no secrets. */
export type Local = { google?: { browser: BrowserId; session: Session; checkedAt: string } };

const isBrowserId = (id: unknown): id is BrowserId => KNOWN.some((k) => k.id === id);

/**
 * Read `local.json`. It's a plain file anyone can edit, and its browser id becomes a folder
 * that `bb logout` deletes, so an id busbar doesn't know is refused, never used.
 */
export function readLocal(projectDir: string): Local {
  const file = join(projectDir, RUN_DIR, "local.json");
  const local: Local = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  if (local.google && !isBrowserId(local.google.browser))
    throw new Error(
      `${RUN_DIR}/local.json: google.browser "${local.google.browser}" isn't a browser busbar knows (${KNOWN.map((k) => k.id).join(", ")}). Delete ${RUN_DIR}/local.json and run bb login google.`,
    );
  return local;
}

export function writeLocal(projectDir: string, local: Local) {
  writeAtomic(join(ensureRunDir(projectDir), "local.json"), `${JSON.stringify(local, null, 2)}\n`);
}
