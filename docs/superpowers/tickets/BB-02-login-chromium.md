# BB-02: `bb login google`: pick a browser, sign in once

**Demo when done:** `bb login google` lists your installed browsers. You pick Brave, a Brave
window opens on busbar's own profile, and you sign into Google yourself. Run it again later
and busbar says you're already signed in, with no window and no login. `bb status` shows
`google: signed in · Brave`. Same flow works with Dia.

**Depends on:** BB-01
**Layers:** cli · core (`BrowserDriver`, profile store) · run state · ui (session chip) · browser

## Why this slice

It proves the credential model (B2): a dedicated persistent profile you sign into once,
which busbar uses without ever seeing a password or cookie. It's also the riskiest
assumption in the MVP, so it goes first among the browser slices.

## Scope

- **Step 0, de-risk spike (do first, report back before building the rest):**
  1. Spawn Brave as a plain process with `--user-data-dir=<busbar profile>` (no automation)
     and confirm Google sign-in completes without "This browser or app may not be secure".
  2. Quit, relaunch the same profile through `puppeteer-core` over `--remote-debugging-pipe`,
     open `console.cloud.google.com`, and confirm it loads signed in.
  3. Repeat with `--headless=new`. Record whether Google serves a challenge.
  4. Repeat 1–2 on Dia.

  If step 1 or 2 fails, stop and bring it back. The design needs revisiting.
- **Browser detection:** find installed Chromium browsers (Brave, Dia, Chrome, Edge) by
  bundle path. Print them; if you have just one, pick it automatically. Remember the choice
  per project in `.busbar/local.json`.
- **Profile store:** `~/Library/Application Support/busbar/profiles/<project>/<browser>/`,
  created with mode `0700`.
- **Real Keychain encryption:** launch without Puppeteer's `--use-mock-keychain` /
  `--password-store=basic` defaults, so the profile's cookies are encrypted with the browser's
  own Keychain "Safe Storage" key, the same protection as your normal browser.
- **Login flow:** open the plain (un-automated) window at the Google sign-in page with a
  `continue` to the Cloud console. busbar waits for you to close the window, then confirms the
  session with a short automated check (console loads without an accounts redirect).
- **`bb status`:** per provider: signed in / signed out / never logged in, which browser, and
  where the profile lives. The session check runs headless if the spike says that's safe,
  otherwise headed and minimized.
- **`bb login google --browser dia`** to switch browsers, and **`bb logout google`** to delete
  that profile.
- **UI:** the board header shows a small session chip (`Google · Brave · signed in`), fed from
  run state.

## Acceptance criteria

- [ ] Spike results written into this ticket (pass/fail per step, per browser).
- [ ] Fresh project: `bb login google` → pick Brave → sign in → `bb status` shows signed in.
- [ ] Second `bb login google` makes no window appear and says "already signed in".
- [ ] Works the same on Dia.
- [x] Chrome/Edge are detected if installed. They aren't installed here, so mark them
      "untested on this machine" in the PR, not "supported".
- [ ] Your everyday Brave keeps running untouched during all of this (separate data dir,
      separate process).
- [ ] The profile's `Cookies` DB has `encrypted_value` rows prefixed `v10` and empty `value`
      columns. That proves real Keychain encryption; the test checks the prefix, not
      contents.
- [x] DoD check 2 passes: busbar's own code never opens any cookie or password store
      (`scripts/guard.mjs` in `npm run lint`).
- [ ] The check above lives in a test helper excluded from `src/`: written
      (`test/helpers/keychain-check.ts`, run by `test/keychain.test.ts` when
      `BB_REAL_PROFILE` is set); proving it on a real signed-in profile is pending (step 6).
- [x] `bb logout google` removes the profile dir, and `bb status` shows "never logged in".

## Out of scope

Reading or writing anything in the console (BB-03+), Firefox (BB-08), re-auth handoff (BB-06).

## Notes & risks

- Google may block sign-in in automated browsers. That's why the login window carries no
  automation at all. If Google still blocks the *later* automated console load, it surfaces
  in the spike.
- Two Brave icons in the Dock while busbar runs is expected. Mention it in the login output.

## Done (2026-11-22)

Built on the fake world (`BB_FAKE`); nothing here has touched real Google. The boxes ticked
above are the ones tests proved. The rest need Kartikay at a browser, listed at the end.

