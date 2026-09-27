# Security, Privacy & Production Audit — Phase 15

**Date:** 2026-09-27
**Scope:** live production Supabase project + live Vercel deployment of the CovenantOne repo at commit `06db202`.
**Method:** direct RLS simulation against the live database (impersonating real accounts via `SET LOCAL role authenticated; SET LOCAL request.jwt.claims`), Supabase's built-in security advisor, source-code search for known anti-patterns, and inspection of actual Vercel production environment variables. This is real testing against the live system, not a design review.

> **This report does not conclude the platform is secure.** It concludes what was tested, what held up, and what did not. Several categories in the Phase 15 checklist could not be meaningfully tested at all (see §4) — their absence of findings is *not* a clean bill of health, it's an untested gap.

---

## 1. What was actually tested, and held up

### Row-Level Security (real impersonation, not policy reading)
Every one of the 58 tables in `public` has RLS enabled with at least one policy (verified via `pg_class.relrowsecurity` + `pg_policies`, not assumed).

Concretely impersonated a plain `MEMBER`-role account (the only one seeded) and attempted to read another user's data directly:

| Target | Result |
|---|---|
| Another user's `phone_verifications` row | **0 rows** — blocked |
| Another user's `identity_verifications` row | **0 rows** — blocked |
| Another user's `donations` (financial records) | **0 rows** — blocked |
| Another user's `reports` (filed or against, uninvolved) | **0 rows** — blocked |
| `audit_logs` (any row) | **0 rows** — blocked |
| `content_flags` (AI safety flags) | **0 rows** — blocked |
| `moderator_notes` (internal case notes) | **0 rows** — blocked |
| Full `users` table (other accounts' role/status/suspension) | **only own row** — blocked |
| `moderation_cases` | **1 row visible** — but investigated: this is `moderation_cases_select_reported_party`, a deliberate policy letting a reported member see *only* the case that names them (needed for the appeals flow), not other people's cases. Correct, not a leak. |
| `member_profiles` (browsing) | **3 of N rows** — scoped by `isDiscoverable = true`, the intended discovery/opt-out flag for a matching platform, not a leak. |

Also impersonated the `SUPER_ADMIN` seed account and confirmed it correctly gets *broader* access (audit logs, cases, phone verification) — role escalation works in the intended direction and not the reverse.

**This is real signal, but weak signal** — the database currently has only 2–3 real accounts and one connection, so most "member vs. a second unrelated member" scenarios (e.g., two members who've never connected, each with their own reports/messages) couldn't be constructed. A fuller test needs seeded data with several unconnected members, which wasn't available.

### Message privacy architecture
Reviewed rather than black-box tested (no way to decrypt/re-derive without the KMS key): messages are stored as `ciphertext`, not plaintext. `messages_select_participant` requires `is_conversation_participant()`. A separate, narrower policy (`messages_select_moderation_case`) grants access only via `has_active_moderation_access()` — confirmed this function chains through an *assigned, open* case, not a standing permission (see `AI_ASSISTANCE_POLICY.md` and prior phase notes for the full chain). Not independently re-verified this session against a live escrow scenario — flagged as untested in §4.

### Static code review
- No `dangerouslySetInnerHTML` anywhere in the codebase (0 hits) — no obvious stored-XSS injection point in React-rendered content.
- No hardcoded API keys / `sk_live` / `sk_test` strings found in source.
- No custom CORS headers anywhere — cross-origin browser requests to the API are blocked by default same-origin policy, which is a meaningful (if implicit) CSRF mitigation for the JSON API surface.
- Supabase's own security advisor: **one WARN**, "Leaked Password Protection Disabled" (HaveIBeenPwned check is off). See §3.

### Fixed this session
- **No security headers were configured at all** (`next.config.js` was an empty stub). Added CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and HSTS. This is a real fix, not just a finding — see commit `06db202`.

---

## 2. Confirmed findings, by severity

### HIGH
1. **No rate limiting anywhere in the codebase** (`grep`-confirmed zero hits for any rate-limit pattern, no middleware doing it). Login, password reset, phone OTP requests, report filing, and message sending are all unthrottled. This is a direct, unmitigated brute-force and abuse vector. **Not fixed this session** — needs a real decision (Vercel's own rate limiting / Upstash Redis / Supabase's built-in auth rate limits) and isn't something to bolt on silently.
2. **A production environment variable named `ALLOW_INSECURE_OTP_TESTING_BYPASS` exists on the live Vercel project**, target = production. Searched the entire codebase for it: **zero references** — it's currently inert, not wired to anything. But its name, sitting live in production, is exactly the kind of "fake/mock integration that could be mistaken for production functionality" Phase 16 explicitly says to remove. Its value couldn't be read back (Vercel "sensitive" vars are write-only via API), so I can't confirm whether it's `true` — which is itself the problem. **Action needed from you:** delete this variable from Vercel production unless you know a specific reason it must stay, in which case rename it to make clear it's dead code and confirm no future code path reads it.
3. **No real payment provider is integrated.** `donations` has `provider`, `paymentProviderRef`, and `isTestMode` columns, and there is no Stripe (or any) webhook route anywhere in the codebase (`grep`-confirmed). Donations currently appear to be recorded as verified evidence (`campaign_evidence`, `verifiedAt`) rather than live-charged. If real money is expected to move through this platform, this is not "configure an env var" — it's unbuilt.

### MEDIUM
4. **No test suite exists beyond two Phase-1 scripts** (`tests/permissions.test.ts`, `tests/authorization.test.ts`, run via `tsx`, not a real framework). They test an app-layer `authorization.ts` scheme described in the (now-superseded) Phase-1 `SECURITY.md` — the actual enforcement layer that shipped is Postgres RLS, which these tests don't touch at all. There is no Jest/Vitest/Playwright, no CI-gated test run on push, no integration/E2E/accessibility/performance tests of any kind.
5. **Leaked password protection is disabled** in Supabase Auth (confirmed via the platform's own advisor). Low effort, real value — needs to be toggled in the Supabase Auth dashboard; no MCP tool available to me can flip this setting.
6. **No monitoring or error tracking configured** — no Sentry (or equivalent) DSN in the Vercel env var list, nothing in `package.json`. Production errors currently have no visibility beyond Vercel's raw function logs.
7. **No email service configured for production volume.** No `RESEND_API_KEY`/`SENDGRID_API_KEY`/SMTP vars exist. Supabase Auth's default built-in email sending is meant for development — it's aggressively rate-limited and not suitable for real signup/password-reset volume. This will silently start failing under real usage unless a custom SMTP provider is configured in Supabase Auth settings.
8. **No voice/video provider configured.** A `calls` table exists (with its own RLS, tested and correctly scoped to participants), but no provider key (Twilio/Daily/Agora/etc.) exists in the env vars and no provider integration code was found — the schema is ready, the actual calling feature is not wired to a real service.

### LOW
9. CSP ships with `style-src 'unsafe-inline'` (added this session, but not fully hardened) — fine for now given no inline `<script>` usage, but worth tightening to a nonce-based policy once styling approach stabilizes.
10. `SEED_CONFIRM` is present as a production env var — likely a guard rail for the seed script (`prisma/seed.ts`) requiring explicit confirmation before running against production, which is a *good* pattern, not a finding — flagged here only so you can confirm that's actually its purpose and that seeding was never accidentally run against production.

---

## 3. Fixed this session vs. requires your action

**Fixed directly (code, this session):**
- Added security headers (CSP, HSTS, X-Frame-Options, etc.) to `next.config.js`.

**Requires action outside what I can reach from here:**
- Rate limiting (needs a provider/architecture decision).
- Remove or clarify `ALLOW_INSECURE_OTP_TESTING_BYPASS` from Vercel production env vars.
- Enable leaked-password protection in the Supabase Auth dashboard.
- Decide on and wire a real payment provider if donations are meant to process real money.
- Configure a production SMTP provider in Supabase Auth (the default sender will not scale).
- Decide on and wire a monitoring/error-tracking provider.
- Decide on and wire a voice/video provider for the `calls` feature.

None of these are things I fabricated or guessed at fixing silently — each needs either a credential you hold, a product decision (which provider), or a setting only visible in a dashboard I don't have a tool to reach.

---

## 4. What could NOT be meaningfully tested this session (honest gaps in this audit, not just in the product)

- **Session security / account takeover / password reset flows** — untested. No way to drive a real browser session or receive a real reset email from here.
- **CSRF** — reasoned about (no CORS headers + SameSite cookies), not exploited or proven.
- **File upload security** — did not locate and test an actual upload endpoint this session.
- **Webhook verification** — moot; no webhook-receiving endpoint exists yet (see Finding #3).
- **SQL injection** — the codebase uses the Supabase JS client's parameterized query builder throughout every route reviewed this and prior sessions; no raw string-interpolated SQL was found in application code. Not the same as a dedicated injection fuzzing pass.
- **Abuse prevention beyond RLS** (e.g. spam pattern detection at scale) — only the Phase 14 heuristic flagger exists; untested against adversarial input.
- **Data deletion** — no account-deletion flow was located and exercised this session; unclear whether one exists.
- **Privileged administrator access** beyond the RLS-level SUPER_ADMIN test above (didn't attempt to exercise every admin UI action end-to-end).

## Bottom line

RLS held up under every concrete attack attempted this session, and that's real, tool-verified evidence — not a claim taken on faith. But "held up under the tests I could run with two seeded accounts and no browser session" is a narrower claim than "secure." The HIGH findings above (no rate limiting, a dead-but-alarming production env var, no real payment integration) are real and should block treating this as production-ready for real users and real money, independent of anything RLS does right.
