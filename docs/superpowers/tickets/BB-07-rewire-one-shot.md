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
  reason, before any browser opens.
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
- [ ] Opening the board mid-run shows the correct current state.
- [ ] Rerunning with the same URL is a no-op with the "Already wired" message.
- [ ] Bad URLs are rejected before any browser launches.
- [ ] Exit codes match the table in a test using a fake recipe.
- [ ] Record a short screen capture of the run beside the board for the build-in-public log.

## Out of scope

Other providers, tunnel auto-detect, UI-triggered runs.
