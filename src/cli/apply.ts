import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { type ApplyIO, applyPlan, ownedAfter, plannedSteps } from "../core/apply";
import { driverFromEnv } from "../core/browser/driver";
import { type Config, loadConfig } from "../core/config";
import { desiredLists } from "../core/plan";
import { clientUrl, ReauthRequired, sameLists } from "../core/recipes/google/console";
import { appendEvent, describe, readRun, startRun } from "../core/run";
import { consoleOrigin } from "../core/session";
import { googleState, type Planned, readState, writeState } from "../core/state";
import { googleProfile, openGoogleConsole, recordSession, withConsole } from "./google";
import { printApplied, printApply } from "./print";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function stillDesired(config: Config, planned: Planned) {
  try {
    return sameLists(desiredLists(config, planned.values), planned.desired);
  } catch {
    return false;
  }
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    let line = "";
    rl.once("line", (l) => {
      line = l;
      rl.close();
    });
    rl.once("close", () => {
      process.stdin.pause();
      resolve(line);
    });
  });
}

async function confirm(changes: number, yes: boolean) {
  const n = plural(changes, "change");
  if (yes) {
    process.stdout.write(`--yes: applying ${n} without asking.\n`);
    return true;
  }
  if (!process.stdin.isTTY)
    throw new Error(
      "Not applied: there's no terminal to confirm in. Run `bb apply --yes` to apply without asking.",
    );
  process.stdout.write(`Apply ${n} to Google? [y/N] `);
  return /^y(es)?$/i.test((await readLine()).trim());
}

export async function cmdApply(argv: string[], driver = driverFromEnv()) {
  const { values: flags } = parseArgs({ args: argv, options: { yes: { type: "boolean" } } });
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const state = readState(cwd);
  const gstate = googleState(state);
  const { planned } = gstate;
  const google = config.destinations.google;
  if (!planned?.values || !planned.desired)
    throw new Error("No plan to apply. Run `bb plan --tunnel <url>` first.");
  if (!google || !stillDesired(config, planned))
    throw new Error("busbar.toml changed since you planned. Run `bb plan` again.");

  if (sameLists(planned.read, planned.next)) {
    process.stdout.write(
      "Nothing to apply: the last plan has no changes left. Run `bb plan` to read Google again.\n",
    );
    return;
  }

  const profile = googleProfile(cwd, config.project.name, driver);
  if (!profile)
    throw new Error(
      "busbar isn't logged in to Google in this project. Run `bb login google`, then `bb plan` again.",
    );
  const steps =
    readRun(cwd)?.board.steps ??
    startRun(
      cwd,
      { project: config.project.name, ...describe(config, planned.values) },
      { type: "plan", steps: plannedSteps(config, planned) },
    ).board.steps;
  const gc = await openGoogleConsole(
    driver,
    profile,
    clientUrl(consoleOrigin(), google.project_id, google.client_id),
  );
  const io: ApplyIO = {
    show: (read, next) =>
      process.stdout.write(printApply(config, read, next, profile.browser.name)),
    confirm: (n) => confirm(n, flags.yes ?? false),
    saved: (saved, asPlanned) =>
      writeState(cwd, {
        ...state,
        google: {
          ...gstate,
          owned: ownedAfter(gstate.owned, planned.read, planned.next, saved),
          planned: asPlanned ? { ...planned, read: saved, next: saved } : planned,
        },
      }),
    emit: (a) => appendEvent(cwd, a),
  };
  const out = await withConsole(gc, () => applyPlan(gc, planned, steps, io));

  switch (out.result) {
    case "changed":
      throw new Error("Google changed since you planned. Run `bb plan` again.");
    case "declined":
      throw new Error("Not applied: you answered no. Nothing changed in Google.");
    case "applied":
      process.stdout.write(printApplied(planned.read, planned.next));
      return;
    case "failed":
      if (out.error instanceof ReauthRequired) recordSession(cwd, "signed-out");
      throw out.error;
  }
}
