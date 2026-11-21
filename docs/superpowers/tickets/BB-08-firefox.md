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
- [ ] The Google recipe's selector file is unchanged. If a selector had to fork per browser,
      explain why in the PR.
- [ ] `bb status` shows the Firefox protection line exactly. Brave and Dia still say
      Keychain-encrypted.
- [ ] Brave and Dia regression: BB-07's real run still passes.

## Out of scope

Safari. Firefox forks (LibreWolf, Zen): detect them only if trivial, and mark them untested.

## Notes & risks

- Firefox's BiDi connection is a localhost WebSocket, not a pipe. Bind to loopback only and
  close it the moment the step ends.
- If the spike shows Google blocks automated Firefox sessions, Firefox drops to
  "plain-window steps only" and this ticket comes back for a decision.