**Tests (31 new, 62 total, vitest; `test/keychain.test.ts` skipped unless `BB_REAL_PROFILE` is set):**
- `src/core/browser/args.test.ts` (seam 4): the plain window carries no
  `--remote-debugging-*`, `--use-mock-keychain`, `--password-store`, `--enable-automation`
  or `--headless`; automation uses `pipe: true` and never a port; `keychain: "real"` drops the
  mock keychain and basic password store, `"mock"` keeps them; `loopbackOnly` adds the
  dead-proxy and resolver flags, production adds nothing.
- `src/core/browser/browsers.test.ts` (seam 1): detection against temp app roots: bundle
  paths for Brave, Dia, Chrome, Edge, Firefox, stable order, first root wins, a bundle
  without its executable is ignored.
- `test/login.test.ts`, `test/status.test.ts`, `test/logout.test.ts` (seam 3, built
  `dist/bb.js` + fake world): one browser auto-picked; several listed with the exact
  `--browser` commands and nothing opened; `--browser dia` used and remembered; second login
  opens no window ("already signed in", `openPlainCalls` stays 1); closing the window
  without signing in exits 1; an expired session reopens the window; a `project.name` that
  would escape `profiles/` is refused; status never-logged-in / signed in / signed out /
  Chrome "untested on this machine" / uninstalled browser / a leftover profile from an earlier
  browser / profiles with no local record (never "never logged in" while one exists);
  logout removes every profile the project has, even after switching browsers, and status
  returns to "never logged in"; a browser id in `local.json` that would climb out of
  `profiles/` is refused with exit 1 and nothing deleted. Profile dir is checked to be
  `0700`.
- `test/daemon.test.ts` (seam 3): `GET /api/session`, and a `session` SSE event within 1s
  of a login in another terminal.
- `test/puppeteer.test.ts` (seam 2): `PuppeteerDriver` attaches headless to a temp profile
  on installed Brave with `keychain: "mock"` and `loopbackOnly`, drives a loopback page
  through every `Page` op, closes, and leaves the profile unlocked. Tests never launch Dia
  (see the decision below).

**Decisions made here:**
- `openPlain` resolves on Enter in the terminal or the browser process exiting, then sends
  SIGTERM (SIGKILL after 10s) so the profile is unlocked before any automated attach.
- Session check: attach, load `${BB_GOOGLE_CONSOLE_ORIGIN}/`, signed in unless the final
  URL's host is `accounts.google.com`. `sessionCheck.headless` in `src/core/session.ts` is
  the one switch, `false` (headed, minimized via `setWindowBounds`) until spike step 3 says
  headless is safe.
- `bb login` picks: `--browser`, else the browser remembered in `.busbar/local.json`, else
  the only installed Chromium, else it lists them and exits 1 (no interactive prompt).
- An existing profile is checked first; only a missing or signed-out profile opens a window.
  A new profile is recorded as `signed-out` right away, so a crash mid-login still shows up
  in `bb status` and `bb logout` can remove it.
- `bb status` runs a live check every time and rewrites `local.json`. Its profile line says
  what busbar does ("run with Brave's real Keychain encryption, not a mock"), not what the
  `v10` check below hasn't proven yet.
- `bb logout google` deletes every `profiles/<project>/<known browser id>` that exists and
  names each one. Profiles are per project + browser, so a later second provider would
  share them; revisit logout's scope then. Project names are limited to
  `[A-Za-z0-9][\w.-]*`, and `local.json`'s browser id must be one busbar knows, because
  those become the folders logout deletes.
- **Test browsers are loopback-only, and are Brave only.** A probe found headless Brave,
  even with Puppeteer's `--disable-background-networking`, opens its own connections:
  DNS-over-HTTPS to Google Public DNS (`2001:4860:4860::8888`) plus Brave/AWS/Fastly hosts.
  One smoke-test run went out that way before the fix. `loopbackOnly` adds a dead proxy,
  `--host-resolver-rules`, `--disable-features=DnsOverHttps` (DoH can target an IP
  literal), `--disable-component-update`, `--disable-domain-reliability` and `--no-pings`.
  With it, an lsof probe of Brave's process tree saw loopback only (12s probe, and 13
  samples during the real smoke test). **Dia under the same flags kept six connections open
  to Google Cloud and AWS hosts**: its own app networking ignores Chromium's flags. So tests
  never launch Dia. `test/helpers/browser.ts` exports `testBrowsers`, chosen by
  `pickTestBrowsers`: Brave always, Dia never, and Firefox only with `BB_TEST_FIREFOX=1` and
  an unquarantined bundle (BB-08). Recipe tests use them with
  `new PuppeteerDriver({ keychain: "mock", loopbackOnly: true })`.
