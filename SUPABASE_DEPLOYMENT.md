# Supabase Deployment — CovenantOne (`opgcjnejfvzyqefmvrsi`, eu-central-1)

This document is the source of truth for what is **actually running** on the
connected Supabase project, as of this session. Everything below was verified
by querying the live project, not assumed.

## What changed from the original (sandbox-only) Phase 1 draft

Phase 1 was designed before this project was connected, with a hand-rolled
`auth_identities` table (argon2id password hashes). Once connected to a real
Supabase project, that design was revised — reinventing credential storage
when Supabase Auth already provides it (correctly, and security-reviewed)
would be worse engineering, not more thorough engineering. Concretely:

- **Removed:** `auth_identities`, `phone_verifications`, `email_verifications`
  tables, and the `AuthProvider` enum.
- **Changed:** `users.id` is no longer a self-generated UUID — it's a foreign
  key to `auth.users.id` (`ON DELETE CASCADE`), auto-populated by a trigger
  (`on_auth_user_created`) the moment Supabase Auth creates an account,
  regardless of signup method (email/password, OAuth, phone).
- **Kept as our own tables:** `age_verifications` and `identity_verifications`
  — Supabase Auth doesn't do age/KYC verification, so those remain ours.
- Local repo files (`schema.prisma`, `migration.sql`) were updated to match
  and re-validated with `scripts/validate_schema_consistency.py` — still
  passing (40/40 tables now, down from 43, since 3 tables were removed).

## What's live right now (verified via direct query against the project)

| Check | Result |
|---|---|
| Migrations recorded | `0001_init_core_schema`, `0002_row_level_security`, `0003_move_helper_functions_to_private_schema` — all three, in order |
| Tables in `public` | 40 |
| RLS enabled | 40/40 tables |
| Policies | 105 |
| `on_auth_user_created` trigger | present, on `auth.users` |
| `trg_enforce_role_assignment` trigger | present, on `public.users` |
| Helper functions in `private` schema (not RPC-exposed) | 8 |
| Leftover helper functions still in `public` | 0 |
| Supabase security advisor | 0 findings |

## Architecture: how RLS relates to `src/lib/auth/authorization.ts`

Two independent layers, intentionally:

1. **RLS policies** (`prisma/migrations/0002_row_level_security/migration.sql`)
   — enforced by Postgres itself, so even a bug in application code can't leak
   a row. These are necessarily coarser than the TypeScript logic in some
   cases (SQL can't express "assigned moderator OR admin-tier doing oversight"
   as elegantly as `canActOnModerationCase()` does) — where that's true, the
   RLS policy is the *outer bound* and the API layer still applies the
   finer-grained check before allowing an action through.
2. **`src/lib/auth/authorization.ts`** — the finer-grained logic, unit tested
   (18/18 passing), used by API route handlers built in later phases.

Neither layer is "the real one" — they're meant to overlap. If they ever
diverge in a way that matters, treat the RLS policy as authoritative for
what's *possible*, and the TypeScript layer as authoritative for what the
*product* should allow.

## Deliberate non-decisions (still open, now with real infrastructure to decide against)

- **Reported-conversation escrow access** (`ACCESS_REPORTED_CONVERSATION_CONTENT`)
  has no RLS policy granting SELECT on `messages` to safety moderators at all
  — on purpose. The plan is a `SECURITY DEFINER` RPC function that re-checks
  every condition in `canAccessReportedConversationContent()` and writes an
  `audit_logs` row atomically, rather than a standing policy. Not built yet —
  flagging so it isn't mistaken for an oversight.
- **`compatibility_scores` and `connections`** have no client-facing INSERT
  policy — by design, both are meant to be written by trusted server-side
  logic (a matching job, and an "accept introduction" RPC, respectively)
  using the `service_role` key, which bypasses RLS. Neither of those
  functions exists yet.
