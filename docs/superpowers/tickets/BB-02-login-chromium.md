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
- [ ] Chrome/Edge are detected if installed. They aren't installed here, so mark them
      "untested on this machine" in the PR, not "supported".
- [ ] Your everyday Brave keeps running untouched during all of this (separate data dir,
      separate process).
- [ ] The profile's `Cookies` DB has `encrypted_value` rows prefixed `v10` and empty `value`
      columns. That proves real Keychain encryption; the test checks the prefix, not
      contents.
- [ ] DoD check 2 passes: busbar's own code never opens any cookie or password store. The
      check above lives in a test helper excluded from `src/`.
- [ ] `bb logout google` removes the profile dir, and `bb status` shows "never logged in".

## Out of scope

Reading or writing anything in the console (BB-03+), Firefox (BB-08), re-auth handoff (BB-06).

## Notes & risks

- Google may block sign-in in automated browsers. That's why the login window carries no
  automation at all. If Google still blocks the *later* automated console load, it surfaces
  in the spike.
- Two Brave icons in the Dock while busbar runs is expected. Mention it in the login output.
