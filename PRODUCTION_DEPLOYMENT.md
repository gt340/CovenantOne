# Production Deployment — Phase 16

**Status: NOT cleared for real users.** Per the explicit Phase 16 instruction — "Do not deploy until critical security issues are resolved" — the HIGH findings in `SECURITY_AUDIT.md` (no rate limiting, an unexplained production env var, no real payment integration) are unresolved. This document describes the current actual state and what's left, not a green light.

---

## 1. Production architecture

```
Browser / mobile
      │
      ▼
Vercel (Next.js 14, App Router)  ── security headers added Phase 15 (CSP, HSTS, etc.)
      │  ├─ app/api/*            server routes, cookie-based Supabase auth
      │  ├─ middleware.ts        session refresh only (no rate limiting)
      │  └─ static pages
      │
      ▼
Supabase (project opgcjnejfvzyqefmvrsi)
      ├─ Postgres — every table RLS-enabled (58/58, verified Phase 15)
      ├─ Auth — email/password (argon2id via app-level AUTH_ARGON2_* config)
      │         + Google/Apple OAuth configured
      │         + default (dev-grade) email sender — NOT production-ready, see §6
      ├─ Storage — referenced via OBJECT_STORAGE_BUCKET/REGION env vars
      └─ Realtime — not confirmed wired to any client code this session

Not integrated at all:
      ├─ Payment provider (no Stripe or equivalent)
      ├─ Voice/video provider (calls table exists, unwired)
      ├─ SMS/OTP provider (IDENTITY_VERIFICATION_PROVIDER_API_KEY exists but
      │   is for photo/ID verification, not phone OTP — phone verification
      │   flow exists in schema/RLS but its SMS backend wasn't confirmed)
      ├─ Monitoring / error tracking
      └─ Automated backup/recovery tooling beyond Supabase's platform default
```

## 2. Deployment instructions (current actual flow)

1. Push to `main` on `github.com/gt340/CovenantOne`.
2. Vercel's GitHub integration auto-builds and deploys to production on every push (no manual approval gate currently configured).
3. Database migrations are applied **separately and manually** via the Supabase MCP `apply_migration` tool (or the Supabase SQL editor) — they are **not** run automatically by the Vercel build. This has been the actual workflow across every phase so far; `prisma migrate deploy` exists as an npm script but isn't wired into the build/deploy pipeline.
4. There is no staging environment distinct from Vercel's own preview deployments (which share the same Supabase production database via `DATABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` — preview deployments are **not** isolated from production data).

**Real gap:** point 4 means every preview deployment (e.g. from a PR) reads and writes the *production* database. There is no separate staging project. This should be fixed before onboarding real users, both for safety (a broken preview branch can't accidentally corrupt real data if it's pointed at a separate project) and so schema changes can be tried against real-shaped data without risk.

## 3. Environment variables required

Confirmed present in Vercel production (values not re-verified, only key existence and target):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (Prisma) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — used by every admin/service-side route built across Phases 12–15 |
| `AUTH_SESSION_SECRET` | Session signing |
| `AUTH_ARGON2_MEMORY_COST_KB` / `AUTH_ARGON2_TIME_COST` / `AUTH_ARGON2_PARALLELISM` | Password hashing tuning |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google sign-in |
| `APPLE_OAUTH_CLIENT_ID` / `APPLE_OAUTH_CLIENT_SECRET` | Apple sign-in |
| `MESSAGE_ENCRYPTION_KEY` / `MESSAGE_ENCRYPTION_KMS_KEY_REF` | Message envelope encryption |
| `OBJECT_STORAGE_BUCKET` / `OBJECT_STORAGE_REGION` | File/photo storage |
| `IDENTITY_VERIFICATION_PROVIDER_API_KEY` | Photo/ID verification |
| `NODE_ENV` | Standard |
| `SEED_CONFIRM` | Guard rail so `prisma/seed.ts` can't run against production unconfirmed — confirm this is its actual purpose and that it's never been left in an "unlocked" state |

**Flagged, not confirmed safe:** `ALLOW_INSECURE_OTP_TESTING_BYPASS` — present in production, referenced nowhere in code. See `SECURITY_AUDIT.md` Finding #2.

**Missing — needed before the corresponding feature can go live:**
- A payment provider secret (e.g. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) — donations/fundraising cannot process real money without this plus the actual integration code.
- An SMTP provider for Supabase Auth (configured in the Supabase dashboard, not a Vercel env var) — required before real signup volume.
- A voice/video provider key — required before `calls` is a real feature rather than a schema.
- A monitoring/error-tracking DSN (e.g. `SENTRY_DSN`).
- A rate-limiting backend if you choose one that needs credentials (e.g. Upstash Redis `UPSTASH_REDIS_REST_URL`/`TOKEN`).

