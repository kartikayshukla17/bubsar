# BB-05: `bb verify` proves Google accepts the new redirect URI

**Demo when done:** `bb verify` asks Google's own authorize endpoint whether it accepts the
new `redirect_uri`. The Google strip goes *checking* → **verified** with the note "Google
accepted `<uri>` as a redirect URI". The JS origin shows **unexercised** with an honest note,
because this check doesn't prove it.

**Depends on:** BB-04
**Layers:** core (verify check + classifier) · cli · run state · ui

## Why this slice

"Verified, not claimed" is the product. This slice is the first time busbar earns a green
mark, and it does so with a check that needs **no session and no credentials at all**: the
client ID is public, and the request carries no cookies.

## Scope

- **Check:** plain HTTPS `GET https://accounts.google.com/o/oauth2/v2/auth` with
  `client_id`, the new `redirect_uri`, `response_type=code` and `scope=openid`. No cookies,
  no browser, no redirect following.
- **Classifier**, built from recorded real responses:
  - redirect to a sign-in or consent page → **verified**
  - error page containing `redirect_uri_mismatch` → **not accepted**
  - anything else (rate limit, captcha, new format) → **unknown**. Never green.
- **Propagation:** Google notes changes can take minutes or longer to apply. Poll with backoff
  (e.g., up to 10 min). While waiting, the strip stays `checking` with "waiting for Google to
  pick up the change". After the timeout, mark it **not accepted yet**, with "Re-run
  `bb verify` later", not `failed`.
- **JS origins:** this check doesn't exercise them. Mark them `unexercised` with the same
  honest note style the kit already uses.