- **Performance advisor** flagged two WARN-level (not security) items, worth
  fixing before real traffic but not blocking: (1) several policies call
  `auth.uid()` directly rather than `(select auth.uid())`, which Postgres
  re-evaluates per-row instead of once per query — a known Supabase
  optimization; (2) a few tables have more than one applicable permissive
  policy for the same operation (e.g. `member_profiles` has separate "own"
  and "discoverable" SELECT policies), which is a deliberate readability
  trade-off but has a minor query-planning cost. Both are safe to defer until
  there's real query volume to profile against.

## Next steps (infrastructure, not app code — see PHASE1_REPORT.md for why
the visual app itself is still on hold)

1. **GitHub**: no MCP connector available for it in this session, so I can't
   push commits directly. Recommend: `git init` this `platform/` folder
   locally, push to a new repo, and (optionally) wire Supabase's GitHub
   integration for migration-on-merge — that's a Supabase dashboard setting,
   not something done through this chat.
2. **Vercel**: connect once there's an actual Next.js app to deploy (Phase 2).
   Vercel's connector available in this session is read/inspect-only (no
   deploy action), so deploys will go through Vercel's own Git integration.
3. **Environment variables**: `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (safe to expose client-side — RLS is what
   makes that safe) plus `SUPABASE_SERVICE_ROLE_KEY` (server-only, bypasses
   RLS — never ship this to the client) will need to go into Vercel's env
   config once the app exists.

## Additional sign-in methods (Google OAuth, passkeys, magic link)

Added on top of the original email+password flow. Two of these need a
one-time setup step in the Supabase dashboard before they'll actually work —
the code alone isn't enough, by design (these are real external integrations,
not something that can be faked from application code).

### Google sign-in — requires dashboard setup

The app calls `supabase.auth.signInWithOAuth({ provider: "google" })`, but
Supabase needs real Google OAuth credentials configured before that does
anything:

1. **Google Cloud Console** → create (or reuse) a project → **APIs & Services
   → Credentials → Create Credentials → OAuth client ID** → Application type:
   **Web application**.
2. Add this **Authorized redirect URI** (get the exact value from Supabase
   dashboard → Authentication → Providers → Google, it's pre-filled there):
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
3. Copy the generated **Client ID** and **Client Secret**.
4. **Supabase dashboard** → **Authentication → Providers → Google** → paste
   both in, toggle it **Enabled**, save.

Until this is done, the "Continue with Google" button will show an error
message rather than silently failing — that's intentional (see the comment
in `app/login/page.tsx`).

### Passkeys — beta, requires dashboard setup

Uses Supabase Auth's native passkey/WebAuthn API (beta as of the Supabase
changelog dated 2026-05-28). Requires `@supabase/supabase-js` v2.105.0+
(bumped in `package.json`) and the client-side opt-in flag already set in
`src/lib/supabase/client.ts` (`auth.experimental.passkey: true`).

Dashboard setup, one time:

1. **Supabase dashboard** → **Authentication → Passkeys** → toggle **Enable
   Passkey authentication**.
2. Fill in:
   - **Relying Party Display Name**: whatever you want shown in the OS
     passkey prompt, e.g. "CovenantOne"
   - **Relying Party ID**: your bare domain, no scheme/port/path — e.g.
     `covenant-one-gamma.vercel.app`
   - **Relying Party Origins**: the full origin(s) users will actually sign
     in from, e.g. `https://covenant-one-gamma.vercel.app`
3. Save.

**Important caveat to know about:** passkeys are cryptographically bound to
the Relying Party ID (the domain) they were registered under. If this
project later moves to a custom domain, passkeys registered under the
`vercel.app` domain will stop working and everyone who registered one will
need to re-register under the new domain. Worth deciding the real production
domain before encouraging members to rely on passkeys heavily.

Registration happens from the **Account** page (`/account`) — a user must
already be signed in to add a passkey (this matches Supabase's own guidance:
passkeys authenticate an *existing* account, so there's no passkey option on
the sign-up page, only sign-in and account settings).

### Magic link — works immediately, no setup needed

Uses `supabase.auth.signInWithOtp({ email })`, which Supabase supports
natively with no additional configuration — the existing email
templates/SMTP setup (already working, since account confirmation emails
work) cover this too.

