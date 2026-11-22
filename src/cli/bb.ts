import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cmdApply } from "./apply";
import { serve } from "./daemon";
import { cmdPlan } from "./plan";
import { cmdLogin, cmdLogout, cmdStatus } from "./session";

declare const __BB_VERSION__: string;

function fail(message: string): never {
  process.stderr.write(`bb: ${message}\n`);
  process.exit(1);
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
      await cmdPlan(rest);
      break;
    case "apply":
      await cmdApply(rest);
      break;
    case "ui":
      await cmdUi(rest);
      break;
    case "login":
      await cmdLogin(rest);
      break;
    case "status":
      await cmdStatus();
      break;
    case "logout":
      cmdLogout(rest);
      break;
    default:
      fail(
        `unknown command ${command ?? "(none)"}. Try: bb plan --tunnel <url>, bb apply, bb login google, bb status`,
      );
  }
} catch (e) {
  fail((e as Error).message);
}
