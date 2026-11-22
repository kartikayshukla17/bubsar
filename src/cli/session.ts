import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { parseArgs } from "node:util";
import { type InstalledBrowser, KNOWN, label } from "../core/browser/browsers";
import { type BrowserDriver, driverFromEnv } from "../core/browser/driver";
import { loadConfig } from "../core/config";
import {
  checkSession,
  existingProfiles,
  profileDir,
  readLocal,
  type Session,
  sessionCheck,
  signInUrl,
  writeLocal,
} from "../core/session";

const nameOf = (id: string) => KNOWN.find((k) => k.id === id)?.name ?? id;

function provider(argv: string[], command: string) {
  const [name, ...rest] = argv;
  if (name !== "google")
    throw new Error(
      name === undefined || name.startsWith("-")
        ? `${command} what? Try: bb ${command} google`
        : `${command} knows only google so far, not ${name}.`,
    );
  return rest;
}

/** The browser to use, and why it was chosen. Throws with the list when the user must pick. */
function pickBrowser(
  installed: InstalledBrowser[],
  flag: string | undefined,
  remembered: string | undefined,
): { browser: InstalledBrowser; why: string } {
  const usable = installed.filter((b) => b.engine === "chromium");
  if (flag !== undefined) {
    const known = KNOWN.find((k) => k.id === flag);
    if (!known)
      throw new Error(`--browser ${flag}: expected one of ${KNOWN.map((k) => k.id).join(", ")}.`);
    if (known.engine !== "chromium")
      throw new Error(`--browser ${flag}: busbar doesn't drive ${known.name} yet.`);
    const browser = usable.find((b) => b.id === flag);
    if (!browser) throw new Error(`--browser ${flag}: ${known.name} isn't installed.`);
    return { browser, why: "--browser" };
  }
  const kept = usable.find((b) => b.id === remembered);
  if (kept) return { browser: kept, why: "remembered for this project" };
  if (usable.length === 1) return { browser: usable[0], why: "the only browser installed" };
  if (usable.length === 0)
    throw new Error("no supported browser installed. busbar drives Brave, Dia, Chrome or Edge.");
  const width = Math.max(...usable.map((b) => b.id.length));
  throw new Error(
    [
      `${usable.length} browsers installed. Pick the one busbar signs into Google with:`,
      ...usable.map((b) => `  bb login google --browser ${b.id.padEnd(width)}  ${label(b)}`),
    ].join("\n"),
  );
}

const checking = (b: InstalledBrowser) =>
  sessionCheck.headless
    ? "Checking the session: loading the Cloud console in busbar's profile, headless …"
    : `Checking the session: a minimized ${b.name} window loads the Cloud console, then quits …`;

/** `bb login google [--browser <id>]` */
export async function cmdLogin(argv: string[], driver: BrowserDriver = driverFromEnv()) {
  const { values: flags } = parseArgs({
    args: provider(argv, "login"),
    options: { browser: { type: "string" } },
  });
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const { browser, why } = pickBrowser(
    driver.detect(),
    flags.browser,
    readLocal(cwd).google?.browser,
  );
  const dir = profileDir(config.project.name, browser.id);
  const out = (s = "") => process.stdout.write(`${s}\n`);
  const record = (session: Session) =>
    writeLocal(cwd, {
      ...readLocal(cwd),
      google: { browser: browser.id, session, checkedAt: new Date().toISOString() },
    });

  out(`busbar login · Google · ${config.project.name}`);
  out();
  out(`Browser  ${label(browser)} (${why})`);
  out(`Profile  ${dir}`);
  out(`         busbar's own profile, separate from your everyday ${browser.name}.`);
  out();

  if (existsSync(dir)) {
    out(checking(browser));
    const session = await checkSession(driver, browser, dir);
    record(session);
    if (session === "signed-in") {
      out(`google: already signed in · ${browser.name}. No window needed.`);
      return;
    }
    out("Not signed in any more. Opening the sign-in window.");
    out();
  } else {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    record("signed-out");
  }

  const name = browser.name;
  out(`Opening ${name} on busbar's profile at Google sign-in. Sign in there yourself: busbar`);
  out("never sees your password or cookies, and the session stays inside that profile.");
  out(`A second ${name} icon in the Dock is expected: that's busbar's window. Your everyday`);
  out(`${name} keeps running untouched.`);
  out(
    `When the Cloud console has loaded, press Enter here, or quit busbar's ${name} window (Cmd-Q).`,
  );
  await driver.openPlain(browser, dir, signInUrl());
  out();
  out(checking(browser));
  const session = await checkSession(driver, browser, dir);
  record(session);
  if (session !== "signed-in")
    throw new Error(
      `still signed out of Google in busbar's ${browser.name} profile: the Cloud console redirected to sign-in. Run bb login google again.`,
    );
  out(`google: signed in · ${browser.name}`);
}

