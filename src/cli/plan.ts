import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Action, Step } from "../core/board";
import { driverFromEnv } from "../core/browser/driver";
import { type Config, loadConfig } from "../core/config";
import { type Diff, diff, nextLists } from "../core/diff";
import { type Stopped, withHandoff } from "../core/handoff";
import { desiredLists, plan, resolveValues } from "../core/plan";
import {
  type GoogleConsole,
  ReauthRequired,
  SelectorMissing,
} from "../core/recipes/google/console";
import { appendEvent, describe, ensureRunDir, RUN_DIR, type Run, startRun } from "../core/run";
import { googleState, type Planned, readState, writeState } from "../core/state";
import {
  DriverConsoles,
  googleClientUrl,
  googleProfile,
  recordSession,
  withConsoles,
} from "./google";
import { lockProject } from "./lock";
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
 * Forget the last plan before reading the console again, so `bb apply` never acts on a plan
 * the user didn't just see. Touches nothing else, and nothing at all when no plan stands.
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

export type Planning = { d: Diff; planned: Planned; steps: Step[] };

export async function planGoogle(
  cwd: string,
  config: Config,
  values: Record<string, string>,
  consoles: DriverConsoles,
  o: { adopt?: boolean; debug?: boolean } = {},
): Promise<Planning | Stopped> {
  const base = { project: config.project.name, ...describe(config, resolveValues(config, values)) };
  dropPlan(cwd);
  const state = readState(cwd);
  const gstate = googleState(state);
  const unread = plan(config, values);
  let handedOff = false;
  const emit = (a: Action) => {
    if (!handedOff) startRun(cwd, base, { type: "plan", steps: unread });
    handedOff = true;
    appendEvent(cwd, a);
  };
  const out = await withHandoff(consoles, unread, emit, async (gc) => {
    try {
      return await gc.read();
    } catch (e) {
      if (e instanceof SelectorMissing) failRun(cwd, base, unread, e.message);
      if (o.debug && !(e instanceof ReauthRequired)) await saveScreenshot(cwd, gc);
      throw e;
    }
  });
  if ("result" in out) return out;

  const desired = desiredLists(config, values);
  const d = diff(out, desired, gstate.owned, { adopt: o.adopt ?? false });
  const planned = { values: resolveValues(config, values), desired, read: out, next: nextLists(d) };
  writeState(cwd, { ...state, google: { ...gstate, planned } });
  recordSession(cwd, "signed-in");
  const steps = plan(config, values, d);
  startRun(cwd, base, { type: "plan", steps });
  return { d, planned, steps };
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
  lockProject(cwd);
  const google = config.destinations.google;
  if (!google) {
    process.stdout.write(
      "Nothing to plan: busbar.toml has no Google destination. Add a [destinations.google] table.\n",
    );
    return 0;
  }
  const profile = googleProfile(cwd, config.project.name, driver);

  if (!profile) {
    dropPlan(cwd);
    const steps = plan(config, values);
    startRun(cwd, base, { type: "plan", steps });
    process.stdout.write(printPlan(config, steps));
    return 0;
  }

  const consoles = new DriverConsoles(cwd, driver, profile, googleClientUrl(google));
  const out = await withConsoles(consoles, () =>
    planGoogle(cwd, config, values, consoles, { adopt: flags.adopt, debug: flags.debug }),
  );
  if ("result" in out) {
    process.stderr.write(
      `bb: Stopped at your turn, before busbar could read the client. Nothing was changed in Google. Run \`bb plan --tunnel ${values["tunnel.url"] ?? "<url>"}\` again to carry on.\n`,
    );
    return 2;
  }
  process.stdout.write(printDiff(config, out.d, profile.browser.name));
  return 0;
}
