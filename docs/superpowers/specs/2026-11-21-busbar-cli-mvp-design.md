# busbar CLI MVP — Design

- **Date:** 2026-11-21
- **Status:** Approved 2026-11-21; broken into tickets at `../tickets/`. Section 7 was
  amended while ticketing (driver, login window, ownership, Firefox); see the tickets README.
- **Scope:** First vertical slice of the `bb` CLI — Google OAuth tunnel-rewire, end to end.
- **Companion record:** `../../../PRODUCT.md` (product truth), this doc (build design).

---

## 1. Intent & why

The React Router SPA kit (`board`, `kit`, fluted-glass components) is built but runs on
synthetic data. The entire `bb` CLI — login, executor, vault, `plan`/`apply`/`verify`/
`rewire`, `bb ui` — is unbuilt. This design covers the **first working slice** of the CLI
and settles one new design question the builder raised: letting a user reuse the browser
they already have installed, instead of forcing a fresh login in an isolated profile.

The itch is real and the builder's own: a tunnel URL rotates and must be re-registered in
several consoles by hand (`../enquiry-to-paid/docs/SETUP.md` is the 165-line manual recipe
busbar automates). The MVP proves the hardest, most valuable link of that chain —
**keeping a Google OAuth web client's redirect URIs in sync when the tunnel changes** —
and proves it against the real console, with verification, without the user re-logging in
every run and without any credential ever reaching an LLM.

## 2. Goals

- Ship one provider end-to-end: `bb login google → bb plan → bb apply → bb verify`,
  plus `bb rewire --tunnel <url>` as the one-shot form.
- Reuse the user's existing browser login experience with **at most one** sign-in, ever,
  per project.
- Support the user's real browsers and the ones their users run: **Brave, Dia, Chrome/Edge
  (Chromium) and Firefox**. Safari is out (developers don't use it).
- Make "the LLM never sees credentials" **trivially, provably** true for the MVP.
- Wire `bb ui` to real run state so the existing SPA stops showing demo data.

## 3. Non-goals (next, not now)

- Other providers (Stripe, Razorpay, Meta webhooks) — those are the *next* recipes.
- Tunnel auto-detection (ngrok/cloudflared local API) — explicit `--tunnel` arg in v1.
- LLM-driven navigation of *unknown* consoles — MVP uses recorded selectors only.
- Multi-value wiring beyond `tunnel_url → Google slots`.
- `bb ui` editing/apply controls — v1 UI is read-only reflection of CLI state.

## 4. Anti-goals (would make this a failure even if it "works")

- busbar ever holding or displaying a secret value, cookie, or password.
- Any credential value (or a DOM/screenshot of a credential field) entering an LLM context.
- Claiming a connection is green without a real check having passed.
- Silently driving the user's *real* daily browser profile or copying it without consent.

## 5. Hard constraints (non-negotiable)

1. **LLM never sees credentials.** Enforced in the MVP by using *no* LLM in the execution
   path at all (deterministic recorded selectors). The architecture must keep this boundary
   when an LLM is later introduced for unknown consoles (redaction/tokenization by design).
2. **Secrets never surface.** Stored via OS Keychain; UI/CLI show slot name + short
   fingerprint, never the value.
3. **Verified, not claimed.** Green only when a real functional check passed; unknown shown
   as unknown.
4. **Plan before touch.** Nothing changes in a provider until the user has seen the plan.
5. **Hand over the click.** When a step can't run unattended, stop, name the exact click
   with a deep link, pause, resume on confirm.
6. **Local-first.** No hosted service, no telemetry, nothing leaves the machine.

## 6. Approaches considered

### 6a. How to reuse an existing browser login (the new question)

- **(A) Cookie extraction** — decrypt the browser's cookie DB, lift session tokens into
  busbar's own process, replay headlessly. *Rejected:* busbar would hold the user's primary
  session (violates constraints 1–2), it's fragile (sessions rotate, step-up MFA on exactly
  the sensitive actions busbar performs), and replayed cookies trip bot-detection.
- **(B) Attach & drive a real browser over CDP** — *chosen in principle*, but Chromium 136+
  (the user runs Brave 158, Dia 1.58) **refuses `--remote-debugging-port` on the default
  profile dir** (a 2025 anti-cookie-theft change). So the pure "drive my real daily profile"
  form is unavailable. This forces 6b.
- **(C) Isolated per-project profile with one-time login** — the originally locked model.
  Clean and robust, but the originally-feared friction.

### 6b. Which profile busbar drives (forced by the Chromium 136 block)

- **(B1) Profile copy** — clone the real Brave/Dia profile into a busbar-owned dir → zero
  re-login, but the copy goes stale as real cookies rotate, and busbar holds a full copy of
  the user's browsing profile. *Rejected.*
- **(B2) Dedicated persistent busbar profile** — **chosen.** A clean per-project profile
  busbar owns; the user signs into Google **once**, it persists Keychain-encrypted, every run
  after is frictionless. Robust (live real session, nothing copied, no staleness), stronger
  isolation, and "log in once, ever" is already an excellent experience.

### 6c. Execution tier for the MVP

