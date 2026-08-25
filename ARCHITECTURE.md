# Architecture — Phase 1

## Stack decision

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript | Type safety across API, domain logic, and (later) frontend; one language for the whole stack. |
| Framework | Next.js (App Router) | Server + API routes in one deployable unit; good fit for a phased build where UI comes later. Not yet scaffolded — Phase 1 is data/domain only per your instruction not to build the visual app yet. |
| Database | PostgreSQL | Relational integrity matters a lot here (uniqueness of connections/blocks, referential integrity across 40+ related entities, transactional guarantees for things like fund disbursement). JSONB covers the few genuinely flexible fields (compatibility factor breakdown, milestone lists). |
| ORM | Prisma | Schema-as-code (`schema.prisma`) is the single source of truth used throughout this phase; generates a typed client; first-class migration tooling. |
| Auth | Custom, argon2id password hashing + JWT/session tokens; OAuth (Google/Apple) as additional `AuthIdentity` rows | Argon2id is the current recommended password hash (memory-hard, resistant to GPU cracking) — see SECURITY.md. Auth deliberately isn't hard-wired to a specific vendor yet (e.g. not "Auth0-only") so we're not locked in before Phase 2 requirements are clearer. |
| Realtime (messaging/calls) | Deferred | Needed for Phase where messaging/calls are actually built. Candidates to evaluate then: a managed WebRTC/comms provider (e.g. Twilio, Agora, Daily) vs. self-hosted (LiveKit). Not decided now because picking it before the message/call domain logic exists would be premature lock-in. |
| Object storage | S3-compatible (bucket TBD: AWS S3 / Cloudflare R2 / GCS) | Photos, ID verification documents, voice message audio. Schema only stores storage *keys*, never public URLs — signed URLs are generated per-request at the API layer. |

## Why the SQL migration is hand-authored, not `prisma migrate dev` output

This sandbox has no network egress and no PostgreSQL server/`@prisma/client`
package available locally (confirmed by attempting `npm install`, `apt-get
install postgresql`, and a raw HTTPS request — all blocked; see
PHASE1_REPORT.md for the exact commands and results). `prisma migrate dev`
needs both a live database to diff against and network access to download
Prisma's query engine binary, neither of which exist here.

Rather than fabricate a "migration ran successfully" result, `schema.prisma`
is the single source of truth and `prisma/migrations/0001_init_core_schema/migration.sql`
is a hand-authored SQL mirror of it. `scripts/validate_schema_consistency.py`
parses both files and fails if a table, or any scalar field/column, is out of
sync — this is a real, currently-passing automated check, but it is a
structural lint, **not** proof the SQL executes cleanly against Postgres.
The very first thing to do in an environment with real infrastructure is:

```
npm install
npx prisma migrate dev --name init   # will diff against migration.sql's intent
                                       # and should produce a no-op or near-no-op diff
                                       # if this file was transcribed correctly
```

If that produces anything other than a trivial diff, trust Prisma's diff over
this hand-authored file and treat that as a bug to fix.

## Entity model additions beyond the requested 42

Two structural additions were necessary for referential integrity and were
not in your list — flagging per your instruction not to silently add scope:

- **`EventAttendee`** (join table between `Event` and `User`): "Events" (#35)
  needs a many-to-many attendance relationship or RSVPs have nowhere to live.
  Minimal fields only (rsvp timestamp, attended flag).
- **`MemberInterest`** (join table between `Interest` catalog and `User`):
  "Interests" (#14) is naturally many-to-many (a member has many interests, an
  interest has many members) and a join table is the standard normalized
  representation rather than an array column, which would make querying "all
  members interested in X" require a full scan.

Everything else maps 1:1 to your 42 items (see inline numbered comments in
`schema.prisma`).

## Unresolved architectural questions (need your decision before later phases)

1. **Identity verification vendor & jurisdiction.** `IdentityVerification`
   has a `providerReference` field ready for a third-party KYC vendor (e.g.
   Persona, Stripe Identity, Onfido), but no vendor is chosen. This has real
   legal implications (data retention law varies by country/state) — needs
   your target jurisdiction(s) before Phase "verification" is implemented.
2. **WebRTC/communications provider** for voice/video calls — deferred, see
   table above.
3. **Payment processor** for donations/fundraising (Stripe Connect is a
   common fit for platform-with-payouts, but not decided).
4. **Message encryption key management** — schema assumes per-conversation
   data keys wrapped by a KMS master key (industry-standard envelope
   encryption), but which KMS (AWS/GCP/HashiCorp Vault) isn't chosen.
5. **Gender model scope.** Per your instruction (#4 "Male/female member
   classification"), `Gender` is a two-value enum (MALE/FEMALE) used both for
   a member's own gender and `PartnerPreference.preferredGender`. Flagging
   explicitly since this is a product/scope decision, not a technical one —
   confirm this matches intent before Phase 2 builds registration UI around it.
6. **Database-configurable permissions vs. code-defined.** The current RBAC
   permission matrix (`src/lib/auth/permissions.ts`) is defined in code, not
   database rows. This is simpler and faster for Phase 1–2, but means
   changing a role's permissions requires a deploy. A `Permission` /
   `RolePermission` table would let admins tune this at runtime — worth
   revisiting once you have real moderators using the system and a sense of
   whether permissions need to change without a deploy.
