import { execFileSync } from "node:child_process";

// Process-level tests run the built binary, so they also catch bundling mistakes.
export default function setup() {
  execFileSync(process.execPath, ["scripts/build-cli.mjs"], { stdio: "inherit" });
}
