# BB-07: `bb rewire --tunnel <url>`: the whole loop, live

**Demo when done:** your ngrok URL rotates. You run `bb rewire --tunnel <new>` with the board
open beside it. The plan prints, you confirm once, and the strip moves Plan → Active →
Cleared → *checking* → **verified** in real time. The run ends with an honest summary of
what busbar did, what it checked, and what it didn't. This is the moment from the product
video, for real.

**Depends on:** BB-05, BB-06
**Layers:** cli · core (run orchestration) · run state · ui

## Why this slice

This is the product's promise end to end: one rotated value, re-registered, proven. It
mostly composes BB-03 to BB-06, plus what makes it feel finished.

## Scope

- **`bb rewire --tunnel <url>`** = plan → confirm → apply → verify in one run, sharing one
  browser session between plan and apply (no second launch).
- **Validation:** reject a non-`https` URL or one with a path or trailing slash, with a clear
  reason, before any browser opens. (Decided 2026-11-22: a pasted trailing slash is
  normalised away, as `bb plan` already does, not rejected. A path, a query or a fragment
  is rejected.)
- **Summary**, in the product's voice:
  `Google · redirect URI · verified (Google accepted it 14:02)`
  `Google · JS origin · listed, not exercised`
  `Removed 1 old entry busbar had added. Kept 2 that aren't busbar's.`
- **Exit codes:** `0` = every required check verified (unexercised-by-design checks don't
  fail the run); `1` = something failed; `2` = stopped at a handoff; `3` = finished but a
  required check is still unknown or not accepted yet.
- **Live board polish:** `bb ui` launched after a run shows the final state; launched during
  a run, it joins mid-stream with no missed or duplicated strips.
- **`bb rewire` with no changes** (same tunnel as last time): "Already wired. Run
  `bb verify` to re-check."

## Acceptance criteria

- [ ] Full real run against the sandbox client from a rotated URL ends **verified**, exit 0.
- [ ] Same run with the board open shows every transition in order, with no reload.
- [x] Opening the board mid-run shows the correct current state.
- [x] Rerunning with the same URL is a no-op with the "Already wired" message.
- [x] Bad URLs are rejected before any browser launches.
- [x] Exit codes match the table in a test using a fake recipe.
- [ ] Record a short screen capture of the run beside the board for the build-in-public log.

## Out of scope

Other providers, tunnel auto-detect, UI-triggered runs.

## Done (2026-11-22)

`bb rewire --tunnel <url> [--yes] [--wait <seconds>]` runs plan, confirm, apply and verify
as one run, on one automated browser session for plan and apply. Verify needs no browser,
so the browser closes before it. Exit codes go through one pure function, shared with
`bb verify` and `bb apply`.

### Tests added

- **Seam 1**
  - `src/core/exit.test.ts`: the exit-code table. Finished with no required checks or all
    accepted is 0; failed is 1; stopped is 2; finished with a rejected or unknown required
    check is 3.
  - `src/core/board.test.ts`: `verify-done` reads `verified` only when every strip is
    verified or unexercised, and `unverified` when one is rejected or unknown. `follow`
    applies the next event, skips one the snapshot already holds, and asks for the
    snapshot again after a gap, another run, or no snapshot.
  - `src/core/rewire.test.ts`: `latestChecks` gives each URI its last recorded result, in
    the order asked, and null for a URI never checked.
  - `src/core/plan.test.ts`: each bad tunnel says why: not a URL, not https, a path, a
    query, a fragment.
- **Seam 3**, `test/rewire.test.ts`:
  - The full run: exit 0, one attach for plan and apply, one Save, one run in
    `events.jsonl` in the order plan, start, activate, settle, apply-done, verify-start,
    check, checked, verify-done. Phase `verified`, ownership updated, one accepted check,
    and the summary lines.
  - A bad `--tunnel` (http, a path, a query, a fragment): exit 1, the reason, and the fake
    world and state.json untouched, so zero attaches.
  - Same tunnel again after an accepted run, with a pasted trailing slash: "Already
    wired", exit 0, zero attaches, no request to the verify stub, state.json, run.json
    and events.jsonl byte-identical.
  - Same tunnel again after a run Google hadn't accepted yet: exit 3, the URI named,
    zero attaches, zero stub requests. After an apply that was never verified: exit 3,
    "hasn't checked".
  - Same tunnel planned but never applied, and same tunnel present but an old busbar
    entry still to remove: not wired, carries on.
  - Google already holds what busbar.toml wants but state.json can't say so: one attach,
    no Save, "Already wired, but busbar hasn't checked …", exit 3.
  - Exit 2 at a handoff before Save and at the plan's read, with the rewire-specific stop
    messages. Exit 0 after a handoff you finish: two attaches, one plain window, one Save.
  - Exit 3 for unknown (network off) and for not accepted (mismatch), phase `unverified`,
    and no "verified" in the output.
  - Exit 1 for a refused Save (no verify request), and for no terminal without `--yes`.
  - `--wait 1` with a mismatch then an accepted answer: the waiting line, two checks
    recorded, the waiting note on the strip, exit 0. This is the CLI wait path BB-05
    left untested. It sleeps about 1s.
  - No `[destinations]` table, or an empty one: "Nothing to rewire", exit 0. Before
    `bb login google`: refuses, exit 1, no browser.
- **Seam 3**, `test/daemon.test.ts`: `bb ui` started while a rewire is held mid-verify by
  the stub. The snapshot reads `verifying` with the strip `checking`. The events streamed
  after it have contiguous seqs from snapshot+1 to the final seq, and `follow`ing them
  from the snapshot gives exactly the final run.json.
