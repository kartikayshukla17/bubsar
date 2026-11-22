import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't boot the React Router plugin.
export default defineConfig({
  resolve: { alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["test/helpers/build.ts"],
    // Most CLI tests spawn the built bb several times; under heavy machine load they crept
    // up on vitest's 5s default (BB-03 report).
    testTimeout: 20_000,
  },
});
