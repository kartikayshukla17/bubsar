// Bundle the `bb` CLI into dist/bb.js. Published packages can't rely on Node's type
// stripping (it refuses files under node_modules), so the CLI ships as plain JS.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

await build({
  entryPoints: ["src/cli/bb.ts"],
  outfile: "dist/bb.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  banner: { js: "#!/usr/bin/env node" },
  define: { __BB_VERSION__: JSON.stringify(version) },
  logLevel: "warning",
});