- **Seam 3**, `test/plan.test.ts` and `test/apply.test.ts`: `bb plan` and `bb apply`
  without a Google destination say so and exit 0. Before this they crashed with
  "Cannot read properties of undefined (reading 'google')".

### Decisions

- **Trailing slash.** Normalised, not rejected (see Scope).
- **Already wired, from state.** busbar opens no browser when state.json alone settles it:
  - the last plan was for the same resolved values and the same busbar.toml lists
  - that plan had nothing left to change (`planned.read` equals `planned.next`)
  - busbar's last read or read-back of the client held every entry busbar.toml wants.

  The output says busbar didn't open Google this time, and that `bb plan --tunnel <url>`
  reads the client again. It doesn't claim anything about the client since that read.
- **Already wired, exit code (review fix).** The exit code follows the spec's table, not
  a plain 0. busbar takes the latest recorded check in `google.checks` for each redirect
  URI busbar.toml wants (`latestChecks` in `src/core/rewire.ts`), still with no browser
  and no request:
  - every one accepted: "Already wired. Run `bb verify` to re-check.", exit 0
  - any rejected or unknown: "Already wired, but Google hasn't accepted <uri> yet. Run
    `bb verify` to check again.", exit 3
  - any never checked: "Already wired, but busbar hasn't checked <uri> with Google yet.
    Run `bb verify` to check.", exit 3

  So `bb rewire --tunnel X && deploy` never goes ahead on an unproven redirect URI.
- **Already wired, after a read.** When state.json can't settle it, rewire reads the
  client. If there's nothing to change it prints the plan, then the same already-wired
  line and exit code as above, without verifying.
- **Exit codes.** `exitCode` in `src/core/exit.ts`. `bb verify` and `bb apply` return
  through it. Refusals that throw still exit 1 through `bb.ts`.
- **Board phase after verify.** `verify-done` gives `verified` only when every strip is
  verified or unexercised by design; otherwise the new phase `unverified`. Its status line
  reads "Verify finished, not all verified: … Re-run bb verify later." The demo never
  reaches `unverified`, so the demo-replay snapshots are unchanged.
- **Mid-run join.** The board's join rule is `follow` in `src/core/board.ts`, used by the
  live board and by the daemon test. An event the snapshot already holds is now skipped
  instead of triggering a reload.
- **Summary lines** name the entry, since a client can list more than one:
  `Google · redirect URI <uri> · verified (Google accepted it 14:02)`,
  `Google · JS origin <origin> · listed, not exercised`, then the ownership line. Not
  accepted reads ``not accepted yet (Google answered redirect_uri_mismatch at 14:12).
  Re-run `bb verify` later.`` Unknown reads ``unknown, not verified (<why>). Re-run
  `bb verify`.``
- **No second confirm list.** Rewire prints the plan diff, then the confirm, without
  `bb apply`'s add/remove list, which repeats the diff it just printed.
- **A stop after a confirmed Save** points to `bb apply`, then `bb verify`. Rerunning
  rewire there would re-plan instead of recording what landed.
- **No `--adopt` or `--debug` on rewire.** `bb plan --adopt` then `bb apply` still cover
  likely-stale entries.
- **`[destinations]` crash.** busbar.toml without `[destinations]` (or without `[values]`)
  now loads as an empty table. `bb plan`, `bb apply` and `bb rewire` say "no Google
  destination" and exit 0, as `bb verify` already did.
- **Shared code.** `planGoogle` (cli/plan.ts), `applyGoogle` (cli/apply.ts) and
  `checkGoogle` (cli/verify.ts) are the bodies of the three commands, so rewire composes
  them instead of copying them. The sequencing and the rules are in `src/core/rewire.ts`.

### Real-world checks pending

1. **The full loop against the sandbox client (acceptance 1).** In a project logged in
   with `bb login google`, with `bb verify` having worked once for the current tunnel:
   1. Start a new ngrok tunnel so the URL rotates.
   2. Run `bb rewire --tunnel https://<new>.ngrok-free.app` in a real terminal. Expect the
      plan, then `Apply N changes to Google? [y/N]`. Answer `y`.
   3. Expect "Saved…", then possibly "waiting for Google to pick up the change" lines,
      then `Google · redirect URI … · verified (Google accepted it HH:MM)` and exit 0
      (`echo $?`). If Google takes longer than 10 minutes, expect exit 3 and the "not
      accepted yet" line; `bb verify` later must turn it green.
   4. Check in the Cloud console that the client lists the new entries and not the old
      tunnel's.
2. **Board beside the run (acceptance 2).** Run `bb ui` first, then 1.2. The strips must
   move Plan → Active → Cleared → checking → verified without a reload, and the status
   line must read "Verify finished: 1 verified, 1 not exercised."
3. **Board opened mid-run (acceptance 3, by eye).** Repeat 1.2 with `--wait 600` while
   Google still answers mismatch, and open `bb ui` while it waits. The board must show
   the strips Cleared with the redirect strip checking, then follow to the end.
4. **Rerun (acceptance 4).** Run the same `bb rewire --tunnel …` again. After a run that
   ended verified, expect "Already wired. Run `bb verify` to re-check.", exit 0, and no
   Brave window or Dock icon. After a run that ended "not accepted yet", expect "Already
   wired, but Google hasn't accepted … yet.", exit 3, and still no browser.
5. **Answering no.** Repeat 1.2 and answer `N`. Expect "Not applied: you answered no.
   Nothing changed in Google.", exit 1, and the client unchanged.
6. **Screen capture (acceptance 7).** Record the terminal and `bb ui` side by side for
   run 1, for the build-in-public log.