## 4. Database migration procedure (current actual practice)

1. Write the migration SQL.
2. Apply it directly to the production Supabase project via `mcp__Supabase__apply_migration` (or the SQL editor), which also runs Supabase's own linter (`get_advisors`) — every migration this project has run was checked this way.
3. **No rollback tooling exists.** There is no down-migration convention in use; every migration so far has been additive (new tables/columns/policies), never destructive. If a future migration needs to be reversible, that has to be designed explicitly — it isn't currently.
4. Migrations are not currently version-controlled as files in `prisma/migrations` consistently (confirmed in Phase 12–13: only 6 of 20+ real migrations exist as committed files; most were applied directly and never saved to the repo). **This is a real gap**: the live database schema is not fully reconstructable from the repo alone. Recommend backfilling the missing migration files or switching to a workflow where every `apply_migration` call is also committed as a file in the same session.

## 5. Backup procedure

Relies entirely on Supabase's platform-level backups (automatic on paid plans; exact retention depends on the project's plan tier, which wasn't checked this session). **No application-level backup or export process exists.** Recommend, before real users: confirming the Supabase project's actual plan/backup tier, and deciding on a retention policy that matches what a marriage/faith platform holding sensitive relationship and safety data actually needs (likely longer than the default).

## 6. Monitoring procedure

**None exists today.** Current visibility is limited to:
- Vercel's raw deployment/runtime logs (used this session to diagnose the build error).
- Supabase's dashboard (query performance, advisor lints).

No alerting, no uptime monitoring, no error aggregation. Recommend a minimum bar before real users: an error tracker (Sentry or equivalent) wired into both the Next.js app and API routes, plus basic uptime monitoring on the production URL.

## 7. Incident-response procedure

**No formal procedure exists.** Given what Phase 15 confirmed about the audit log and moderation systems, the *building blocks* for one exist (every sensitive action is logged to `audit_logs`; the moderation case system has assignment, priority, and status), but there's no documented runbook for e.g. "a member's account is compromised," "a moderator's access is misused," or "a data-exposure incident is suspected." Recommend writing one before real users — it doesn't require new code, just a decision on who is notified, how, and in what order, using the tooling that already exists.

## 8. Known limitations (consolidated from Phases 12–15)

- No rate limiting anywhere (Phase 15, HIGH).
- No real payment provider (Phase 15, HIGH).
- Preview deployments share the production database (this document, §2).
- Migration history isn't fully reconstructable from the repo (this document, §4).
- No monitoring/error tracking (this document, §6).
- No SMS/voice-video provider wired despite schema support.
- Default Supabase email sending isn't production-scale.
- No real automated test suite (unit/integration/E2E/accessibility/performance) — two stale Phase-1 scripts test an authorization scheme that isn't the one actually enforced (RLS is).
- Several Phase 13 admin sections were never built: Relationships, Events, Content, Notifications, Settings have no dedicated admin UI.
- Compatibility Assistant, Marriage Guidance Assistant, and Business Assistant (Phase 14) were deliberately not built — see `AI_ASSISTANCE_POLICY.md`.
- Leaked-password protection is off in Supabase Auth.
- An unexplained `ALLOW_INSECURE_OTP_TESTING_BYPASS` production env var needs your review.

## 9. Recommended Phase 17

In rough priority order:
1. **Rate limiting** on auth, password reset, report filing, and messaging endpoints — the single highest-leverage fix given a faith-based platform handling sensitive relationship/safety data is a meaningful abuse target.
2. **Resolve or remove `ALLOW_INSECURE_OTP_TESTING_BYPASS`.**
3. **Separate staging Supabase project** so preview deployments stop touching production data.
4. **Real test suite** — at minimum, RLS-focused integration tests (the impersonation technique used in `SECURITY_AUDIT.md` §1 is a reasonable starting pattern) run in CI on every push, since that's the layer actually doing the enforcement.
5. **Monitoring/error tracking**, wired before real users rather than after an incident.
6. **Payment provider integration**, only once a provider is chosen and the flow (campaign → charge → webhook → `donations` row → `campaign_evidence`) is designed end-to-end, not bolted on.
7. **Production SMTP for Supabase Auth**, before real signup volume hits the default sender's limits.
8. **Incident-response runbook**, using the existing audit log / moderation-case tooling.
9. Backfill the remaining Phase 13 admin sections (Relationships, Events, Content, Notifications, Settings) and decide whether the deferred Phase 14 assistants (Compatibility, Marriage Guidance, Business) are still wanted, now that the Safety Assistant pattern (heuristic v1, human review required) exists as a template.
