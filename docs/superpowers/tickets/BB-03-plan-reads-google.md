# BB-03: `bb plan` reads the real Google console

**Demo when done:** `bb plan --tunnel <new>` opens your signed-in profile in the background,
reads the OAuth client's current redirect URIs and JS origins, and prints the exact diff: add
`<new>/api/auth/callback/google`, remove `<old>/…` (which busbar added last time), and keep
`http://localhost:3000/…` (not busbar's). The Google strip on the board shows the same
`from → to`.

**Depends on:** BB-02 (and the hand-made sandbox OAuth client; see README)
**Layers:** core (Google recipe: selectors + diff + ownership) · cli · run state · ui · browser

## Why this slice

Plan-before-touch only means something if the plan reflects reality. This slice turns the
plan from "what we'd like" into "what will actually change", and it's read-only, so it's
safe to build and test against the real console.

## Scope

- **Google recipe module** in `src/core/recipes/google/`: navigates to the OAuth client's
  page (`console.cloud.google.com/auth/clients/<client_id>?project=<project_id>`) and reads
  both URI lists through **recorded selectors** held in one file, versioned, with a short
  comment per selector. No LLM.
- **Fail closed on DOM drift:** if any expected element isn't found within a timeout, the step
  is marked `failed` with "Google console layout changed: `<selector-name>` not found. Nothing
  was changed." It never guesses.
- **Ownership:** `.busbar/state.json` records the entries busbar has added. Diff rules:
  - desired entry missing → **add**
  - busbar-owned entry no longer desired → **remove**
  - entry not owned by busbar → **keep**, never touched
  - not owned, but the host looks like a tunnel (`*.ngrok-free.app`, `*.trycloudflare.com`,
    …) → **keep**, flagged "likely stale". `bb plan --adopt` lets busbar manage it.
- **Output:** the terminal shows a table of add / remove / keep / likely-stale per list. URLs
  are public and shown in full. The client secret is never read, never navigated to, and
  never shown.
- **Debug:** `--debug` saves a local screenshot on failure to `.busbar/debug/` (mode `0600`),
  with a warning that it may show partial client details. Off by default.
- **UI:** the strip shows the real from → to. Likely-stale entries appear as a note on the
  strip.

## Acceptance criteria

- [ ] Against the sandbox client, `bb plan` prints the correct current lists (checked by eye
      against the console).
- [ ] Adding an entry by hand in the console and re-running `bb plan` shows it as "keep".
- [ ] A hand-added `https://x.ngrok-free.app` shows "likely stale". With `--adopt`, it becomes
      a removal.
- [ ] Breaking a selector on purpose makes the step `failed` with the named selector, and the
      command exits non-zero having made no writes.
- [ ] **Selector contract test:** a saved, scrubbed DOM snapshot of the client page (no
      secret, client ID replaced) lives in fixtures. The selector file passes against it
      offline in CI.
- [ ] Unit tests cover the diff/ownership rules, including adopt and likely-stale.
- [ ] Network log during `bb plan` shows only Google console hosts.

## Out of scope

Writing (BB-04). Handling a sign-in or re-auth redirect: for now, a redirect to
`accounts.google.com` fails the step with "session expired; run `bb login google`". BB-06
turns that into a handoff.

## Notes & risks

- Google's console is a heavy SPA. Prefer stable attributes (`aria-label`, form field names)
  over generated class names, and record why each selector was chosen.
- Google renamed this area to "Google Auth Platform" in 2025. Confirm the deep-link URL
  shape against the live console in the first hour.
