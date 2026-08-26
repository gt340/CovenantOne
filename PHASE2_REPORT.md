# Phase 2 Report — Authentication, Registration, and Member Onboarding

## 1-4. Inspection

Inspected the live Supabase project and local repo before starting: 40 tables,
RLS on all of them, Phase 1's `User`/`MemberProfile`/etc. schema in place, no
auth UI existing yet. Found two real gaps while building this phase (not
invented scope — both are documented below and fixed via real migrations,
not silently patched).

## 5. Implementation plan (as executed)

1. Extend the schema for what Phase 2 needs but Phase 1 didn't have:
   `PENDING_VERIFICATION`/`DELETED` statuses, `MaritalStatus`, a DB-level
   18+ check, and a reintroduced (narrowly-scoped) `phone_verifications`
   table.
2. Pure business logic first (eligibility, directory classification, account
   status rules, OTP logic) — dependency-free so it's genuinely unit
   testable in this sandbox before touching Supabase/Next.js code.
3. Supabase client wiring for the three trust levels the app needs (browser,
   server/cookie-aware, admin/service-role).
4. API routes for every required operation, each behind a real
   authorization check (`requireActiveUser`/`requireVerifiableUser`), not
   just "logged in or not."
5. Onboarding UI matching the exact flow ordering requested: Account →
   Verification → Personal information → Values → Marriage intentions →
   Profile completion → Community.
6. A security review pass before calling it done — see section 8.

## 6. What was implemented

**Database (migrations 0004–0006, all applied and verified live):**
- `PENDING_VERIFICATION` and `DELETED` account statuses
- `MaritalStatus` enum + field on `member_profiles`
- DB-level `CHECK` constraint enforcing 18+ (`chk_member_profiles_min_age`)
- `phone_verifications` table with RLS, scoped as a trust/safety signal —
  explicitly NOT a Supabase Auth login method (login stays email+password
  only)
- A trigger that auto-promotes `PENDING_VERIFICATION` → `ACTIVE` the moment
  Supabase confirms the account's email
- A trigger closing the status-escalation gap found in review (section 8)

**Required features, and where each lives:**
| Requirement | Implementation |
|---|---|
| Sign up | `app/signup/page.tsx` — calls `supabase.auth.signUp` directly (standard pattern) |
| Sign in | `app/login/page.tsx` |
| Sign out | `src/components/SignOutButton.tsx`, used on `/onboarding`, `/account` |
| Password recovery | `app/forgot-password/page.tsx` (request) + `app/reset-password/page.tsx` (completion) |
| Email verification | Supabase Auth native, via `app/auth/callback/route.ts` (PKCE code exchange) + the DB trigger above |
| Phone verification | `app/api/onboarding/phone/{request-otp,verify-otp}/route.ts`, UI in `PhoneVerificationStep.tsx` |
| Secure session management | `src/lib/supabase/{client,server}.ts` + `middleware.ts` (cookie refresh on every request — required, not optional, for `@supabase/ssr`) |
| Account deletion | `app/api/account/delete/route.ts` — soft-delete by design, see inline comment for why |
| Account suspension handling | `requireActiveUser()` blocks every API route for non-ACTIVE accounts with a specific reason; `/onboarding` and `/account` show the actual status to the user |
| Registration fields (all of them) | `src/lib/validation/registration.ts` (zod schemas) + the onboarding step components |
| MEN/WOMEN directory classification | `classifyDirectory()` in `src/lib/domain/eligibility.ts` — a pure function, not a stored column (see rationale in that file) |
| 18+ eligibility | Enforced twice: `isAtLeast18()` in application validation AND the DB `CHECK` constraint |
| Account status values | `UserStatus` enum: `ACTIVE, PENDING_VERIFICATION, SUSPENDED, BANNED, DEACTIVATED_BY_USER, PENDING_DELETION, DELETED` |
| Duplicate email prevention | Supabase Auth's native `auth.users.email` uniqueness |
| Duplicate phone prevention | DB `UNIQUE` constraint on `phone_verifications.phoneE164`, surfaced as a clear 409 error |
| Never expose sensitive info publicly | No new gap introduced — Phase 1's PII isolation (email/phone never on `member_profiles`) still holds; phone verification status is readable only by its owner and safety-moderator tier (RLS) |

## 7. Testing performed / NOT performed

**Performed, and passing right now:**
- 44/44 offline unit tests (`npm run test:auth` plus the four new Phase 2
  test files) — eligibility/age-boundary logic, directory classification,
  account-status access rules, OTP generation/hashing/expiry/attempt-limiting,
  and onboarding step resolution (which step a user should land on given any
  combination of progress flags).
- Schema/migration consistency validator, upgraded this phase to check the
  *cumulative* effect of all 6 migrations (previously only checked the
  first) — 41/41 tables passing.
