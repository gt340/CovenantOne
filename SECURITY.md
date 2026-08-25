# Security — Phase 1 decisions

## Passwords

- Never stored in any form except `AuthIdentity.passwordHash`, an **argon2id**
  hash (memory-hard; current OWASP recommendation over bcrypt/PBKDF2 for new
  systems). Parameters are configurable via env vars (`.env.example`) so they
  can be tuned to the deployment's hardware without a code change.
- OAuth-only identities (Google/Apple) have `passwordHash = null` — there is
  nothing to steal for those rows.

## PII isolation (email, phone)

- `email` and `phoneE164` exist **only** on `AuthIdentity`,
  `EmailVerification`, and `PhoneVerification` — never on `MemberProfile`,
  which is the table every "view another member" code path reads from.
  This is a structural guarantee, not just a convention: there is no column
  to accidentally `SELECT *` into a public API response.
- `canViewContactInfo()` in `src/lib/auth/authorization.ts` always returns
  `false`, for every role including SUPER_ADMIN, and is the single canonical
  place this rule lives. Legitimate support/legal needs (e.g. responding to a
  lawful request) go through a separate, explicitly audit-logged export tool
  to be built in a later phase — not the general read path.

## Private conversations

- A `Conversation` has exactly two participants (`Connection.userAId`/`userBId`).
  `canViewConversation()` checks the requester is one of those two userIds —
  role has no bearing on this check at all; an ADMIN gets `false` here just
  like a stranger MEMBER would.
- Message content is stored as `ciphertext`/`nonce` (envelope encryption,
  AES-256-GCM), not plaintext, so a database compromise alone does not expose
  message content — the KMS-held master key is also required.
- **Moderator/safety-moderator access to a reported conversation is a
  separate, narrow escrow flow**, not a standing permission:
  `canAccessReportedConversationContent()` requires *all* of:
  1. the actor's role has `ACCESS_REPORTED_CONVERSATION_CONTENT` (only
     `SAFETY_MODERATOR` and above — a general `MODERATOR` never has this),
  2. the moderation case is open/investigating/escalated (not closed),
  3. the case is assigned to that specific moderator (not "any case"),
  4. the conversation actually belongs to the reported user (can't use one
     report as a pretext to read an unrelated conversation).
  Every successful access must additionally write an `AuditLog` row
  (`action: "CONVERSATION_ESCROW_ACCESSED"`) — this is a process requirement
  for whoever implements the API handler in a later phase, since the schema
  can't enforce "you called this function" by itself.

## Role-based access control

- Six roles (`MEMBER, MENTOR, MODERATOR, SAFETY_MODERATOR, ADMIN,
  SUPER_ADMIN`), strictly additive tiers — see `permissions.ts` and the
  passing tests in `tests/permissions.test.ts` that assert this additivity
  and that no role accidentally has a permission above its tier.
- `MODERATOR` (general/content moderation) is deliberately **not** a subset
  of `SAFETY_MODERATOR`'s conversation-access powers — a moderator handling
  community-post takedowns has no path to a private conversation, only
  safety moderators handling safeguarding-relevant reports do. This maps
  directly to your requirement "Moderators must have limited permissions."
- Only `SUPER_ADMIN` can grant/revoke `ADMIN` or `SUPER_ADMIN` itself
  (`canAssignRole()`); an `ADMIN` can grant `MENTOR`/`MODERATOR`/
  `SAFETY_MODERATOR` but can't create more admins. This maps to "Do not give
  every admin unrestricted access."
- Resource-scoped checks (not just role checks) exist for the cases that need
  them: `canActOnModerationCase` (must be the assigned handler, unless you're
  admin-tier doing oversight), `canEditOwnResource` (ownership + permission).

## Audit logging

- `AuditLog` is append-only by design (no `updatedAt`, no soft-delete field —
  nothing to update). The intended production DB grant is that the
  application's runtime role gets `INSERT` but not `UPDATE`/`DELETE` on this
  table; a background archival job (not a user-facing code path) is the only
  thing allowed to move old rows to cold storage.
- Every model that represents a privileged action has a natural join to
  `AuditLog` via `actorUserId`/`targetType`/`targetId`: role changes,
  suspensions/bans, verification review decisions, moderation case actions,
  fund disbursement approvals, and reported-conversation access all need a
  corresponding `AuditLog` write in the API handlers that implement them
  (Phase 2+ — the schema provides the table, application code must call it
  consistently, which should be enforced by a shared "privileged action"
  wrapper rather than ad hoc calls scattered through route handlers).

## Row-level access at the database layer (recommendation, not yet implemented)

Prisma/application-layer checks (`authorization.ts`) are the primary
enforcement mechanism in this design and are the ones that are actually
tested in this phase. As defense-in-depth for Phase 2+, consider **Postgres
Row-Level Security (RLS)** policies on `messages`/`conversations` as a second
independent layer, so that even a bug in application code (e.g. a missing
`WHERE` clause) can't leak another user's messages. This wasn't implemented
in this phase because RLS policies need to be tied to the actual DB
connection/session strategy (e.g. `SET LOCAL app.user_id`), which is an
application-runtime decision, not a schema-only one — flagged as a Phase 2
task, not silently skipped.

## What's deliberately NOT solved in this phase

- Rate limiting / brute-force protection on auth endpoints (Phase: auth
  implementation).
- Actual encryption-at-rest key management wiring (KMS integration; schema
  is ready for it, wiring isn't built).
- CSRF/session cookie hardening details (no HTTP layer exists yet).
- Abuse/spam detection heuristics beyond the reporting model itself.
