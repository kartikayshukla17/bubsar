import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseConfig } from "../core/config";
import { plan, resolveValues } from "../core/plan";
import { describe, startRun } from "../core/run";
import { serve } from "./daemon";
import { printPlan } from "./print";

declare const __BB_VERSION__: string;

function fail(message: string): never {
  process.stderr.write(`bb: ${message}\n`);
  process.exit(1);
}

function cmdPlan(argv: string[]) {
  const { values: flags } = parseArgs({ args: argv, options: { tunnel: { type: "string" } } });
  const file = join(process.cwd(), "busbar.toml");
  if (!existsSync(file))
    fail("no busbar.toml here. Run bb in your project's root, next to busbar.toml.");
  const config = parseConfig(readFileSync(file, "utf8"));
  const values: Record<string, string> = {};
  if (flags.tunnel !== undefined) values["tunnel.url"] = flags.tunnel;
  const steps = plan(config, values);
  startRun(
    process.cwd(),
    { project: config.project.name, ...describe(config, resolveValues(config, values)) },
    { type: "plan", steps },
  );
  process.stdout.write(printPlan(config, steps));
}

async function cmdUi(argv: string[]) {
  const { values: flags } = parseArgs({ args: argv, options: { "no-open": { type: "boolean" } } });
  // dist/bb.js → the package root's build/client, where `npm run build` puts the SPA.
  const clientDir = join(dirname(fileURLToPath(import.meta.url)), "..", "build", "client");
  const { url } = await serve(process.cwd(), clientDir);
  process.stdout.write(`bb ui · ${url}\nWatching .busbar/ in ${process.cwd()}. Ctrl-C to stop.\n`);
  if (!flags["no-open"]) {
    const opener =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "explorer"
          : "xdg-open";
    execFile(opener, [url.href], () => {});
  }
}

const [command, ...rest] = process.argv.slice(2);
try {
  switch (command) {
    case "--version":
    case "-v":
      process.stdout.write(`busbar ${__BB_VERSION__}\n`);
      break;
    case "plan":
      cmdPlan(rest);
      break;
    case "ui":
      await cmdUi(rest);
      break;
    default:
      fail(`unknown command ${command ?? "(none)"}. Try: bb plan --tunnel <url>`);
  }
} catch (e) {
  fail((e as Error).message);
}
