import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Action, Step } from "../core/board";
import { driverFromEnv } from "../core/browser/driver";
import { loadConfig } from "../core/config";
import { diff, nextLists } from "../core/diff";
import { withHandoff } from "../core/handoff";
import { desiredLists, plan, resolveValues } from "../core/plan";
import {
  clientUrl,
  type GoogleConsole,
  ReauthRequired,
  SelectorMissing,
} from "../core/recipes/google/console";
import { appendEvent, describe, ensureRunDir, RUN_DIR, type Run, startRun } from "../core/run";
import { consoleOrigin } from "../core/session";
import { googleState, readState, writeState } from "../core/state";
import { DriverConsoles, googleProfile, recordSession, withConsoles } from "./google";
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

/**
 * Forget the last plan when this one couldn't read the console, so `bb apply` never acts on
 * a plan the user didn't just see. Touches nothing else, and nothing at all when no plan stands.
 */
function dropPlan(projectDir: string) {
  const state = readState(projectDir);
  if (state.google?.planned)
    writeState(projectDir, { ...state, google: { ...state.google, planned: null } });
}

function failRun(
  projectDir: string,
  base: Omit<Run, "run" | "seq" | "board">,
  steps: Step[],
  reason: string,
) {
  startRun(projectDir, base, { type: "plan", steps });
  for (const s of steps) appendEvent(projectDir, { type: "fail", id: s.id, note: reason });
}

/** `bb plan --tunnel <url> [--adopt] [--debug]`. Exit code: 0, or 2 when you stopped at a handoff. */
export async function cmdPlan(argv: string[], driver = driverFromEnv()): Promise<number> {
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
    dropPlan(cwd);
    const steps = plan(config, values);
    startRun(cwd, base, { type: "plan", steps });
    process.stdout.write(printPlan(config, steps));
    return 0;
  }

  const state = readState(cwd);
  const gstate = googleState(state);
  const consoles = new DriverConsoles(
    cwd,
    driver,
    profile,
    clientUrl(consoleOrigin(), google.project_id, google.client_id),
  );
  const unread = plan(config, values);
  let handedOff = false;
  const emit = (a: Action) => {
    if (!handedOff) startRun(cwd, base, { type: "plan", steps: unread });
    handedOff = true;
    appendEvent(cwd, a);
  };
  const out = await withConsoles(consoles, () =>
    withHandoff(consoles, unread, emit, async (gc) => {
      try {
        return await gc.read();
      } catch (e) {
        // An earlier plan (maybe for another tunnel) must never be what bb apply acts on.
        if (e instanceof SelectorMissing) {
          dropPlan(cwd);
          failRun(cwd, base, unread, e.message);
        }
        if (flags.debug && !(e instanceof ReauthRequired)) await saveScreenshot(cwd, gc);
        throw e;
      }
    }),
  );
  if ("result" in out) {
    dropPlan(cwd);
    process.stderr.write(
      `bb: Stopped at your turn, before busbar could read the client. Nothing was changed in Google. Run \`bb plan --tunnel ${values["tunnel.url"] ?? "<url>"}\` again to carry on.\n`,
    );
    return 2;
  }
  const read = out;

  const desired = desiredLists(config, values);
  const d = diff(read, desired, gstate.owned, { adopt: flags.adopt ?? false });
  const planned = { values: resolveValues(config, values), desired, read, next: nextLists(d) };
  writeState(cwd, { ...state, google: { ...gstate, planned } });
  recordSession(cwd, "signed-in");
  startRun(cwd, base, { type: "plan", steps: plan(config, values, d) });
  process.stdout.write(printDiff(config, d, profile.browser.name));
  return 0;
}
