import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import {
  type ApplyIO,
  type ApplyOutcome,
  applyPlan,
  ownedAfter,
  plannedSteps,
} from "../core/apply";
import type { Step } from "../core/board";
import { driverFromEnv } from "../core/browser/driver";
import { type Config, loadConfig } from "../core/config";
import { exitCode } from "../core/exit";
import { desiredLists } from "../core/plan";
import { sameLists } from "../core/recipes/google/console";
import { appendEvent, describe, readRun, startRun } from "../core/run";
import { googleState, type Planned, readState, writeState } from "../core/state";
import {
  DriverConsoles,
  googleClientUrl,
  googleProfile,
  recordSession,
  withConsoles,
} from "./google";
import { printApplied, printApply, printLanded } from "./print";

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

export async function applyGoogle(
  cwd: string,
  config: Config,
  planned: Planned,
  steps: Step[],
  consoles: DriverConsoles,
  o: { yes: boolean; show: boolean },
): Promise<ApplyOutcome> {
  const state = readState(cwd);
  const gstate = googleState(state);
  const io: ApplyIO = {
    show: (read, next) => {
      if (o.show) process.stdout.write(printApply(config, read, next, consoles.browser));
    },
    confirm: (n) => confirm(n, o.yes),
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
  const out = await applyPlan(consoles, planned, steps, io);
  if (consoles.handoffs > 0 && out.result !== "stopped" && out.result !== "failed")
    recordSession(cwd, "signed-in");
  return out;
}

/** `bb apply [--yes]`. Exit code: 0, or 2 when you stopped at a handoff. */
export async function cmdApply(argv: string[], driver = driverFromEnv()): Promise<number> {
  const { values: flags } = parseArgs({ args: argv, options: { yes: { type: "boolean" } } });
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const { planned } = googleState(readState(cwd));
  const google = config.destinations.google;
  if (!google) {
    process.stdout.write("Nothing to apply: busbar.toml has no Google destination.\n");
    return 0;
  }
  if (!planned?.values || !planned.desired)
    throw new Error("No plan to apply. Run `bb plan --tunnel <url>` first.");
  if (!stillDesired(config, planned))
    throw new Error("busbar.toml changed since you planned. Run `bb plan` again.");

  if (sameLists(planned.read, planned.next)) {
    process.stdout.write(
      "Nothing to apply: the last plan has no changes left. Run `bb plan` to read Google again.\n",
    );
    return 0;
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
  const consoles = new DriverConsoles(cwd, driver, profile, googleClientUrl(google));
  const out = await withConsoles(consoles, () =>
    applyGoogle(cwd, config, planned, steps, consoles, { yes: flags.yes ?? false, show: true }),
  );

  switch (out.result) {
    case "changed":
      throw new Error("Google changed since you planned. Run `bb plan` again.");
    case "declined":
      throw new Error("Not applied: you answered no. Nothing changed in Google.");
    case "refused":
    case "failed":
      throw out.error;
    case "applied":
      process.stdout.write(printApplied(planned.read, planned.next));
      return exitCode({ ended: "finished", required: [] });
    case "landed":
      process.stdout.write(printLanded(planned.read, planned.next));
      return exitCode({ ended: "finished", required: [] });
    case "stopped":
      process.stderr.write(
        out.reauth.afterSave
          ? "bb: Stopped at your turn. Google confirmed the Save, but busbar hasn't read the client back. Run `bb apply` again to read it and record what landed.\n"
          : "bb: Stopped at your turn. Nothing was changed in Google. Run `bb apply` again to carry on.\n",
      );
      return exitCode({ ended: "stopped" });
  }
}