- **LLM-agent navigation** vs **recorded deterministic selectors** → **recorded selectors
  chosen** for the MVP, so constraint 1 is trivially true and verification is simple. The
  three-tier executor (MCP/CLI → API → browser) from PRODUCT.md remains the long-term shape;
  the MVP exercises only the browser tier, deterministically.

## 7. Decisions (the how, as decided)

| Area | Decision |
|---|---|
| Build shape | One **vertical slice** first (Google), then widen. |
| Credential model | **(B2)** dedicated persistent browser profile; sign in once, persists Keychain-encrypted. |
| Cred-safety | **No LLM in the MVP execution path**; redaction-by-design boundary reserved for the agentic future. |
| Stack | TypeScript on Node 22.23 (pinned), single installable npm package `busbar`, binary `bb`. |
| Browser driver | **`puppeteer-core`** behind a `BrowserDriver` interface: CDP over `--remote-debugging-pipe` for installed Brave/Dia/Chrome/Edge, WebDriver BiDi for stock Firefox. *(Amended from Playwright, which can't drive branded Firefox.)* Safari out of scope. |
| Login window | Spawned as a plain process on busbar's profile with **no automation attached**, so Google sees a normal browser. Automation attaches only on later runs. Handoff windows work the same way. |
| Ownership | busbar removes only URIs it added (recorded in `.busbar/state.json`). Unowned tunnel-looking entries are flagged "likely stale" and removed only with `--adopt`. |
| Profile protection | Chromium profiles use the browser's real Keychain "Safe Storage" encryption (mock-keychain flags dropped). Firefox profiles rely on `0700` permissions, and `bb status` says so. |
| Vault | OS **Keychain**; values fingerprinted, never shown. |
| Repo layout | Single package, internal seams: `src/core` (types, vault, executor, state model — shared by CLI + UI), `src/cli` (`bb` binary), existing `app/` becomes the `ui`. |
| Project config | Human-editable **`busbar.toml`** at project root declares providers + the wiring graph (which value → which slots). Source of truth for `plan`. Nothing hardcoded in the binary. |
| Step model | `{ provider, action, slot, from→to (by fingerprint, never raw value), tier (api \| browser), status (planned \| applied \| verified \| needs-human \| failed) }`. |
| Handoff | A `browser`-tier step that hits an irreducibly-human gate (MFA/verification) or low confidence flips to **needs-human**, emits exact click + deep link, pauses, resumes on confirm. |
| Login UX | `bb login google` detects installed browsers, user picks one, headed window opens on the dedicated profile, user signs in with MFA themselves, choice remembered per project. busbar never sees password or cookies. |
| Verify | **Functional** — after rewiring, fire a real OAuth authorize with the new `redirect_uri` and confirm Google returns no `redirect_uri_mismatch`. (DOM read-back is a secondary confirmation only.) |
| Tunnel input | Explicit `bb rewire --tunnel <url>` arg in v1; auto-detect later. |
| `bb ui` | Launches a localhost daemon exposing real run state over HTTP; the SPA reads that instead of `app/lib/board.ts` demo data. Read-only in v1. |

## 8. MVP automation boundary (what the slice does)

**Automated (deterministic, no LLM, no secret shown):**
1. Detect installed browsers (Brave/Dia/Chrome/Firefox).
2. Launch headed window on dedicated per-project profile for one-time login.
3. Persist + reuse that authenticated profile (Keychain-encrypted) → zero-login on later runs.
4. Read `busbar.toml`, compute the ordered `from→to` plan (by fingerprint).
5. Drive Google Cloud Console via recorded selectors: open the OAuth client, read current
   redirect URIs / JS origins, add the new tunnel URL, remove the stale one, save.
6. Plan-before-touch gate.
7. Functional verification (OAuth authorize with new `redirect_uri`).
8. `bb ui` reflecting real run state.

**Stays human:** the sign-in itself (MFA/passkey); any step-up MFA re-prompt mid-run
(→ needs-human handoff).

**User provides:** the tunnel URL (`--tunnel`); the `busbar.toml` wiring declaration.

**Not in MVP:** any provider but Google; LLM-driven navigation; tunnel auto-detect; Safari;
ops verbs (clone DB / preview envs — v2); `bb ui` editing controls.

## 9. Left to the builder

- Exact `busbar.toml` schema (TOML shape for providers + wiring graph) — propose, keep
  minimal, must express `tunnel_url → [Google redirect URI slots]`.
- Keychain integration choice on Node (e.g. `keytar`-style native vs `security` shell-out) —
  builder's call, must satisfy constraints 2 & 6.
- Playwright persistent-context launch details per browser channel (Brave/Dia executable
  paths, Firefox profile model) — builder's call.
- The recorded Google Cloud Console selector set + a resilience strategy for console DOM
  drift (how a broken selector surfaces as a clear failure, not a wrong silent action).
- Daemon transport for `bb ui` (HTTP shape, where it binds) and the shared state model in
  `src/core` that both CLI and SPA import.
- CLI ergonomics (command parser, output format) consistent with the infra-literate,
  honest voice.

## 10. Undecided (outside this slice)

- Domain and GitHub org for `busbar` (only npm availability checked).
- Safari support path (separate later effort).
- The redaction/tokenization mechanism for the future LLM-driven tier (named as a
  requirement here; designed when that tier is built).
