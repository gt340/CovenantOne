# Platform

A faith-based intentional relationship/marriage platform. FIND → GROW → BUILD.

**Status: Phase 1 — architecture, database, and security foundation.** No
visual application has been built yet (by design — see `PHASE1_REPORT.md`).

## What's here

- `prisma/schema.prisma` — the full data model (40 tables), single source of
  truth for the schema.
- `prisma/migrations/` — SQL migrations. **These are already applied for real**
  against the connected Supabase project (CovenantOne) — see
  `SUPABASE_DEPLOYMENT.md` for verified live state (RLS status, policy count,
  security advisor results).
- `src/lib/auth/` — role-based access control: role/permission definitions
  (`roles.ts`, `permissions.ts`) and resource-level authorization logic
  (`authorization.ts`) — e.g. the rule that stops one member from ever reading
  another member's private messages, and the escrow-style rule for how a
  safety moderator can access a reported conversation.
- `tests/` — unit tests for the above, runnable with no external dependencies
  via `tsx` (`npm run test:auth`).
- `scripts/validate_schema_consistency.py` — structural check that
  `schema.prisma` and the SQL migrations agree.
- `prisma/seed.ts` — development-only seed data, triple-gated so it can't
  run against a non-development database by accident.

Read in this order for context: `PHASE1_REPORT.md` →  `ARCHITECTURE.md` →
`SECURITY.md` → `SUPABASE_DEPLOYMENT.md`.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in real values — get them from Supabase
                              # project settings (URL + anon key) and your
                              # own secret manager for everything else
npx prisma generate
npm run test:auth            # should print "18 passed, 0 failed" across two files
npm run validate:schema      # should print "PASSED"
```

The database itself does not need `prisma migrate dev` run against it again —
the schema is already live on Supabase. `prisma generate` (above) is what you
need locally to get a typed client matching that schema.

## Phase discipline

This project is being built phase by phase on purpose (see the original
master instruction preserved in project history / your own notes). Do not
skip ahead to building UI, messaging, calls, payments, etc. without an
explicit phase instruction — each phase should leave the project in a
working, tested state before the next one starts.
