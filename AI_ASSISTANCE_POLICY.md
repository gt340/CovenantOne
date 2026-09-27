# AI Assistance Policy — CovenantOne (Phase 14)

This document records the decision boundary for every AI-assisted feature on
the platform, per the Phase 14 requirement to "document every AI decision
boundary." It is a living document — any new AI feature must add a section
here before it ships, and any change to an existing boundary must be edited
here in the same change.

## Platform-wide rules (apply to every assistant below, no exceptions)

1. **No AI ever claims to know a member's soulmate**, "the one," or makes any
   claim of destined/fated romantic outcome. Compatibility output is always
   framed as an analysis of stated preferences and profile data, never as a
   prediction or guarantee.
2. **No AI enforcement action is autonomous.** Any AI output that could lead
   to a suspension, ban, warning, or other consequence for a member is a
   *suggestion* routed to a human moderator (SAFETY_MODERATOR tier or above)
   for review. See "Safety Assistant" below for the concrete mechanism.
3. **No AI is used to manipulate a member toward, or away from, a specific
   relationship**, and no AI is used to create a false sense of urgency,
   inevitability, or pressure about marriage. Guidance content is always
   framed as educational, with the member's own discernment as the decision
   maker.
4. **No AI reveals one member's private information to another member** —
   this includes profile fields hidden by privacy settings, message content,
   moderation history, or anything a member hasn't chosen to share directly
   with the other party. An AI feature scoped to one member's own data must
   not be reachable with another member's ID substituted in.
5. Every AI-originated action that writes to the database is written by a
   feature-specific detector running with the platform's own service
   credentials — never by a member's own session — so it can never be
   invoked, tuned, or spoofed by a member directly.

## 1. Compatibility Assistant — NOT YET BUILT

Scope as specified: analyze profile/questionnaire data to surface
compatibility insights. **Deferred.** This needs careful prompt design (to
enforce rule #1 above at the generation layer, not just as an instruction
that can be argued around) and a decision on which fields are safe to include
in a prompt without crossing rule #4 for the *other* member in a proposed
match. Building this without that groundwork risked shipping exactly the
"claims to know your soulmate" failure mode the spec explicitly prohibits.

## 2. Safety Assistant — LIVE (heuristic v1)

**What's built:** `src/lib/contentSafetyHeuristic.ts` is a deterministic
pattern-matching detector (categories: HARASSMENT, SEXUAL_SOLICITATION,
SCAM_OR_FINANCIAL, THREAT, COERCION). It is deliberately **not** an LLM call
for this first version — a fixed, auditable rule set can't be prompt-injected
by the content it scans and never fabricates a judgment, which matters more
here than recall. It runs server-side, with the platform's service
credentials, immediately after a community post or comment is created
(`app/api/community/posts/route.ts`, `app/api/community/posts/[id]/comments/route.ts`).

**Human review boundary (rule #2), concretely:** a hit writes a row to the
existing `content_flags` table with `status = PENDING_REVIEW`. It never
touches the post/comment itself and never blocks the member's action — a
flagged post still goes live immediately. Only a SAFETY_MODERATOR-tier
reviewer (via `app/api/moderation/flags`, UI at `/moderation/flags`) can act
on it, and their only two options are:
- **Dismiss** — closes the flag, no further effect.
- **Confirm** — converts the flag into an ordinary `reports` row (the
  reviewing moderator recorded as reporter of record) plus a
  `moderation_cases` row, which then goes through the *exact same*
  investigate → act workflow as a member-filed report. A human still decides
  any real consequence via the existing case-actions route. See
  `app/api/moderation/flags/[id]/route.ts` for the enforcement code.

**Not yet covered:** private messages are end-to-end encrypted at rest
(`Message.ciphertext`) specifically so the platform cannot read them outside
the already-audited moderation-escrow flow from Phase 6/7
(`has_active_moderation_access`) — the Safety Assistant does not and should
not bypass that architecture by scanning plaintext at send time without a
separate, explicit decision to extend the escrow model. Left as a deliberate
gap, not an oversight.

## 3. Marriage Guidance Assistant — NOT YET BUILT

Scope as specified: help members navigate educational material and
relationship guidance. **Deferred.** The existing `guidance_articles` table
and admin publishing flow (Phase 8) already serves static educational
content; an AI layer on top of it needs its own boundary work against rule
#3 (never pressure toward marriage) before it ships, since guidance is
exactly the surface where subtle pressure could creep in through phrasing.

## 4. Business Assistant — NOT YET BUILT

Scope as specified: help members develop business ideas, plans, marketing
plans, career plans, financial education. **Deferred**, lower urgency than
the safety-facing items above — no member-facing harm vector comparable to
rules #2/#3, just not yet built.

## 5. Community Moderation (content flagging) — LIVE

Same detector and same human-review boundary as the Safety Assistant above
(#2) — this is one system, not two. The `content_flags.detectionSource`
column is `'KEYWORD_HEURISTIC_V1'` by design, versioned so a future
LLM-based detector can be introduced as `V2` alongside it without losing the
audit trail of which detector produced which flag.

## Change log

- 2026-09-27: Initial policy written; Safety Assistant / Community
  Moderation flagging shipped (heuristic v1) covering community posts and
  comments. Compatibility, Marriage Guidance, and Business assistants
  deferred — see sections above for why.
