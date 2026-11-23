# BB-08: Firefox

**Demo when done:** on a machine with regular Firefox installed, `bb login google` offers
Firefox. You sign in once in a Firefox window on busbar's own profile, and `bb rewire
--tunnel <url>` runs the whole loop in Firefox to **verified**, the same as Brave.

**Depends on:** BB-07
**Layers:** core (`BrowserDriver` Firefox adapter) · cli (detection) · browser

## Why this slice

Developers use Firefox. Safari is out. Firefox needs a different protocol (WebDriver BiDi,
not CDP), so it's its own slice once the Chromium path is solid. If the recipe and driver
seams from earlier slices are right, this slice touches only the adapter.

## Scope

- **Step 0, spike:** install Firefox (it isn't on this machine), then confirm with
  `puppeteer-core` over WebDriver BiDi:
  1. a plain-launched Firefox on a dedicated `--profile` dir signs into Google without being
     blocked,
  2. the same profile, launched with automation later, opens the Cloud console signed in,
  3. the profile persists across launches. Puppeteer keeps a persistent profile but injects
     a `user.js`; confirm it's removed afterwards and doesn't break the session.

  Bring the results back before building.
- **Detection:** find `Firefox.app` (and Firefox Developer Edition / Nightly if present).
- **Firefox adapter** behind `BrowserDriver`: launch, attach, navigate, the selector
  operations the Google recipe uses, close.
- **Profile protection:** Firefox doesn't encrypt cookies with the macOS Keychain. Its profile
  dir is `0700`, and `bb status` says: "Firefox profile, protected by file permissions (Firefox
  doesn't use Keychain encryption for cookies)." Never claim more.
- **Handoff:** the un-automated handoff window works the same in Firefox.

## Acceptance criteria

- [ ] Spike results written into this ticket.
- [ ] Login, plan, apply, verify, re-auth handoff and rewire all pass on Firefox against
      the sandbox client.
- [x] The Google recipe's selector file is unchanged. If a selector had to fork per browser,
      explain why in the PR.
- [x] `bb status` shows the Firefox protection line exactly. Brave and Dia still say
      Keychain-encrypted.
- [ ] Brave and Dia regression: BB-07's real run still passes.

## Out of scope

Safari. Firefox forks (LibreWolf, Zen): detect them only if trivial, and mark them untested.

## Notes & risks

- Firefox's BiDi connection is a localhost WebSocket, not a pipe. Bind to loopback only and
  close it the moment the step ends.
- If the spike shows Google blocks automated Firefox sessions, Firefox drops to
  "plain-window steps only" and this ticket comes back for a decision.

## Done (2026-11-23)

Firefox runs behind the same `BrowserDriver` and `Page` as Chromium. Detection, launch
arguments, the status line and the adapter changed. The recipe, its selectors, the CLI
commands above `pickBrowser`, and the fake world did not.

### Spike, the local part (run 2026-11-23, Firefox 160.0.1, puppeteer-core 25.18.1)

Everything ran headless, on a temp profile, with the test-only loopback prefs, under an lsof
probe. Nothing went to Google.

- **The profile persists across launches.** Launch 1 set a cookie and a localStorage value
  on a loopback page. Launch 2, on the same `--profile`, sent the cookie (`bbspike=1`) and
  read the value back (`kept`).
- **The BiDi WebSocket is on loopback only, and it's gone when the step ends.**
  `--remote-debugging-port=0` gave `ws://localhost:<ephemeral>/session`, and lsof showed
  `LISTEN 127.0.0.1:<port>` only. After `browser.close()` the process had exited.
  Firefox's Remote Agent hardcodes `localhost` (`RemoteAgent.sys.mjs`: `DEFAULT_HOST =
  "localhost"`), and its httpd binds a loopback-only socket for that host. No command-line
  flag changes the host.
- **Puppeteer's injected prefs were not cleaned up. busbar now does it.** Puppeteer
  writes its automation prefs into `user.js` and backs up `user.js` and `prefs.js` as
  `*.puppeteer`, but only when the file already existed. A profile with no `user.js` (every
  busbar profile) kept Puppeteer's `user.js` after close, with Safe Browsing off,
  `security.fileuri.strict_origin_policy` off, `signon.rememberSignons` off and
  `fission.webContentIsolationStrategy` 0. Some of these were also copied into `prefs.js`. A
  second launch backed up that leftover file and "restored" it, so it never went away. The
  plain sign-in window would have loaded those prefs. The session itself wasn't broken: the
  cookie survived.
  - Fix: `src/core/browser/firefox.ts` snapshots `user.js` and `prefs.js` before each
    automated launch and puts them back exactly after the browser exits, removing any
    `*.puppeteer` backups. A seam-2 test checks this.
- **Minimise works over BiDi.** `setWindowBounds(windowId, { windowState: "minimized" })`
  succeeded headless. The headed check itself is pending (check 3 below).
- **A plain Firefox dies on SIGTERM.** It exited in 33ms, killed by the signal, so it
  doesn't quit cleanly the way Chromium does. The OS releases its profile lock either way,
  and cookies are committed to SQLite as they're set. Whether a sign-in survives an
  immediate Enter is check 2 below.

### Tests added

- **Seam 4**, `src/core/browser/args.test.ts`:
  - The plain window is exactly `-profile <dir> -no-remote <url>`, with no remote agent, no
    Marionette and no prefs. It's the same builder handoff uses, because `openPlain` is the
    only plain path.
  - Automation is `browser: "firefox"`, `protocol: "webDriverBiDi"`, args
    `["--remote-debugging-port=0"]`, no pipe, no fixed port, and no `--remote-allow-hosts` or
    `--remote-allow-origins`.
  - The options are identical for `keychain: "mock"` and `"real"`.
  - `loopbackOnly` sets the Firefox prefs, and production sets none.
- **Detection**, `src/core/browser/browsers.test.ts`: Firefox Developer Edition and Nightly,
  each as its own browser on the Firefox engine.
- **Seam 3**, `test/status.test.ts`: a fake Firefox logs in, and `bb status` prints the
  protection line exactly, without the Keychain line.
- **Seam 2**, `test/puppeteer.test.ts` and `test/google-console.test.ts`: both now run on
  every installed test browser (`testBrowsers`: Brave, plus Firefox when installed). The 22
  recipe-vs-stand-in tests (read, layout drift, sign-in bounce, write, read-back, banners,
  `fill` vs the framework model, screenshot) pass on Firefox with no change to the recipe.
  There's one new Firefox-only driver test: after an automated step, the profile has no
  `user.js`, no `*.puppeteer` file, and `prefs.js` byte-identical to before.

### Decisions

- **selectors.ts is unchanged.** No selector needed a fork. All the driver-level
  differences (protocol, launch, prefs cleanup) are in the adapter.
- **`keychain` is ignored for Firefox.** The test asserts that, rather than the type
  splitting.
- **Tests use Firefox too.** With the `loopbackOnly` prefs (a dead proxy at 127.0.0.1:9 for
  http/ssl/socks, `network.dns.native-is-localhost`, DoH off, captive portal and
  connectivity checks off, telemetry, normandy, push, update and system add-on update off,
  OCSP and the remote-settings CRLite/intermediates off), lsof probes during every Firefox
  seam-2 run showed loopback connections only. Dia stays excluded.
- **Detected:** Firefox, Firefox Developer Edition (`firefox-dev`), Firefox Nightly
  (`firefox-nightly`). Developer Edition and Nightly are labelled untested. Firefox counts as
  tested because the seam-2 suite runs on it here. Forks (LibreWolf, Zen) aren't detected:
  their bundle paths can't be checked on this machine and they ship their own pref
  defaults, so naming them would claim more than was checked.
- **`bb login google`** now offers every detected browser, Firefox included.

### Real-world checks pending

The spike's Google steps (1 and 2) and the whole loop on Firefox need Kartikay, his Google
account and the sandbox client. Run them in a project with `[destinations.google]` pointing
at the sandbox client.

1. **Sign-in isn't blocked (spike 1).** `bb logout google`, then
   `bb login google --browser firefox`. A Firefox window opens on
   `~/Library/Application Support/busbar/profiles/<project>/firefox`. Sign in, wait for the
   Cloud console, press Enter. Expect `google: signed in · Firefox`. Note any "browser not
   secure" or similar page. If Google blocks it, Firefox drops to plain-window steps only and
   this ticket comes back for a decision.
2. **Sign-in survives an immediate Enter (SIGTERM).** Repeat step 1, but press Enter the
   moment the console shows. Then `bb status` should still say signed in.
3. **The automated profile opens the console signed in (spike 2), minimised.**
   `bb status`. Expect `signed in · Firefox`, with the Firefox protection line. Watch
   that the check window goes straight to the Dock and doesn't flash full size.
4. **Prefs stay clean on the real profile.** After step 3, `ls` the profile dir: there
   should be no `user.js` and no `*.puppeteer`. In busbar's Firefox (via
   `bb login google --browser firefox` after `bb logout google`, or the handoff window),
   open `about:config` and check that `browser.safebrowsing.malware.enabled` is true and
   `fission.webContentIsolationStrategy` is not 0.
5. **Plan, apply, verify.** `bb plan --tunnel https://<x>.ngrok-free.app`, then
   `bb apply`, then `bb verify`. Each should behave as it does on Brave, and finish
   verified.
