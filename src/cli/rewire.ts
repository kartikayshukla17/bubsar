import { parseArgs } from "node:util";
import type { ApplyOutcome } from "../core/apply";
import { driverFromEnv } from "../core/browser/driver";
import { loadConfig } from "../core/config";
import type { Diff } from "../core/diff";
import { exitCode } from "../core/exit";
import { desiredLists, resolveValues } from "../core/plan";
import { alreadyWired, type RewireOutcome, rewire, rewireEnding } from "../core/rewire";
import { googleState, readState } from "../core/state";
import { targets } from "../core/verify/verify";
import { applyGoogle } from "./apply";
import { DriverConsoles, googleClientUrl, googleProfile, withConsoles } from "./google";
import { planGoogle } from "./plan";
import { printDiff, printRewired } from "./print";
import { checkGoogle, waitSeconds } from "./verify";

const ALREADY = "Already wired. Run `bb verify` to re-check.";

function notApplied(o: Extract<RewireOutcome, { result: "failed" }>["apply"], again: string) {
  switch (o.result) {
    case "changed":
      return `Google's client changed between busbar's two reads. Nothing was changed in Google. Run \`${again}\` again.`;
    case "declined":
      return "Not applied: you answered no. Nothing changed in Google.";
    case "refused":
      return `Not applied: there's no terminal to confirm in. Run \`${again} --yes\` to apply without asking.`;
    case "failed":
      return o.error.message;
  }
}

function stoppedMessage(o: Extract<RewireOutcome, { result: "stopped" }>, again: string) {
  if (o.at === "plan")
    return `Stopped at your turn, before busbar could read the client. Nothing was changed in Google. Run \`${again}\` again to carry on.`;
  return o.stopped.reauth.afterSave
    ? "Stopped at your turn. Google confirmed the Save, but busbar hasn't read the client back. Run `bb apply` to read it and record what landed, then `bb verify`."
    : `Stopped at your turn. Nothing was changed in Google. Run \`${again}\` again to carry on.`;
}

const savedLine = (o: ApplyOutcome) =>
  o.result === "landed"
    ? "Google already holds exactly the planned lists: an earlier Save landed. busbar recorded its entries and wrote nothing.\n"
    : "Saved. Google's lists read back exactly as planned.\n";

/** `bb rewire --tunnel <url> [--yes] [--wait <seconds>]`: plan, confirm, apply and verify. */
export async function cmdRewire(argv: string[], driver = driverFromEnv()): Promise<number> {
  const { values: flags } = parseArgs({
    args: argv,
    options: { tunnel: { type: "string" }, yes: { type: "boolean" }, wait: { type: "string" } },
  });
  const waitMs = waitSeconds(flags.wait) * 1000;
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const values = resolveValues(
    config,
    flags.tunnel === undefined ? {} : { "tunnel.url": flags.tunnel },
  );
  const again = `bb rewire --tunnel ${values["tunnel.url"]}`;
  const google = config.destinations.google;
  if (!google) {
    process.stdout.write(
      "Nothing to rewire: busbar.toml has no Google destination. Add a [destinations.google] table.\n",
    );
    return exitCode({ ended: "finished", required: [] });
  }
  if (alreadyWired(googleState(readState(cwd)), values, desiredLists(config, values))) {
    process.stdout.write(
      `${ALREADY}\nbusbar didn't open Google this time: its last read of the client, for this tunnel, already held every entry busbar.toml wants. \`bb plan --tunnel ${values["tunnel.url"]}\` reads it again.\n`,
    );
    return exitCode({ ended: "finished", required: [] });
  }
  const profile = googleProfile(cwd, config.project.name, driver);
  if (!profile)
    throw new Error(
      `busbar isn't logged in to Google in this project. Run \`bb login google\`, then \`${again}\`.`,
    );

  const consoles = new DriverConsoles(cwd, driver, profile, googleClientUrl(google));
  let d: Diff | undefined;
  const out = await withConsoles(consoles, () =>
    rewire({
      plan: async () => {
        const p = await planGoogle(cwd, config, values, consoles);
        if ("result" in p) return p;
        d = p.d;
        process.stdout.write(`${printDiff(config, p.d, consoles.browser, "rewire")}\n`);
        return p;
      },
      apply: async (planned, steps) => {
        try {
          const o = await applyGoogle(cwd, config, planned, steps, consoles, {
            yes: flags.yes ?? false,
            show: false,
          });
          if (o.result === "applied" || o.result === "landed") process.stdout.write(savedLine(o));
          return o;
        } finally {
          await consoles.close();
        }
      },
      verify: (steps) => {
        process.stdout.write(
          "Asking Google's authorize endpoint about the redirect URI, signed out: no browser, no session.\n",
        );
        const g = googleState(readState(cwd));
        if (!g.planned) throw new Error("state.json lost the plan busbar just applied.");
        return checkGoogle(cwd, google.client_id, targets(g.planned, g.owned), steps, waitMs);
      },
    }),
  );

  switch (out.result) {
    case "wired":
      process.stdout.write(`${ALREADY}\n`);
      break;
    case "stopped":
      process.stderr.write(`bb: ${stoppedMessage(out, again)}\n`);
      break;
    case "failed":
      process.stderr.write(`bb: ${notApplied(out.apply, again)}\n`);
      break;
    case "checked":
      if (d) process.stdout.write(printRewired(d, out.verify));
      break;
  }
  return exitCode(rewireEnding(out));
}
