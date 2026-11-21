# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React Router v8 (user's choice), built as a static SPA (`ssr: false`) so the `bb` CLI can bundle it and serve it on localhost via `bb ui`. Vite, TypeScript, Tailwind v4. Icons: `@pikaicons/react` + `@pikaicons/core-free` (user's choice). Motion follows the `transitions-dev` token scale (user's choice). Marketing/video product shots are built with the `stageshow` skill from the same components (user's choice).

## Users

Primary: the builder himself, a solo applied-AI engineer who ships client and side projects weekly across many cloud/BaaS consoles (Google Cloud, Supabase, Vercel, Render, Razorpay, Stripe, Meta WhatsApp, Neon). Secondary: other developers like him, on stacks busbar has a recipe for. They open busbar mid-build, usually with a terminal and editor beside it, when a value has to land in several consoles or when something stopped working after a URL changed.

## Product Purpose

busbar (`bb`) wires cloud providers together. A project's stack is declared once; busbar knows every place each value must be registered (callback URLs, redirect URIs, webhook URLs, env vars, verify tokens, secrets), computes an ordered plan, applies it, and proves it worked. Success is `bb verify` passing against the real deployment, not the agent saying it configured something.

The one-line problem: one tunnel URL has to be re-registered in the Razorpay webhook, the Stripe webhook, Meta's callback URL and Google's authorized origins every time it rotates. Nothing holds that dependency graph today.

## Positioning

Cross-provider wiring with verification. Single-provider tools (Supabase/Neon/Vercel MCPs and CLIs) and Stripe Projects (catalog provisioning, key fetching, `.env` sync) stop at their own edge; Stripe Projects explicitly stops when a service is not in its catalog. busbar starts there: the console-only tail (e.g. creating a Google OAuth web client, which has no public API), the values that must match across providers, drift detection, and verification. It complements Stripe Projects rather than competing with it.

## Operating Context

- Local-first CLI: `bb login <provider>`, `bb plan`, `bb apply`, `bb verify`, `bb rewire --tunnel <url>`, `bb ui`.
- Three-tier executor per step: first-party MCP/CLI where it exists, raw API second, headless browser (DOM-first, isolated per-project profile) only for console-only steps.
- Login is human: a headed window opens once, the developer signs in with MFA/passkey themselves, the profile persists per project, Keychain-encrypted. busbar never sees a password.
- Secrets move through a local vault/broker: values go provider→provider without entering the model's context or the UI. The UI shows slots, fingerprints and where a value lives, never the value.
- "Your turn" handoff: when a step can't run unattended (or the agent isn't confident), busbar stops and hands the human the exact click with a deep link, then resumes.
- Irreducibly human steps exist and are shown as such: Meta business verification, Google app publishing verification, Razorpay live KYC, Stripe India eligibility.

## Capabilities and Constraints

- v1 scope: setup only. First recipe = tunnel-URL rewire across Razorpay, Stripe, Meta and Google. Second = Supabase + Google OAuth + Vercel, zero to a working login.
- Ops verbs (clone a dev DB, preview envs) are v2; they touch live data, so `plan` must show exactly what is created, copied and overwritten before anything runs.
- Everything is local. No hosted service, no telemetry, nothing leaves the machine. A hosted version is ruled out by design.
- Name: package `busbar`, binary `bb`. Licence: MIT. Not a revenue product; a credibility asset and daily tool.
- Undecided: domain and GitHub org for `busbar` (only npm availability checked).

## Brand Commitments

- Name `busbar`: the electrical component that takes one source and distributes it to many destinations. The product's core operation.
- Typography is user-pinned: Bricolage Grotesque (display) and Figtree (body).
- Icons are user-pinned: Pika Icons.
- Voice: precise, infra-literate, honest about what it did and did not do. Never claims success it did not verify.

## Evidence on Hand

- Real wiring source: `../enquiry-to-paid/docs/SETUP.md` (165-line hand-maintained credential guide) and `../enquiry-to-paid/agent/.env.example` (variable names only). Demo data uses this stack's real provider names, env var names, routes and event names; secret values are always masked.
- Real incident: 2026-11-13 Supabase pooler failure (port 6543 transaction pooler vs 5432 session pooler) caused silent zero-row writes. busbar would not have caught it; do not claim it would.
- No users, testimonials, benchmarks, stars or download counts exist. Do not fabricate any.

## Product Principles

1. **Verified, not claimed.** A connection is green only when a real check passed. Unknown is shown as unknown.
2. **Secrets never surface.** The interface proves where a secret lives without ever displaying it.
3. **Hand over the click, don't guess.** Doing 9 of 11 steps and naming exactly which 2 are yours beats doing 11 and silently getting 3 wrong.
4. **Plan before touch.** Nothing changes in a provider until the human has seen the plan.
5. **Recipes are exhaust.** Coverage grows from real projects, starting with the builder's own stack.
