import type { InstalledBrowser } from "../core/browser/browsers";
import type { BrowserDriver } from "../core/browser/driver";
import type { GoogleDecl } from "../core/config";
import type { Consoles } from "../core/handoff";
import { clientUrl, type GoogleConsole, PageGoogleConsole } from "../core/recipes/google/console";
import { FakeGoogleConsole } from "../core/recipes/google/fake";
import {
  consoleOrigin,
  existingProfiles,
  readLocal,
  type Session,
  sessionCheck,
  writeLocal,
} from "../core/session";

export type GoogleProfile = { browser: InstalledBrowser; dir: string };

/**
 * busbar's Google profile for this project, or null when it never logged in (no browser
 * recorded, or that browser's profile is gone). Throws when the browser was uninstalled.
 */
export function googleProfile(
  projectDir: string,
  project: string,
  driver: BrowserDriver,
): GoogleProfile | null {
  const google = readLocal(projectDir).google;
  const profile = google && existingProfiles(project).find((p) => p.id === google.browser);
  if (!google || !profile) return null;
  const browser = driver.detect().find((b) => b.id === google.browser);
  if (!browser)
    throw new Error(
      `${profile.name} isn't installed any more, so busbar can't read Google. Run bb login google to pick another.`,
    );
  return { browser, dir: profile.dir };
}

/** Attach to the profile and hand back the Google recipe on it: the fake one under BB_FAKE. */
export async function openGoogleConsole(
  driver: BrowserDriver,
  { browser, dir }: GoogleProfile,
  url: string,
  env = process.env,
): Promise<GoogleConsole> {
  const page = await driver.attach(browser, dir, { headless: sessionCheck.headless });
  return env.BB_FAKE
    ? new FakeGoogleConsole(env.BB_FAKE, page, url)
    : new PageGoogleConsole(page, { url });
}

export const googleClientUrl = (google: GoogleDecl) =>
  clientUrl(consoleOrigin(), google.project_id, google.client_id);

export function recordSession(projectDir: string, session: Session) {
  const local = readLocal(projectDir);
  if (local.google)
    writeLocal(projectDir, {
      ...local,
      google: { ...local.google, session, checkedAt: new Date().toISOString() },
    });
}

const closeFailed = (e: unknown) =>
  `couldn't close busbar's automated browser: ${(e as Error).message}`;

/**
 * The CLI's side of a handoff: the automated browser on busbar's Google profile, attached
 * on demand, and the plain window that hands it to you. Ctrl-C during the wait stops.
 */
export class DriverConsoles implements Consoles {
  #gc: GoogleConsole | null = null;
  handoffs = 0;

  constructor(
    private readonly projectDir: string,
    private readonly driver: BrowserDriver,
    private readonly profile: GoogleProfile,
    private readonly url: string,
  ) {}

  get browser() {
    return this.profile.browser.name;
  }

  async open() {
    this.#gc ??= await openGoogleConsole(this.driver, this.profile, this.url);
    return this.#gc;
  }

  async handOver(url: string, instruction: string) {
    this.handoffs++;
    recordSession(this.projectDir, "signed-out");
    const gc = this.#gc;
    this.#gc = null;
    // A second launch on a profile that's still open would land in the automated browser.
    await gc?.close().catch((e: unknown) => {
      throw new Error(
        `${closeFailed(e)}, so busbar didn't open the sign-in window: the profile is still in use. Quit it, then run the command again.`,
      );
    });
    const stop = new AbortController();
    const onInterrupt = () => stop.abort();
    process.once("SIGINT", onInterrupt);
    try {
      const ended = this.driver.openPlain(this.profile.browser, this.profile.dir, url, {
        signal: stop.signal,
      });
      process.stdout.write(`\n${instruction}\n`);
      const end = await ended;
      return end === "enter" || end === "closed";
    } finally {
      process.off("SIGINT", onInterrupt);
    }
  }

  async close() {
    const gc = this.#gc;
    this.#gc = null;
    await gc?.close().catch((e: unknown) => {
      process.stderr.write(`bb: also ${closeFailed(e)}. Quit it before the next bb command.\n`);
    });
  }
}

export async function withConsoles<T>(c: DriverConsoles, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await c.close();
  }
}
