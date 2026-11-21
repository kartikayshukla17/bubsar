# busbar CLI MVP — Tickets

Source design: [`../specs/2026-11-21-busbar-cli-mvp-design.md`](../specs/2026-11-21-busbar-cli-mvp-design.md)

Every ticket is a **vertical slice**. Each one cuts through every layer it needs
(`busbar.toml` → `src/core` → `src/cli` → run state → `bb ui`, plus the browser where needed)
and ends with something you can **demo**. No ticket is just "build the vault" or "build the
executor". Shared code gets built inside the first slice that needs it.

## Order

| # | Slice | Demo when done | Depends on |
|---|---|---|---|
| [BB-01](BB-01-plan-walking-skeleton.md) | Walking skeleton: `bb plan` + live `bb ui` | `bb plan --tunnel <url>` prints the Google writes, and the board shows them as real strips | — |
| [BB-02](BB-02-login-chromium.md) | `bb login google`: pick a browser, sign in once | Pick Brave or Dia, sign in once; later runs need no login | BB-01 |
| [BB-03](BB-03-plan-reads-google.md) | `bb plan` reads the real Google console | The plan shows the actual current redirect URIs and the exact add/remove | BB-02 |
| [BB-04](BB-04-apply-google.md) | `bb apply` rewires the OAuth client | Approve the plan → the URIs change in Google → strip lands in Cleared as *applied* | BB-03 |
| [BB-05](BB-05-verify-google.md) | `bb verify` proves it | Google accepts the new `redirect_uri` → strip turns *verified* | BB-04 |
| [BB-06](BB-06-reauth-handoff.md) | Re-auth mid-run becomes "your turn" | Google asks "verify it's you" → busbar hands you the window, then resumes | BB-04 |
| [BB-07](BB-07-rewire-one-shot.md) | `bb rewire --tunnel`: whole loop, live | One command takes a rotated tunnel to verified while the board moves | BB-05, BB-06 |
| [BB-08](BB-08-firefox.md) | Firefox | The same login + rewire works in stock Firefox | BB-07 |

BB-05 and BB-06 can be built in either order once BB-04 lands.

## Definition of done (applies to every ticket)

These are the spec's hard rules turned into checks. A ticket that skips one isn't done.

1. **No LLM anywhere in the MVP.** `src/` imports no model SDK (`@anthropic-ai/*`, `openai`,
   `ai`, `langchain*`, …). A lint/CI check fails the build if one shows up. That makes
   "the LLM never sees credentials" true by construction, not by promise.
2. **busbar never reads browser credential stores.** No code opens `Cookies`, `Login Data`,
   `cookies.sqlite`, `logins.json`, `key4.db` or a Keychain "Safe Storage" item. A grep check
   enforces it. Sessions stay inside the browser profile and are used only by the browser.
3. **No secret value in run state.** `.busbar/` files, the event stream, CLI output and the UI
   carry secrets only as `{ slot, fingerprint }`. Secret values are an opaque core type that
   can't be serialized. A test serializes a full run and scans it for fixture secrets.
4. **Green means checked.** Every `verified` mark points to a recorded check result. Anything
   unchecked shows as `unknown` or `unexercised`.
5. **Plan before touch.** No code path writes to a provider unless the user has seen that
   plan and confirmed it.
6. **Local only.** No network calls except to the provider being wired and its verify
   endpoint. No telemetry.
7. `npm run typecheck`, `npm run lint` and the core unit tests pass. The ticket's manual demo
   script was run for real and noted in the PR or commit.

## Vocabulary: spec ↔ code

The UI kit's names win in code, since they already exist.

| Spec | Code (`src/core`, from `app/lib/board.ts`) |
|---|---|
| tier `browser` | `Tier = "web"` |
| status `planned` / `applied` / `verified` | `Mark` `planned` / `applied` / `verified` |
| status `needs-human` | `Mark` `handoff`, bay `turn` |
| status `failed` | **new** `Mark` `failed`, added to the kit in BB-04 |
| "current state not read" | `Mark` `unknown` |
| "listed but not exercised" | `Mark` `unexercised` |

The board's reducer `Action`s (`plan`, `activate`, `settle`, `handoff-done`, `check`,
`checked`, …) become the run's **event protocol**: the CLI appends them, `bb ui` streams
them, and the SPA reduces them exactly as it does in demo mode.

## Decisions made while ticketing (check these)

- **Browser driver changed from Playwright to `puppeteer-core`.** Playwright can't drive
  branded Firefox (it needs its own patched build). Puppeteer 23+ drives stock Firefox over
  WebDriver BiDi and the installed Brave/Dia/Chrome/Edge over CDP, all through one library.
  Every call sits behind a `BrowserDriver` interface in `src/core`, so swapping later is cheap.
- **The login window runs without automation.** `bb login` starts the browser as a plain
  process on busbar's profile, with no debugging connection attached, so Google sees a
  normal browser during sign-in. Automation attaches only on later runs, over
  `--remote-debugging-pipe` (Chromium), so no other local process can connect to the session.
- **busbar only removes entries it owns.** It records every URI it adds. A stale tunnel URI
  busbar didn't add is never deleted silently. `bb plan` flags it as "likely stale", and
  `--adopt` hands it to busbar.
- **Profiles live outside the repo**, in `~/Library/Application Support/busbar/profiles/<project>/<browser>/`
  (mode `0700`). Run state lives in the project's `.busbar/` (gitignored, no secrets).
- **Firefox profiles aren't Keychain-encrypted.** Firefox doesn't encrypt cookies with the OS
  keychain the way Chromium does. Its profile is protected by `0700` permissions, and
  `bb status` says so plainly.

## Before BB-03: one thing only you can set up

A throwaway Google Cloud project with one **OAuth 2.0 web client**, created by hand. The MVP
edits an existing client; it doesn't create one. Put its project ID and client ID (both
public) into the sample `busbar.toml`.
