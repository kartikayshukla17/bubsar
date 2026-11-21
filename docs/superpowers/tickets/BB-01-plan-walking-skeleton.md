# BB-01: Walking skeleton: `bb plan` + live `bb ui`

**Demo when done:** in a sample project, `bb plan --tunnel https://abcd.ngrok-free.app` prints
the Google writes it would make. In a second terminal, `bb ui` opens the board, and the Google
strip sits in the Plan bay with the real URL, not demo data.

**Depends on:** none
**Layers:** package · `busbar.toml` · core · cli · run state · daemon · ui (no browser, no network)

## Why this slice

It proves the spine everything else hangs on: one installable package, a declared wiring
graph, a plan computed in `core`, written as run state, and shown live by the existing SPA.
After this, every later slice only adds a capability. Nothing is rewired.

## Scope

- **Package:** rename `@busbar/ui` → `busbar` (not private), add `"bin": { "bb": … }`. Layout
  per spec: `src/core`, `src/cli`, `app/` = ui. `npm run build` builds both CLI and SPA. The
  built SPA ships inside the package.
- **Core types:** move `Tier`, `Mark`, `Phase`, `Step`, `Value`, `Destination`, `Action`,
  `reduce` from `app/lib/board.ts` into `src/core`. Layout fields (`y`) stay in the UI. The
  demo constants become a fixture (`app/lib/demo.ts`) so `?at=` replays keep working for
  screenshots and the video.
- **Secret type:** add an opaque `Secret` type in core that holds a value in memory but
  serializes only as `{ slot, fingerprint }`, and throws on `JSON.stringify` of the raw value.
  Nothing uses it yet beyond the test. It exists so no later slice can forget.
- **`busbar.toml` v0:** a minimal schema, parsed and validated with clear errors:
  ```toml
  [project]
  name = "enquiry-to-paid"

  [values."tunnel.url"]
  kind = "url"          # public, so shown in full
  source = "arg"        # supplied by --tunnel

  [destinations.google]
  project_id = "my-sandbox-123"
  client_id  = "1234-abc.apps.googleusercontent.com"
  redirect_uris = ["{tunnel.url}/api/auth/callback/google"]
  js_origins    = ["{tunnel.url}"]
  ```
- **`bb plan --tunnel <url>`:** computes the desired Google entries. Current state isn't read
  yet (that's BB-03), so each step shows `from: unknown → to: <entry>` with mark `planned`.
  Pretty terminal output in the product's voice.
- **Run state:** the CLI writes `.busbar/run.json` (snapshot) and appends `Action`s to
  `.busbar/events.jsonl`. It works the same whether or not `bb ui` is running. Add `.busbar/`
  to the sample project's `.gitignore` guidance.
- **`bb ui`:** starts a daemon on `127.0.0.1` (random free port), serves the built SPA, exposes
  `GET /api/run` (snapshot) and `GET /api/events` (SSE that tails `events.jsonl`), and opens
  the default browser.
- **SPA live mode:** the board loads its destinations, values and steps from `/api/run` and
  reduces streamed events. It's read-only: the Plan/Start buttons are replaced by the command
  to run (empty state: "Run `bb plan --tunnel <url>` to see every write before anything
  changes."). Demo mode stays available at `?demo` and `?at=<moment>`.

## Acceptance criteria

- [x] `npm pack`, then `npm i -g ./busbar-*.tgz`, then `bb --version` works on a clean shell.
- [x] A malformed `busbar.toml` gives a one-line error naming the key and line.
- [x] `bb plan --tunnel <url>` prints two Google steps (redirect URI, JS origin) with
      `from: unknown`, and exits 0.
- [x] With `bb ui` open, running `bb plan` moves the Google strip into the Plan bay within 1s
      without a page reload.
- [x] `/?at=verified` still renders the demo board identically to today (compare against
      `.impeccable/review/desktop-verified.png`).
- [x] The daemon refuses non-loopback connections.
- [x] Unit tests: toml parsing and validation, plan computation, reducer, `Secret`
      serialization safety.
- [x] Definition of done checks 1–3 are wired into `npm run lint` / tests from this ticket
      onward.

## Out of scope

Browser, Google reads or writes, login, verify, handoff.

## Notes & risks

- Keep the event protocol identical to the existing `Action` union where possible. Adding
  fields is fine; renaming forks the demo replay.
- The UI kit showed seven destinations. Live mode shows only what `busbar.toml` declares
  (Google only for now). Check that the sector map still looks intentional with one row.

## Done (2026-11-21)

**Demo run for real**, from the packed tarball installed into an isolated prefix:
`bb --version` → `busbar 0.1.0` in an `env -i` shell; `bb ui --no-open` showed the empty
state; `bb plan --tunnel https://abcd.ngrok-free.app` in a second process moved both Google
strips into the Plan bay without a reload. `/?at=verified` matched
`.impeccable/review/desktop-verified.png` (same strips, marks, notes, routes, status line).

**Tests (31, vitest):** `src/core/{board,secret,config,plan}.test.ts`; `test/demo-replay`
(snapshot of all five `?at=` moments, taken before the move); `test/cli` and `test/daemon`
spawn the built `dist/bb.js`. Daemon tests cover `/api/run`, SSE under 1s, loopback-only bind
(checked against the LAN address) and a Host-header check against DNS rebinding.

**Gates:** `npm run lint` = biome + `scripts/guard.mjs` (DoD 1–2, proven to catch planted
violations). The UI kit never passed lint before this ticket; it does now (vendored
`ui/fluted-glass.tsx` excluded, a few justified ignores).

**Decisions made here:**
- Steps travel with the `plan` event and live in `BoardState.steps`; the reducer no longer
  imports demo data. `Step.path` became `from` (null = not read) / `to`.
- Events are `{ run, seq, action }`. A new run id or a seq gap makes the SPA reload
  `/api/run`, so it can't drift from disk. `bb plan` starts a new run each time.
- `.busbar/` writes its own `.gitignore` (`*`), so users don't have to edit theirs.
- `/` is live; demo moved to `?demo` / `?at=`.
- Only `smol-toml` is a runtime dependency; the SPA ships prebuilt in `build/client/`.

**Carried forward:**
- DoD 3's "serialize a full run and scan for fixture secrets" has nothing to scan yet: no MVP
  run holds a secret (Google rewire is all public URLs). `Secret` and its leak tests are in
  place; add the full-run scan in the first slice that puts a secret in a run.
- `checked` still takes its mark from the step's declared `verify`, not from a check result.
  BB-05 should put the recorded result on the `checked` event (DoD 4).