- `/api/session` serves `local.json` plus `browserName`, so the SPA doesn't import
  `browsers.ts` (which uses `node:fs`). The board shows `Google · Brave · signed in`,
  `… · signed out`, or `Google · not logged in` when the run wires Google.
- `puppeteer-core` 25.18.1 is loaded lazily inside `attach`, so `bb plan`/`bb status`
  with no profile don't pay for it.

### Real-world checks pending

Run these as part of the one ordered session in [REAL-WORLD-CHECKLIST.md](../REAL-WORLD-CHECKLIST.md). It sets the order and the setup, and this list keeps the detail.

Run these in a scratch project, never in a real one:
`mkdir -p ~/bb-spike && cd ~/bb-spike && printf '[project]\nname = "spike"\n' > busbar.toml`.
`bb` is the packed build (`npm run build && npm pack && npm i -g ./busbar-*.tgz`) or
`node <repo>/dist/bb.js`. P = `$HOME/Library/Application Support/busbar/profiles/spike`.

1. **Spike step 1 + 2 + acceptance "fresh project → Brave → signed in" (Brave).**
   `bb login google --browser brave`. A plain Brave window opens at Google sign-in. Record:
   does Google say "This browser or app may not be secure"? Sign in (MFA yourself), wait
   for the console, press Enter. Expect a second Brave icon in the Dock while it's open,
   your everyday Brave untouched, then `google: signed in · Brave` after a minimized
   window loads the console (step 2: automation over `--remote-debugging-pipe`). Record
   whether the minimized window flashed on screen first. Then `bb status` → signed in.
   If step 1 or 2 fails, stop: the design needs revisiting.
2. **Enter vs Cmd-Q.** `bb logout google`, then `bb login google` again and this time quit
   busbar's Brave with Cmd-Q instead of pressing Enter. Expect the same result. Confirm
   `ls "$P/brave"` shows no `SingletonLock` afterwards.
3. **Redirect timing.** From the repo root (so `puppeteer-core` resolves), with the profile
   from step 1, run:
   ```sh
   node --input-type=module -e '
   import puppeteer from "puppeteer-core";
   const b = await puppeteer.launch({ executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
     userDataDir: process.env.HOME + "/Library/Application Support/busbar/profiles/spike/brave",
     pipe: true, headless: process.env.HEADLESS === "1", ignoreDefaultArgs: ["--use-mock-keychain", "--password-store=basic"] });
   const [p] = await b.pages();
   await p.goto("https://console.cloud.google.com/", { waitUntil: "load" });
   console.log("at load:", p.url());
   await new Promise((r) => setTimeout(r, 5000));
   console.log("after 5s:", p.url());
   await p.screenshot({ path: "spike-" + (process.env.HEADLESS === "1" ? "headless" : "headed") + ".png" });
   await b.close();'
   ```
   Both URLs should be on `console.cloud.google.com`. If "after 5s" differs from "at load"
   (a script redirect), `checkSession` must wait for it before reading the URL.
4. **Spike step 3 (headless).** Same command with `HEADLESS=1`. Record whether Google
   serves a challenge (final URL on `accounts.google.com`, or a challenge in the
   screenshot). If it loads signed in, set `sessionCheck.headless = true` in
   `src/core/session.ts`.
5. **Spike step 4 + "Works the same on Dia".** Repeat 1–4 with `--browser dia` and
   `Dia.app/Contents/MacOS/Dia`. Then `bb login google` again: expect "already signed in"
   with no window (the second-login acceptance item, for real).
6. **Keychain encryption (`v10`).** With busbar's Brave closed, from the repo root:
   ```sh
   BB_REAL_PROFILE="$P/brave" npx vitest run test/keychain.test.ts
   ```
   It passes when every row's `encrypted_value` starts with `v10` and no `value` is
   plaintext. It reads counts only, never cookie contents. Then tick both Keychain boxes.
   Note: a profile run with Puppeteer's *mock* keychain writes `v11`, and the test fails on
   it (checked here on a throwaway profile). If the real profile also shows something other
   than `v10`, record the prefix: the acceptance wording needs revisiting, not the helper.
   Repeat with `$P/dia`. The first `bb status` after a fresh login may raise one macOS
   Keychain prompt for "Brave Safe Storage"; record whether it does.
7. **Board chip.** `bb ui` in the spike project, then `bb login google` / `bb logout google`
   in another terminal: the header chip should change within a second without a reload.
   (Checked headless against the fake world here; screenshots not committed.)
8. **Clean up:** `bb logout google` (removes and names both profiles), then
   `rm -rf ~/bb-spike`.