- Every live DB change (migrations 0004–0006) was verified against the real
  Supabase project with direct queries after applying — not just trusted on
  a success flag. Security advisor: 0 findings throughout.

**NOT performed — and this matters for your "do not proceed to Phase 3
until authentication is functional" instruction:**
- No real signup → email confirmation → login → logout end-to-end run.
  This sandbox has no network access to install `next`/`@supabase/ssr`/`zod`
  or to receive a real confirmation email, so I cannot verify the full user
  journey myself. The API routes and pages are written to the same
  standards as everything already proven working (Phase 1's health-check
  route, which *did* get verified live on Vercel), but this phase's actual
  auth flows are unverified until you run them in your Codespace/Vercel.
- Phone OTP delivery has no real SMS provider — by design, not oversight
  (see `src/lib/domain/sms-provider.ts`). It works in development (code
  logged + returned in the API response) and will fail loudly, not
  silently, outside development until a real provider is wired in.
- Password recovery's actual email delivery, same caveat as signup.

**What to run once this is in your Codespace**, in order:
```
npm install
npm run build          # catches any type errors, same as last time
npm run test:auth       # should show 44 passed, 0 failed across 6 files (rename this script if you want it to reflect the new file count)
npm run validate:schema
```
Then push, redeploy on Vercel, and actually walk through: sign up with a
real email you control → confirm it → get redirected into onboarding →
verify phone (dev mode will show you the code directly since
`NODE_ENV=production` on Vercel — see the SMS provider note below, this
means phone verification will NOT work on your live Vercel deploy until a
real SMS provider is configured) → fill personal info → values → marriage
intentions → land on the completion screen → sign out → sign back in →
try deleting the account.

**Important gap to flag before you test on Vercel specifically:** phone
verification will hit the "no SMS provider configured" error in production
(Vercel sets `NODE_ENV=production`), by design — dev-mode code display only
works locally. If you want to test the phone step on the live Vercel deploy
before a real SMS provider is wired in, tell me and I can add a temporary,
clearly-labeled bypass, or we can prioritize wiring a real provider (Twilio
is the most common choice) as an explicit next step.

## 8. Security decisions (including one real bug found and fixed this phase)

- **Found and fixed:** the Phase 1 RLS policy `users_update_own_non_privileged_fields`
  was row-level (as all RLS is) but its name implied column-level
  protection it didn't actually have — a member could have updated their
  own `status` field directly, including reactivating themselves from
  `SUSPENDED`/`BANNED`. Migration 0006 closes this with a trigger mirroring
  the pattern already used for `role` escalation. This was caught during
  this phase's own review, not reported by you — flagging prominently
  because it's exactly the kind of gap that's easy to miss and important to
  catch.
- Account deletion is a soft-delete (status transition + session revocation)
  rather than an instant hard delete — full reasoning is an inline comment
  in `app/api/account/delete/route.ts`. This is a product/legal policy
  decision as much as a technical one; confirm it matches your intent
  before real users start deleting accounts.
- Sign-up, sign-in, and password-reset error messages are deliberately
  generic (not confirming/denying whether an email exists) — standard
  practice against account enumeration. This trades off against the Phase
  2 instruction's phrasing "prevent duplicate email accounts" reading as
  wanting explicit "this email is taken" feedback; I chose the safer
  default and want you to confirm it's what you want given the flag.
- Phone verification is intentionally NOT a Supabase Auth login method —
  it's a separate trust signal. Login stays email+password only. This
  avoids conflating "we verified you can receive texts at this number"
  with "you can log in using this number," which are different guarantees.

## 9. Unresolved questions

1. **SMS provider choice** — phone verification cannot work outside
   development until one is wired up. Twilio is the most common choice;
   confirm before I integrate it.
2. **Account-enumeration tradeoff** (above) — confirm the generic-error
   approach is what you want.
3. **Deletion grace period** — currently instant status transition, no
   scheduled hard-delete/purge job exists yet. If you have a specific data
   retention requirement (e.g. "purge after 30 days"), that's a Phase-later
   background job, not yet built.
4. **Directory classification** is a pure function, not a stored column —
   confirm this is fine once actual discovery/search features get built
   (a later phase), since a computed value is slightly more expensive to
   query against at scale than an indexed column, though for two possible
   values this is unlikely to matter in practice.

## 10. Recommended next step

Per your own Phase 2 instructions ("Do not proceed to Phase 3 until
authentication is functional") — the next step is for you to actually run
the tests above in your Codespace and walk through the real signup →
verification → onboarding → login/logout flow on the live Vercel deploy,
report back what works and what doesn't, and only then move to Phase 3
(member profile system). I've built this to the same standard as the
Phase 1 work that did get verified end-to-end, but I want to be direct that
this phase's auth flows specifically are unverified by me until you've run
them for real.
