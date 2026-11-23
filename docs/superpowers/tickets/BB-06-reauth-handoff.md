# BB-06: Re-auth mid-run becomes a "your turn" handoff

**Demo when done:** sign out of busbar's Google profile, or wait for Google's step-up prompt,
then run `bb apply`. Instead of failing, busbar says: "Google wants to confirm it's you.
I've opened Brave at the sign-in page. Finish there, then press Enter." The strip sits in the
**Your turn** bay with the handoff card. You confirm, press Enter, and busbar re-reads the
console and carries on.

**Depends on:** BB-04 (works with BB-03's plan too)
**Layers:** core (handoff detection + resume) · cli · run state · ui (handoff card, live) · browser

## Why this slice

"Hand over the click, don't guess" is a core principle, and re-auth is the most common place
a real run stalls. It also has to respect the login rule: the human-facing window carries
no automation, so Google treats it as a normal browser.

## Scope

- **Detect:** during any web-tier step, a navigation to `accounts.google.com` (sign-in,
  challenge, "Verify it's you") or a session-expired page.
- **Hand over:**
  1. Mark the step `handoff` (bay `turn`) and emit the event.
  2. Close the automated browser instance.
  3. Open a **plain, un-automated** window on the same profile at the exact deep link (the
     Google page, with a `continue` back to the client).
  4. Print one instruction naming the browser, the page and what to do, then wait for Enter.
     `Ctrl-C` leaves the step in `handoff` and exits 2.
- **Resume:** reattach automation, restart the step **from its read**, not mid-write, and
  re-check that nothing changed since plan (BB-04's rule). Then continue the run.
- **UI:** the existing handoff card shows the instruction and browser. It's read-only in v1,
  so the card says "Press Enter in your terminal when done".
- **Same path for a fully expired session:** "run `bb login google`" becomes a handoff instead
  of a failure.

## Acceptance criteria

- [ ] Manual: sign out inside busbar's profile → `bb apply` → handoff → sign in → Enter →
      apply completes and lands `applied`.
- [x] The handoff window has no debugging connection (checked in a test by the launch args
      and the absence of a pipe or port).
- [x] Resume never re-sends a partial write. A test with a fake recipe interrupts between
      add and save, then resumes, and confirms there's exactly one save.
- [x] `Ctrl-C` during a handoff exits 2, leaves the strip in Your turn, and changes nothing in
      Google.
- [ ] The board shows the strip in the Your turn bay within 1s, and it moves on after resume.

## Out of scope

Handing off from the UI with a button (v1 UI is read-only). Irreducibly human gates for other
providers.

## Notes & risks

- Detect by URL host and path, not page text, since text is localized.
- Some Google challenges complete without a page change (a phone prompt). The Enter key is
  the source of truth, not a page event.

## Done (2026-11-22)

When Google sends busbar's profile to sign-in during `bb plan` or `bb apply`, busbar no
longer fails the step. It moves every strip to Your turn, closes the automated browser,
opens a plain window on the same profile at the exact page Google redirected to, prints one
instruction, and waits for Enter. Enter re-attaches and restarts from the read. Ctrl-C or a
closed stdin exits 2 with the strips still in Your turn. A fully expired session takes the
same path, so "run `bb login google`" is gone from plan and apply. Everything ran on the
fake world, the local stand-in page and pure launch-argument checks. Nothing went to Google.

Ticked: the launch args, exactly one Save after resume, and Ctrl-C exits 2. Ctrl-C is proven
by sending SIGINT to the built CLI in the fake world; a real terminal is still a pending
check. The manual sign-out run and the 1-second board check need a real browser, so they
stay open.

### Tests added

- Seam 1, `src/core/board.test.ts`: a `handoff` event moves the strip to bay `turn`, mark
  `handoff`, with the instruction as its note, and sets phase `handoff`.
- Seam 1, `src/core/handoff.test.ts` (`applyPlan` with `FakeDriver` + `FakeGoogleConsole`):
  - a bounce between the edits and Save: one handoff, one plain window at the challenge
    URL, then exactly one Save, one confirm, and the full event order
  - a bounce scripted twice: two handoffs, still one Save
  - a stop at the handoff: `stopped`, no Save, nothing recorded, strips left in Your turn
  - a bounce at the read-back after a confirmed Save: what's known is recorded before the
    handoff, resume reads back without a second Save, and a stop there keeps the record
  - a read that already equals `planned.next`: `landed`, ownership recorded, no Save, no
    confirm
- Seam 2, `test/google-console.test.ts`: a sign-in redirect at the read-back after a
  confirmed Save is `ReauthRequired` with `afterSave: true` and says Google confirmed the
  Save. A bounce at the read says `afterSave: false`.
- Seam 3, `test/handoff.test.ts` (built CLI, fake world, stdin piped):
  - `"\n"`: handoff, Enter, one Save, `applied`, two attaches, `local.json` back to
    signed in
  - EOF: exit 2, strips in `turn`, no Save, `state.json` untouched
  - SIGINT while waiting: exit 2, strips in `turn`, no Save
  - a bounce at the read-back, EOF: exit 2, the message says Google confirmed the Save,
    adds are owned; a second `bb apply --yes` records what landed with no new Save
  - the automated browser won't close: no plain window, exit 1, strips `failed`
  - a second bounce after a confirmed Save, then EOF: every message says the Save went
    through
  - `bb plan` killed (SIGKILL, SIGHUP) at its handoff: `planned` is null and `bb apply`
    refuses
  - two bounces answered by one piped `"\n\n"`: two windows, one Save
- Seam 3, rewritten: `test/plan.test.ts` (expired session or bounce, EOF → exit 2, stale
  plan dropped; expired session, Enter → plan completes) and `test/apply.test.ts`
  (expired session at the re-read → handoff, Enter → applied).
- Seam 4, `src/core/browser/args.test.ts`: the handoff window at a challenge URL gets
  exactly `--user-data-dir`, `--no-first-run`, `--no-default-browser-check` and the URL.

### Decisions

- **Every strip goes to Your turn.** One sign-in clears all of them, so `handoff` is sent
  for each step. The live card shows once, under the last strip.
- **Resume restarts from the read.** A fresh attach, a fresh read, and BB-04's "Google
  changed since you planned" check. A confirmed plan isn't asked again. After a resumed
  read, a `plan` event puts the strips back in Plan before `start`/`activate`, except when
  the resume is finishing a read-back.
- **Read-back interrupted after a confirmed Save.** `ReauthRequired` gains `afterSave`.
  Before handing over, busbar records ownership from what's known: its adds count as
  there, its removals don't count as gone yet. `planned` is kept. On resume the read is
  the read-back.
- **An earlier Save that landed.** If a fresh read equals `planned.next`, busbar records
  ownership and spends the plan without writing or asking. This covers a re-run after a
  stop at the read-back.
- **What carries on:** Enter, or quitting busbar's window (Cmd-Q), as in `bb login`. A
  window quit too early just bounces again into a new handoff. Ctrl-C and EOF stop.
- **The instruction names the page by host and path only.** Google's sign-in URLs carry
  opaque state, so busbar doesn't print the query. The plain window still opens the full
  URL.
- **If the automated browser won't close, no plain window opens.** A second launch on a
  profile that's still open would hand the page to the automated browser. busbar fails
  instead.
- **`bb plan` drops the stale plan at its first handoff,** before the wait, so a plan
  killed or hung up while waiting can't leave an old tunnel's plan for `bb apply`. A
  resume that reads writes the new plan.
- **A second bounce while a confirmed Save is unread stays after-Save,** so the board,
  the prompt and the stop all say the Save went through.
- **`local.json`** goes to signed out at the handoff, and back to signed in when a resumed
  run reads the console.
- **`isReauth` stays host-only.**
- **`bb login` with a closed stdin** now ends the wait at once and runs its check, instead
  of waiting for Cmd-Q. The wait for Enter is shared with the handoff.

### Real-world checks pending

Run these as part of the one ordered session in [REAL-WORLD-CHECKLIST.md](../REAL-WORLD-CHECKLIST.md). It sets the order and the setup, and this list keeps the detail.

1. **Manual handoff on apply (acceptance 1).** In a project logged in with
   `bb login google` against the sandbox OAuth client:
   1. Run `bb plan --tunnel https://<new>.ngrok-free.app`.
   2. Sign out inside busbar's profile. Get the profile path from `bb status`, then run
      `open -na "Brave Browser" --args --user-data-dir="<profile>" https://accounts.google.com/Logout`,
      let it sign out, and quit that window with Cmd-Q.
   3. Run `bb apply`. Expect the instruction to name Brave and an
      `accounts.google.com/...` page, and a plain Brave window (a second Dock icon) at that
      page.
   4. Sign in there, then press Enter. Expect the plan printed, the confirm prompt, and
      "Saved…". The strips land Applied. Then run `bb verify`.
2. **Ctrl-C in a real terminal.** Repeat 1.1 to 1.3, then press Ctrl-C at the
   instruction. Expect exit 2 (`echo $?`), the strips in Your turn on `bb ui`, the plain
   Brave window gone, and the client unchanged in the console. Then run `bb apply` again:
   it must open a fresh window, which shows the profile isn't locked.
3. **Board timing (acceptance 5).** With `bb ui` open beside the terminal, run 1.3. The
   strips must reach Your turn within 1s of the instruction appearing, then move to Active
   and Cleared after Enter.
4. **Google's step-up mid-run.** If Google asks "Verify it's you" while busbar is editing,
   record the URL it redirects to (host and path only). Check that the plain window opens
   that page and that the run carries on after you finish.
5. **The continue link.** Check that the page Google redirected to, opened in the plain
   window, returns to the client page after sign-in. If Google's sign-in URL expires,
   record it: busbar may need to open `signInUrl()` instead.
6. **Cmd-Q instead of Enter.** At the instruction, quit busbar's Brave window with Cmd-Q.
   Expect busbar to carry on and re-read.