/** `bb status`: per provider, signed in / signed out / never logged in, checked live. */
export async function cmdStatus(driver: BrowserDriver = driverFromEnv()) {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const local = readLocal(cwd);
  const out = (s = "") => process.stdout.write(`${s}\n`);
  out(`busbar status · ${config.project.name}`);
  out();

  const project = config.project.name;
  const profiles = existingProfiles(project);
  const google = local.google;
  const current = google && profiles.find((p) => p.id === google.browser);
  if (!google || !current) {
    if (profiles.length === 0) {
      out("google: never logged in. Run bb login google.");
      return;
    }
    const width = Math.max(...profiles.map((p) => p.name.length));
    out("google: not checked · no browser chosen, but busbar has profiles here:");
    for (const p of profiles) out(`  ${p.name.padEnd(width)}  ${p.dir}`);
    out("Run bb login google to use one, or bb logout google to remove them.");
    return;
  }
  const dir = current.dir;
  const browser = driver.detect().find((b) => b.id === google.browser);
  if (!browser) {
    out(
      `google: not checked · ${nameOf(google.browser)} isn't installed any more. Run bb login google to pick another.`,
    );
    return;
  }
  const session = await checkSession(driver, browser, dir);
  writeLocal(cwd, {
    ...local,
    google: { ...google, session, checkedAt: new Date().toISOString() },
  });
  out(`google: ${session === "signed-in" ? "signed in" : "signed out"} · ${label(browser)}`);
  out(`  Profile  ${dir}`);
  out(`           busbar's own, run with ${browser.name}'s real Keychain encryption, not a mock.`);
  out(
    session === "signed-in"
      ? "  Checked  just now: the Cloud console loaded without a redirect to Google sign-in."
      : "  Checked  just now: the Cloud console redirected to Google sign-in. Run bb login google.",
  );
  for (const p of profiles)
    if (p.id !== browser.id) out(`  Also     ${p.name} profile, not in use: ${p.dir}`);
}

/**
 * `bb logout google`: delete every busbar profile this project has (one per browser it was
 * logged in with), and forget the choice. Google's side is untouched.
 */
export function cmdLogout(argv: string[]) {
  provider(argv, "logout");
  const cwd = process.cwd();
  const project = loadConfig(cwd).project.name;
  const { google, ...rest } = readLocal(cwd);
  const profiles = existingProfiles(project);
  for (const p of profiles) rmSync(p.dir, { recursive: true, force: true });
  if (google) writeLocal(cwd, rest);
  if (profiles.length === 0) {
    process.stdout.write("google: not logged in. Nothing to remove.\n");
    return;
  }
  const width = Math.max(...profiles.map((p) => p.name.length));
  process.stdout.write(
    [
      `google: logged out. Removed busbar's profiles for ${project}:`,
      ...profiles.map((p) => `  ${p.name.padEnd(width)}  ${p.dir}`),
      "",
    ].join("\n"),
  );
}
