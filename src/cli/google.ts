import type { InstalledBrowser } from "../core/browser/browsers";
import type { BrowserDriver } from "../core/browser/driver";
import { type GoogleConsole, PageGoogleConsole } from "../core/recipes/google/console";
import { FakeGoogleConsole } from "../core/recipes/google/fake";
import {
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

export function recordSession(projectDir: string, session: Session) {
  const local = readLocal(projectDir);
  if (local.google)
    writeLocal(projectDir, {
      ...local,
      google: { ...local.google, session, checkedAt: new Date().toISOString() },
    });
}

export async function withConsole<T>(gc: GoogleConsole, fn: () => Promise<T>): Promise<T> {
  const close = () =>
    gc.close().catch((e: unknown) => {
      process.stderr.write(
        `bb: also couldn't close busbar's automated browser: ${(e as Error).message}. Quit it before the next bb command.\n`,
      );
    });
  try {
    return await fn();
  } finally {
    await close();
  }
}
