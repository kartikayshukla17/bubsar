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
- [ ] With the network off, the result is **unknown**, not failed and not verified.
- [ ] The request is checked in a test to carry no `Cookie` header and to run outside any
      browser.
- [ ] The JS origin strip shows `unexercised`, never `verified`.

## Out of scope

`bb verify --signin` (an end-to-end sign-in through the app) and verifying JS origins. Both
are later.

## Notes & risks

- Google can rate-limit or captcha repeated unauthenticated hits. Keep polling gentle, and
  let a captcha classify as `unknown`.
- Record fixtures from the sandbox client only. Scrub the client ID before committing them.
