import { parseArgs } from "node:util";
import { plannedSteps } from "../core/apply";
import { loadConfig } from "../core/config";
import { sameLists } from "../core/recipes/google/console";
import { appendEvent, describe, readRun, startRun } from "../core/run";
import { googleState, readState, writeState } from "../core/state";
import { askAuthorize, authUrl } from "../core/verify/authorize";
import { stepsMatch, targets, verifyGoogle } from "../core/verify/verify";
import { printVerified, printVerifyHead } from "./print";

function waitSeconds(raw: string | undefined) {
  if (raw === undefined) return 600;
  if (!/^\d+$/.test(raw)) throw new Error(`--wait ${raw}: expected whole seconds, like --wait 600`);
  return Number(raw);
}

export async function cmdVerify(argv: string[]): Promise<number> {
  const { values: flags } = parseArgs({ args: argv, options: { wait: { type: "string" } } });
  const waitMs = waitSeconds(flags.wait) * 1000;
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const google = config.destinations?.google;
  const gstate = googleState(readState(cwd));
  const { planned } = gstate;

  if (!google) {
    process.stdout.write("Nothing to verify: busbar.toml has no Google destination.\n");
    return 0;
  }
  if (!planned?.values || !planned.desired) {
    process.stdout.write(
      "Nothing to verify: busbar hasn't read this client yet. Run `bb plan --tunnel <url>`, then `bb apply`.\n",
    );
    return 0;
  }
  if (!sameLists(planned.read, planned.next))
    throw new Error("The last plan isn't applied yet. Run `bb apply`, then `bb verify`.");
  const want = targets(planned, gstate.owned);
  if (!want.redirectUris.length) {
    process.stdout.write(
      "Nothing to verify: none of the redirect URIs busbar wants or owns are on the client.\n",
    );
    return 0;
  }

  const steps =
    readRun(cwd)?.board.steps ??
    startRun(
      cwd,
      { project: config.project.name, ...describe(config, planned.values) },
      { type: "plan", steps: plannedSteps(config, planned) },
    ).board.steps;
  if (!stepsMatch(steps, want))
    throw new Error(
      "The board's last run doesn't match the last plan, so busbar can't say which strip a check proves. Run `bb plan` again, then `bb verify`.",
    );
  process.stdout.write(printVerifyHead(config));
  const endpoint = authUrl();
  const out = await verifyGoogle(want, steps, waitMs, {
    ask: (uri) => askAuthorize(endpoint, google.client_id, uri),
    clock: { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    emit: (a) => appendEvent(cwd, a),
    record: (c) => {
      const state = readState(cwd);
      const g = googleState(state);
      writeState(cwd, { ...state, google: { ...g, checks: [...g.checks, c] } });
    },
    waiting: (uri, ms) =>
      process.stdout.write(
        `Google hasn't accepted ${uri} yet: waiting for Google to pick up the change. Asking again in ${Math.ceil(ms / 1000)}s.\n`,
      ),
  });
  process.stdout.write(printVerified(out));
  return out.code;
}