- **Events:** `verify-start` → `check` → `checked` → `verify-done`.
- **Record:** store each check's result (time, URI, classification, HTTP status) in
  `.busbar/state.json`, so every green mark points back to a recorded check (DoD #4).

## Acceptance criteria

- [ ] Right after BB-04's apply, `bb verify` eventually reports **verified** for the new URI.
- [ ] Verifying a URI that was never added reports **not accepted** (`redirect_uri_mismatch`).
- [ ] Classifier unit tests run on saved real response fixtures (accepted, mismatch, unknown).
- [x] With the network off, the result is **unknown**, not failed and not verified.
- [x] The request is checked in a test to carry no `Cookie` header and to run outside any
      browser.
- [x] The JS origin strip shows `unexercised`, never `verified`.

## Out of scope

`bb verify --signin` (an end-to-end sign-in through the app) and verifying JS origins. Both
are later.

## Notes & risks

- Google can rate-limit or captcha repeated unauthenticated hits. Keep polling gentle, and
  let a captcha classify as `unknown`.
- Record fixtures from the sandbox client only. Scrub the client ID before committing them.

## Done (2026-11-22)

`bb verify [--wait <seconds>]` asks Google's authorize endpoint, signed out, whether it
accepts each redirect URI busbar wants or owns that is on the client. It's a plain `fetch`
GET from Node with `client_id`, `redirect_uri`, `response_type=code` and `scope=openid`.
There's no browser and no session, and redirects aren't followed. Each answer is recorded
in `.busbar/state.json` `google.checks` before the strip turns, so every `verified` points
back to a recorded check. Everything here ran against a local stub on 127.0.0.1 and the
fake world. No request has gone to any Google host.

Ticked: network off, the request shape, and the origin strip. The first three boxes depend
on Google's real answers and on real recordings, so they stay open until the real-world
checks below pass.

### Tests added

- Seam 1, `src/core/board.test.ts`:
  - `checked` prefers the event's `mark` and `note` over the step's declared `verify`.
  - A `checked` with no mark, for a step the board doesn't know, lands `unknown`, never
    `verified`.
  - `check` carries an optional note: "waiting for Google to pick up the change".
- Seam 1, `src/core/verify/classify.test.ts`, on `test/fixtures/google-auth/*.http`:
  - **accepted:** a 302 to `/v3/signin/identifier`, and a 302 to `/ServiceLogin`.
  - **rejected:** a 302 to `/signin/oauth/error/v2` whose `authError` encodes
    `redirect_uri_mismatch`, and a 400 page that says "Error 400: redirect_uri_mismatch".
  - **unknown:**
    - `invalid_client` on the same error path
    - 429
    - a captcha redirect to `www.google.com/sorry/`
    - a 200 page busbar doesn't recognise
    - a 302 to the lookalike host `accounts.google.com.example.net`
  - The reason given for each unknown, and for a request that got no answer.
- Seam 1, `src/core/verify/poll.test.ts`, on a fake clock:
  - asks again after 5s, then 10s, until accepted
  - the wait doubles to a 60s cap and stops at the deadline (600s: 14 asks), then
    reports timed out
  - stops at the first unknown
  - `--wait 0` asks once
- Seam 1, `src/core/verify/verify.test.ts`:
  - the exit-code table
  - event order, with each check recorded before `checked` and the waiting note on the
    strip while it waits
  - a removal is "Entry removed. Nothing to check"
  - a redirect strip busbar didn't ask about is `unknown`, never green
- Seam 4, `test/verify-http.test.ts` (local stub):
  - one GET with exactly the four parameters, no `cookie` header, Node's user agent and no
    browser client hints
  - the redirect is never followed, and a relative `Location` comes back absolute
  - a closed port gives no answer, which classifies as `unknown`
- Seam 3, `test/verify.test.ts` (built CLI, fake world, stub):
  - **after `bb apply`, accepted:** exact output, exit 0, one request, a recorded check,
    the event order, strips `verified` and `unexercised`, and no browser launched
  - **mismatch with `--wait 0`:** not accepted yet, exit 3
  - **network off:** `unknown`, recorded with status null, exit 3
  - **429 with `--wait 600`:** asked once, exit 3
  - **refusals:** no plan read yet (exit 0, nothing asked), plan not applied (exit 1),
    bad `--wait` (exit 1), no Google destination (exit 0), nothing on the client to check
    (exit 0)

Where a test passed on its first run, a mutation proved it. The task report lists each one.

### Decisions

- **What's verified:** the redirect URIs in `planned.desired` or `owned` that are on the
  client as busbar last read or saved it (`planned.read`). After a clean apply,
  `planned.read` is the saved list. `bb verify` refuses while `planned.read` ≠
  `planned.next` (a plan not applied). It never opens a browser to re-read.
- **Only `rejected` is retried,** because a change Google hasn't picked up looks exactly
  like a mismatch. `unknown` stops at once, so a 429, a captcha or a request that threw is
  never retried into a green, and polling stays gentle.
- **One deadline for the whole run.** With several redirect URIs, later ones get whatever
  time is left.
- **Every attempt is a recorded check.** Each one is written to `state.json` as it
  happens: `{ at, uri, result, status }`, with status null when there was no answer.
- **The classifier fails closed:**
  - `rejected` is checked first.
  - `accepted` needs a 3xx, https, the exact host `accounts.google.com`, and a path on a
    small sign-in/consent allowlist.
  - Anything else is `unknown`, including an `authError` other than
    `redirect_uri_mismatch`.
- **Event protocol:**
  - `check` gains an optional `note`.
  - `checked` gains optional `mark` (verified | rejected | unknown | unexercised) and
    `note`. With a `mark` the reducer uses the event's note only.
  - Without one it falls back to the step's declared `verify`, or `unknown` for a step it
    doesn't know.
  - Demo replays are unchanged (the snapshots didn't move).
- **Which strips get events:**
  - redirect strips: `check` ("Asking Google whether it accepts this redirect URI") →
    `check` with the waiting note, once, if it waits → `checked`
  - origin strips: `checked unexercised` only, with "Origin listed. This check doesn't
    exercise it; sign-in through the app would."
  - removal strips: `checked unexercised`, "Entry removed. Nothing to check"
- **`rejected` mark** ("Not accepted"): an open box with a bar across it. On the sector
  map the route is white and dash-dot. It's on the strip, ledger, legend and `/kit`.
- **Ledger fallback:** a value with no routes used to read `verified`. It now reads
  `unknown`.
- **Board status:**
  - While verifying, it shows the busy strip's note, not the apply note.
  - After verify, it counts verified / not accepted yet / unknown / not exercised.
- **Exit codes:** 0 when every redirect URI checked was accepted, or there was nothing to
  verify. 3 when any is not accepted yet or unknown. 1 for refusals.
- **Test safety:**
  - Every test project sets `BB_GOOGLE_AUTH_URL` to `http://127.0.0.1:9/…`, a port fetch
    refuses to use, so a forgotten override can't reach Google.
  - CLI tests that use the stub spawn `bb` asynchronously (`bbAsync`), so the stub in the
    test process can answer.

### Real-world checks pending

The fixtures are **provisional and hand-written**. No request was sent to Google to make
them. These checks need Kartikay, the sandbox OAuth client and a real network:

1. **Record real responses.**
   - With the sandbox client ID and a redirect URI that is on the client:
     `curl -sS -D - -o body.html "https://accounts.google.com/o/oauth2/v2/auth?client_id=<ID>&redirect_uri=<URI>&response_type=code&scope=openid"`.
     Plain curl: no cookie jar, no `-L`.
   - Repeat with a URI that is not on the client, and once with a made-up client ID.
   - Save each as `test/fixtures/google-auth/<name>.http` (status line, headers, blank
     line, body) and scrub the client ID to `000000000000-fixture.apps.googleusercontent.com`.
   - Change the header from PROVISIONAL to "recorded <date> from the sandbox client".
   - If the sign-in path isn't in `SIGN_IN_PATHS` (`src/core/verify/classify.ts`), add it.
     If the mismatch shape differs, fix the classifier.
   - `npx vitest run src/core/verify` must pass. Then tick box 3.
2. **Eventually verified after apply (box 1).**
   - `bb plan --tunnel <new tunnel>`, `bb apply`, then `bb verify` right away.
   - Expect `not accepted` while waiting ("Google hasn't accepted … yet: waiting for
     Google to pick up the change…"), then `verified`, with exit 0.
   - Watch `bb ui`: the strip stays Checking with the waiting note, then turns Verified.
   - Note how long Google took. If it's routinely over 10 minutes, raise the default
     `--wait`.
3. **Never added → not accepted (box 2).**
   - Put a URI that was never added into `planned.read`/`desired` (or use a fresh tunnel
     without applying, after editing state.json), then run `bb verify --wait 0`.
   - Expect `not accepted`, "Google answered redirect_uri_mismatch", and exit 3.
4. **Gentleness.** Run `bb verify` about 10 times in a row. Confirm Google doesn't start
   answering 429 or a captcha. If it does, confirm busbar reports `unknown` and exits 3.
5. **Network off for real.** With Wi-Fi off, run `bb verify` and expect `unknown`,
   "busbar couldn't reach Google (…)", and exit 3.

