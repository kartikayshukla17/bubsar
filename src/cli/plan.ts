import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { driverFromEnv } from "../core/browser/driver";
import { loadConfig } from "../core/config";
import { diff, nextLists } from "../core/diff";
import { desiredLists, plan, resolveValues } from "../core/plan";
import {
  clientUrl,
  type GoogleConsole,
  type Lists,
  ReauthRequired,
} from "../core/recipes/google/console";
import { describe, ensureRunDir, RUN_DIR, startRun } from "../core/run";
import { consoleOrigin, readLocal, type Session, writeLocal } from "../core/session";
import { googleState, readState, writeState } from "../core/state";
import { googleProfile, openGoogleConsole } from "./google";
import { printDiff, printPlan } from "./print";

/**
 * `--debug`: a screenshot of the failed page in `.busbar/debug/`, readable only by the user.
 * Never stands in for the real error: if the screenshot fails, it says so and moves on.
 */
async function saveScreenshot(projectDir: string, gc: GoogleConsole) {
  const err = (s: string) => process.stderr.write(`bb: --debug: ${s}\n`);
  try {
    const dir = join(ensureRunDir(projectDir), "debug");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const name = `plan-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    writeFileSync(join(dir, name), await gc.screenshot(), { mode: 0o600 });
    chmodSync(join(dir, name), 0o600);
    err(
      `saved a screenshot of the console page to ${RUN_DIR}/debug/${name} (readable only by you).\n    It may show partial client details. Delete it when you're done.`,
    );
  } catch (e) {
    err(`couldn't save a screenshot: ${(e as Error).message}`);
  }
}

/** `bb plan --tunnel <url> [--adopt] [--debug]` */
export async function cmdPlan(argv: string[], driver = driverFromEnv()) {
  const { values: flags } = parseArgs({
    args: argv,
    options: { tunnel: { type: "string" }, adopt: { type: "boolean" }, debug: { type: "boolean" } },
  });
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const values: Record<string, string> = {};
  if (flags.tunnel !== undefined) values["tunnel.url"] = flags.tunnel;
  const base = { project: config.project.name, ...describe(config, resolveValues(config, values)) };
  const google = config.destinations.google;
  const profile = google && googleProfile(cwd, config.project.name, driver);

  if (!google || !profile) {
    // Nothing can be read, so no earlier plan may stand in for this one.
    const state = readState(cwd);
    if (state.google?.planned)
      writeState(cwd, { ...state, google: { ...state.google, planned: null } });
    const steps = plan(config, values);
    startRun(cwd, base, { type: "plan", steps });
    process.stdout.write(printPlan(config, steps));
    return;
  }

  const state = readState(cwd);
  const gstate = googleState(state);
  const record = (session: Session) => {
    const local = readLocal(cwd);
    if (local.google)
      writeLocal(cwd, {
        ...local,
        google: { ...local.google, session, checkedAt: new Date().toISOString() },
      });
  };
  const gc = await openGoogleConsole(
    driver,
    profile,
    clientUrl(consoleOrigin(), google.project_id, google.client_id),
  );
  let read: Lists;
  try {
    read = await gc.read();
  } catch (e) {
    if (e instanceof ReauthRequired) record("signed-out");
    if (flags.debug) await saveScreenshot(cwd, gc);
    throw e;
  } finally {
    await gc.close();
  }

  const d = diff(read, desiredLists(config, values), gstate.owned, { adopt: flags.adopt ?? false });
  writeState(cwd, { ...state, google: { ...gstate, planned: { read, next: nextLists(d) } } });
  record("signed-in");
  startRun(cwd, base, { type: "plan", steps: plan(config, values, d) });
  process.stdout.write(printDiff(config, d, profile.browser.name));
}