6. **Re-auth handoff.** Sign busbar's Firefox profile out: run
   `/Applications/Firefox.app/Contents/MacOS/firefox -profile "<profile dir>" -no-remote https://accounts.google.com/Logout`
   and quit it. Then `bb apply` on a pending plan. Expect the handoff: a plain Firefox
   window at Google's page. Sign in, press Enter, and the run carries on to one Save.
7. **Rewire.** `bb rewire --tunnel https://<y>.ngrok-free.app`. Expect it to finish
   verified, exit 0.
8. **Profile permissions.** `stat -f %Lp <profile dir>` should print `700`.
9. **Brave and Dia regression.** Re-run BB-07's real-world rewire on Brave and on Dia.
   `bb status` should still print the Keychain line for both.
10. **First launch of a newly installed Firefox (seen while building).** The first time this
    Mac ran the Homebrew-installed Firefox, Gatekeeper's first-launch agent
    (`com.apple.coreservices.uiagent`) started a second Firefox through LaunchServices, with
    no arguments. It ran headed, on a new default profile
    (`~/Library/Application Support/Firefox/Profiles/du2t9eol.default-release`), and it
    went online. It was killed within about a minute. Check whether a user whose first
    Firefox launch is `bb login google` sees the same thing. If so, the login copy should
    say to open Firefox once first. Delete that default profile if you don't want it.
