import { detectBrowsers } from "../../src/core/browser/browsers";

/**
 * The installed browsers that tests may launch: Brave for Chromium, Firefox for WebDriver
 * BiDi, each only when installed. With `loopbackOnly`, lsof probes showed both holding
 * loopback connections only (BB-02 and BB-08 reports). Dia, under the same flags, kept six
 * connections to Google Cloud and AWS hosts open: its own app networking ignores Chromium's
 * proxy and resolver flags, so tests never launch it.
 */
export const testBrowsers = detectBrowsers(["/Applications"]).filter(
  (b) => b.id === "brave" || b.id === "firefox",
);
