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

- [ ] `npm pack`, then `npm i -g ./busbar-*.tgz`, then `bb --version` works on a clean shell.
- [ ] A malformed `busbar.toml` gives a one-line error naming the key and line.
- [ ] `bb plan --tunnel <url>` prints two Google steps (redirect URI, JS origin) with
      `from: unknown`, and exits 0.
- [ ] With `bb ui` open, running `bb plan` moves the Google strip into the Plan bay within 1s
      without a page reload.
- [ ] `/?at=verified` still renders the demo board identically to today (compare against
      `.impeccable/review/desktop-verified.png`).
- [ ] The daemon refuses non-loopback connections.
- [ ] Unit tests: toml parsing and validation, plan computation, reducer, `Secret`
      serialization safety.
- [ ] Definition of done checks 1–3 are wired into `npm run lint` / tests from this ticket
      onward.

## Out of scope

Browser, Google reads or writes, login, verify, handoff.

## Notes & risks

- Keep the event protocol identical to the existing `Action` union where possible. Adding
  fields is fine; renaming forks the demo replay.
- The UI kit showed seven destinations. Live mode shows only what `busbar.toml` declares
  (Google only for now). Check that the sector map still looks intentional with one row.
