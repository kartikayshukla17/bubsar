import { detectBrowsers } from "../../src/core/browser/browsers";

/**
 * The installed browser that tests may launch: Brave only. With `loopbackOnly`, an lsof
 * probe showed Brave holding loopback connections only. Dia, under the same flags, kept six
 * connections to Google Cloud and AWS hosts open: its own app networking ignores Chromium's
 * proxy and resolver flags, so tests never launch it (BB-02 report). Undefined when Brave
 * isn't installed; tests that need it use `skipIf(!testBrowser)`.
 */
export const testBrowser = detectBrowsers(["/Applications"]).find((b) => b.id === "brave");
